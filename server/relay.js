import { WebSocketServer } from 'ws'

/**
 * 온라인 대기실 + 주행 중계 서버.
 * - 접속 → 닉네임(hello) → 대기실 목록. 방 만들기/입장/나가기, 방장이 출발(start)
 * - 결승선 통과(finish) 순서대로 기록. 모두 도착하거나 1등 도착 30초 뒤 레이스 종료 →
 *   모두에게 점수판(final) 5초 → 방을 출발 전 상태로 되돌린다
 * - 방 안에서는 각자 카트 상태(state)를 보내면 같은 방 사람들에게 전달. 물리는 각자 브라우저에서 계산
 * 받은 메시지는 믿지 않는다: 정해진 필드만, 길이·범위를 검사해서 다시 만든다.
 * 실행: npm run server  (포트: PORT 환경변수, 기본 8787)
 */
const PORT = Number(process.env.PORT) || 8787
const MAX_PER_ROOM = 8 // src/track/trackData.ts의 GRID_SLOTS와 같게
const MAX_ROOMS = 50
// 카트 상태: 위치·회전·속도 + 조향각(steer) · 미끄러지는 바퀴(skid, 4비트) · 레이스 진행도(progress, 바퀴 단위)
const FIELDS = ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'speed', 'steer', 'skid', 'progress']
const MAPS = ['forest', 'desert', 'polar', 'mountain', 'rally'] // src/track/maps.ts의 MapId와 같게
const SPEEDS = ['normal', 'fast', 'faster'] // 방 속도: 기본 · 빠름 · 매우 빠름 (가속·최고속도는 각자 브라우저가 적용)
const VEHICLES = ['kart', 'bike'] // 고를 수 있는 차량 (모양만 다르고 주행 물리는 같다)
const MAX_HIT = 15 // 충돌로 상대에게 줄 수 있는 최대 속도 변화 (m/s)
/** 출발 버튼 → 초록불까지 (ms). src/game/race.ts의 PRE_DELAY + 3 * BEAT와 같게 — 기록은 서버 시계로 잰다 */
const GREEN_LIGHT_DELAY = 5000
const END_AFTER_FIRST = Number(process.env.END_MS) || 30000 // 1등 도착 후 레이스 종료까지 (ms, 테스트용으로 END_MS로 줄일 수 있음)
const SCOREBOARD_TIME = Number(process.env.BOARD_MS) || 5000 // 종료 후 점수판을 보여 주는 시간 (ms)

/** @type {Map<string, Room>} 방 id → 방 */
const rooms = new Map()
/** @type {Set<Client>} */
const clients = new Set()
let nextId = 1

const wss = new WebSocketServer({ port: PORT, maxPayload: 1024 })

const send = (ws, msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg))

/** 앞뒤 공백을 자르고 길이가 1~max인 문자열만 통과 */
function cleanText(v, max) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s.length >= 1 && s.length <= max ? s : null
}

const roomSummary = (r) => ({
  id: r.id,
  name: r.name,
  locked: r.password !== null,
  count: r.members.size,
  max: MAX_PER_ROOM,
  started: r.started,
  laps: r.laps,
  speed: r.speed,
  map: r.map,
})
const roomDetail = (r) => ({
  id: r.id,
  name: r.name,
  hostId: r.hostId,
  started: r.started,
  laps: r.laps,
  speed: r.speed,
  map: r.map,
  members: [...r.members]
    .map((m) => ({ id: m.id, name: m.name, slot: m.slot, ready: m.ready, vehicle: m.vehicle }))
    .sort((a, b) => a.slot - b.slot),
})

/** 대기실(방 밖)에 있는 사람들에게 방 목록을 다시 보낸다 */
function pushRoomList() {
  const list = { type: 'rooms', rooms: [...rooms.values()].map(roomSummary) }
  for (const c of clients) if (c.name && !c.room) send(c, list)
}
function pushRoom(room) {
  for (const m of room.members) send(m, { type: 'room', room: roomDetail(room) })
}

function joinRoom(ws, room) {
  // 출발 그리드 칸: 아직 아무도 안 쓰는 가장 앞 칸 (나가면 비워진다)
  const used = new Set([...room.members].map((m) => m.slot))
  let slot = 0
  while (used.has(slot)) slot++
  ws.slot = slot
  ws.room = room
  ws.ready = false
  room.members.add(ws)
  send(ws, { type: 'joined', slot, room: roomDetail(room) })
  pushRoom(room)
  pushRoomList()
}

function leaveRoom(ws) {
  const room = ws.room
  if (!room) return
  room.members.delete(ws)
  ws.room = null
  for (const m of room.members) send(m, { type: 'leave', id: ws.id })
  if (room.members.size === 0) {
    clearTimeout(room.resetTimer)
    rooms.delete(room.id)
  } else {
    // 방장이 나가면 가장 앞 칸 사람이 방장
    if (room.hostId === ws.id) room.hostId = [...room.members].sort((a, b) => a.slot - b.slot)[0].id
    pushRoom(room)
    endIfAllFinished(room) // 아직 달리던 사람이 나가서 남은 사람이 모두 도착한 상태일 수 있다
  }
  pushRoomList()
}

const resultsMsg = (room) => ({ type: 'results', results: room.results, remaining: Math.max(0, room.resetAt - Date.now()) })

/** 레이스가 끝난 방을 출발 전 상태로 (모두 출발 그리드로) */
function resetRoom(room) {
  room.started = false
  room.ended = false
  room.results = []
  room.resetAt = 0
  for (const m of room.members) m.ready = false // 다음 레이스는 다시 ready부터
  for (const m of room.members) send(m, { type: 'reset', slot: m.slot })
  pushRoom(room)
  pushRoomList()
}

/** 레이스 종료: 모두에게 최종 점수판, SCOREBOARD_TIME 뒤 초기화 */
function endRace(room) {
  if (room.ended) return
  room.ended = true
  clearTimeout(room.resetTimer)
  for (const m of room.members) send(m, { type: 'final', results: room.results, remaining: SCOREBOARD_TIME })
  room.resetTimer = setTimeout(() => resetRoom(room), SCOREBOARD_TIME)
}
function endIfAllFinished(room) {
  if (room.started && !room.ended && [...room.members].every((m) => room.results.some((r) => r.id === m.id))) endRace(room)
}

function newRoomId() {
  let id
  do id = Math.random().toString(36).slice(2, 8)
  while (rooms.has(id))
  return id
}

wss.on('connection', (ws) => {
  /** @typedef {typeof ws & { id: number, name: string, room: Room | null, slot: number }} Client */
  /** @typedef {{ id: string, name: string, password: string | null, members: Set<Client>, hostId: number, started: boolean }} Room */
  ws.id = nextId++
  ws.name = ''
  ws.vehicle = 'kart'
  ws.room = null
  ws.slot = 0
  clients.add(ws)

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (typeof msg !== 'object' || msg === null) return

    switch (msg.type) {
      case 'hello': {
        const name = cleanText(msg.name, 12)
        if (!name) return send(ws, { type: 'error', code: 'name' })
        ws.name = name
        send(ws, { type: 'welcome', id: ws.id, name })
        send(ws, { type: 'rooms', rooms: [...rooms.values()].map(roomSummary) })
        return
      }
      case 'create': {
        if (!ws.name || ws.room) return
        const name = cleanText(msg.name, 20)
        const wantsPassword = msg.password !== undefined && msg.password !== null
        const password = wantsPassword ? cleanText(msg.password, 20) : null
        const laps = Number.isInteger(msg.laps) && msg.laps >= 1 && msg.laps <= 3 ? msg.laps : 1
        const speed = SPEEDS.includes(msg.speed) ? msg.speed : 'normal'
        if (!name) return send(ws, { type: 'error', code: 'roomName' })
        if (wantsPassword && !password) return send(ws, { type: 'error', code: 'passwordFormat' })
        if (rooms.size >= MAX_ROOMS) return send(ws, { type: 'error', code: 'tooManyRooms' })
        const room = { id: newRoomId(), name, password, laps, speed, map: 'forest', members: new Set(), hostId: ws.id, started: false, ended: false, raceStartAt: 0, results: [], resetAt: 0, resetTimer: undefined }
        rooms.set(room.id, room)
        joinRoom(ws, room)
        return
      }
      case 'join': {
        if (!ws.name || ws.room) return
        const room = typeof msg.roomId === 'string' ? rooms.get(msg.roomId) : undefined
        if (!room) return send(ws, { type: 'error', code: 'notFound' })
        if (room.members.size >= MAX_PER_ROOM) return send(ws, { type: 'error', code: 'full' })
        if (room.started) return send(ws, { type: 'error', code: 'started' })
        if (room.password !== null && msg.password !== room.password) {
          return send(ws, { type: 'error', code: 'password', roomId: room.id })
        }
        joinRoom(ws, room)
        return
      }
      case 'leave':
        // 레이스 중에는 나갈 수 없다 (창을 닫는 건 막을 수 없으니 close에서는 그대로 처리)
        if (ws.room?.started) return
        leaveRoom(ws)
        return
      case 'vehicle': {
        // 차량 변경: 대기실에서, 또는 방에서 ready 전·출발 전까지만
        if (!VEHICLES.includes(msg.vehicle)) return
        if (ws.room && (ws.room.started || ws.ready)) return
        ws.vehicle = msg.vehicle
        if (ws.room) pushRoom(ws.room)
        return
      }
      case 'settings': {
        // 방 설정 변경: 방장만, 출발 전에만. 보낸 항목 중 올바른 값만 바꾼다
        const room = ws.room
        if (!room || room.hostId !== ws.id || room.started) return
        if (MAPS.includes(msg.map)) room.map = msg.map
        if (Number.isInteger(msg.laps) && msg.laps >= 1 && msg.laps <= 3) room.laps = msg.laps
        if (SPEEDS.includes(msg.speed)) room.speed = msg.speed
        pushRoom(room)
        pushRoomList()
        return
      }
      case 'ready': {
        // 방장이 아닌 사람의 준비 상태 (누를 때마다 켜고 끔)
        const room = ws.room
        if (!room || room.started || room.hostId === ws.id) return
        ws.ready = !ws.ready
        pushRoom(room)
        return
      }
      case 'start': {
        const room = ws.room
        if (!room || room.hostId !== ws.id || room.started) return
        // 방장을 뺀 모두가 ready여야 출발 (혼자면 바로 가능)
        if ([...room.members].some((m) => m.id !== room.hostId && !m.ready)) return
        room.started = true
        room.ended = false
        room.results = []
        room.raceStartAt = Date.now() + GREEN_LIGHT_DELAY
        for (const m of room.members) send(m, { type: 'countdown' })
        pushRoom(room)
        pushRoomList()
        return
      }
      case 'finish': {
        // 정해진 바퀴를 다 돈 사람이 알린다. 기록 = 서버가 잰 출발 신호부터의 시간 (클라이언트 시간은 믿지 않음)
        const room = ws.room
        if (!room || !room.started || room.ended || room.results.some((r) => r.id === ws.id)) return
        const time = Date.now() - room.raceStartAt
        if (time <= 0) return
        room.results.push({ id: ws.id, name: ws.name, time, rank: room.results.length + 1 })
        if (room.results.length === 1) {
          room.resetAt = Date.now() + END_AFTER_FIRST
          room.resetTimer = setTimeout(() => endRace(room), END_AFTER_FIRST)
        }
        for (const m of room.members) send(m, resultsMsg(room))
        endIfAllFinished(room)
        return
      }
      case 'hit': {
        // 충돌: 같은 방의 대상 한 명에게만, 크기를 제한해서 전달
        if (!ws.room) return
        const { to, vx, vz } = msg
        if (!Number.isInteger(to) || ![vx, vz].every((v) => typeof v === 'number' && Number.isFinite(v))) return
        const k = Math.min(1, MAX_HIT / Math.max(Math.hypot(vx, vz), 1e-6))
        for (const m of ws.room.members) if (m.id === to) send(m, { type: 'hit', from: ws.id, vx: vx * k, vz: vz * k })
        return
      }
      case 'state': {
        if (!ws.room) return
        const state = { type: 'state', id: ws.id }
        for (const k of FIELDS) {
          const v = msg[k]
          if (typeof v !== 'number' || !Number.isFinite(v)) return
          state[k] = v
        }
        for (const m of ws.room.members) if (m !== ws) send(m, state)
        return
      }
    }
  })

  ws.on('close', () => {
    leaveRoom(ws)
    clients.delete(ws)
  })
})

console.log(`relay listening on ws://localhost:${PORT}`)

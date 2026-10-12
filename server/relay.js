import { WebSocketServer } from 'ws'

/**
 * 온라인 대기실 + 주행 중계 서버.
 * - 접속 → 닉네임(hello) → 대기실 목록. 방 만들기/입장/나가기, 방장이 출발(start)
 * - 결승선 통과(finish) 순서대로 기록. 1등 도착 30초 뒤 방을 출발 전 상태로 되돌린다
 * - 방 안에서는 각자 카트 상태(state)를 보내면 같은 방 사람들에게 전달. 물리는 각자 브라우저에서 계산
 * 받은 메시지는 믿지 않는다: 정해진 필드만, 길이·범위를 검사해서 다시 만든다.
 * 실행: npm run server  (포트: PORT 환경변수, 기본 8787)
 */
const PORT = Number(process.env.PORT) || 8787
const MAX_PER_ROOM = 8 // src/track/trackData.ts의 GRID_SLOTS와 같게
const MAX_ROOMS = 50
// 카트 상태: 위치·회전·속도 + 조향각(steer) · 미끄러지는 바퀴(skid, 4비트) · 레이스 진행도(progress, 바퀴 단위)
const FIELDS = ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'speed', 'steer', 'skid', 'progress']
const MAX_HIT = 15 // 충돌로 상대에게 줄 수 있는 최대 속도 변화 (m/s)
/** 출발 버튼 → 초록불까지 (ms). src/game/race.ts의 PRE_DELAY + 3 * BEAT와 같게 — 기록은 서버 시계로 잰다 */
const GREEN_LIGHT_DELAY = 5000
const RESET_AFTER_FIRST = Number(process.env.RESET_MS) || 30000 // 1등 도착 후 방 초기화까지 (ms, 테스트용으로 RESET_MS로 줄일 수 있음)

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
})
const roomDetail = (r) => ({
  id: r.id,
  name: r.name,
  hostId: r.hostId,
  started: r.started,
  laps: r.laps,
  members: [...r.members].map((m) => ({ id: m.id, name: m.name, slot: m.slot })).sort((a, b) => a.slot - b.slot),
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
  }
  pushRoomList()
}

const resultsMsg = (room) => ({ type: 'results', results: room.results, remaining: Math.max(0, room.resetAt - Date.now()) })

/** 레이스가 끝난 방을 출발 전 상태로 (모두 출발 그리드로) */
function resetRoom(room) {
  room.started = false
  room.results = []
  room.resetAt = 0
  for (const m of room.members) send(m, { type: 'reset', slot: m.slot })
  pushRoom(room)
  pushRoomList()
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
        if (!name) return send(ws, { type: 'error', code: 'roomName' })
        if (wantsPassword && !password) return send(ws, { type: 'error', code: 'passwordFormat' })
        if (rooms.size >= MAX_ROOMS) return send(ws, { type: 'error', code: 'tooManyRooms' })
        const room = { id: newRoomId(), name, password, laps, members: new Set(), hostId: ws.id, started: false, raceStartAt: 0, results: [], resetAt: 0, resetTimer: undefined }
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
      case 'start': {
        const room = ws.room
        if (!room || room.hostId !== ws.id || room.started) return
        room.started = true
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
        if (!room || !room.started || room.results.some((r) => r.id === ws.id)) return
        const time = Date.now() - room.raceStartAt
        if (time <= 0) return
        room.results.push({ id: ws.id, name: ws.name, time, rank: room.results.length + 1 })
        if (room.results.length === 1) {
          room.resetAt = Date.now() + RESET_AFTER_FIRST
          room.resetTimer = setTimeout(() => resetRoom(room), RESET_AFTER_FIRST)
        }
        for (const m of room.members) send(m, resultsMsg(room))
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

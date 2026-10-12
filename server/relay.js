import { WebSocketServer } from 'ws'

/**
 * 온라인 주행용 중계 서버. 각 클라이언트가 자기 카트 상태를 보내면 같은 방(?room=)의 다른 사람에게 전달한다.
 * 물리는 각자 브라우저에서 계산하고, 서버는 위치·회전만 나른다.
 * 실행: npm run server  (포트: PORT 환경변수, 기본 8787)
 */
const PORT = Number(process.env.PORT) || 8787
const MAX_PER_ROOM = 8
const FIELDS = ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'speed']
const MAX_HIT = 15 // 충돌로 상대에게 줄 수 있는 최대 속도 변화 (m/s)

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const rooms = new Map()
let nextId = 1

const wss = new WebSocketServer({ port: PORT, maxPayload: 1024 })

function broadcast(room, sender, message) {
  const data = JSON.stringify(message)
  for (const peer of rooms.get(room) ?? []) {
    if (peer !== sender && peer.readyState === peer.OPEN) peer.send(data)
  }
}

wss.on('connection', (ws, req) => {
  const room = (new URL(req.url ?? '/', 'http://localhost').searchParams.get('room') ?? 'main').slice(0, 32)
  const members = rooms.get(room) ?? new Set()
  if (members.size >= MAX_PER_ROOM) {
    ws.close(4000, 'room full')
    return
  }
  members.add(ws)
  rooms.set(room, members)
  const id = nextId++
  ws.id = id
  // 출발 그리드 칸: 같은 방에서 아직 아무도 안 쓰는 가장 앞 칸 (나가면 비워진다)
  const used = new Set([...members].map((m) => m.slot))
  let slot = 0
  while (used.has(slot)) slot++
  ws.slot = slot
  ws.send(JSON.stringify({ type: 'welcome', id, slot }))

  ws.on('message', (raw) => {
    // 받은 내용은 믿지 않는다: 정해진 숫자 필드만 골라 다시 만든다
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    // 충돌: 같은 방의 대상 한 명에게만, 크기를 제한해서 전달
    if (msg?.type === 'hit') {
      const { to, vx, vz } = msg
      if (!Number.isInteger(to) || ![vx, vz].every((v) => typeof v === 'number' && Number.isFinite(v))) return
      const k = Math.min(1, MAX_HIT / Math.max(Math.hypot(vx, vz), 1e-6))
      for (const peer of members) {
        if (peer.id === to && peer.readyState === peer.OPEN) peer.send(JSON.stringify({ type: 'hit', from: id, vx: vx * k, vz: vz * k }))
      }
      return
    }
    if (msg?.type !== 'state') return
    const state = { type: 'state', id }
    for (const k of FIELDS) {
      const v = msg[k]
      if (typeof v !== 'number' || !Number.isFinite(v)) return
      state[k] = v
    }
    broadcast(room, ws, state)
  })

  ws.on('close', () => {
    members.delete(ws)
    if (members.size === 0) rooms.delete(room)
    broadcast(room, ws, { type: 'leave', id })
  })
})

console.log(`relay listening on ws://localhost:${PORT}`)

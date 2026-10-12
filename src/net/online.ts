import { kartState } from '../game/kartState'
import { GRID_SLOTS } from '../track/trackData'

/**
 * 온라인 주행: 중계 서버(server/relay.js)에 접속해 내 카트 상태를 보내고, 다른 사람의 상태를 받는다.
 * 서버 주소: VITE_RELAY_URL (기본 ws://<지금 페이지 호스트>:8787), 방: 주소의 ?room= (기본 main)
 * 서버에 연결되지 않아도 혼자 달리는 데는 지장이 없다 — 3초마다 다시 시도한다.
 */

export type PeerState = {
  id: number
  x: number
  y: number
  z: number
  qx: number
  qy: number
  qz: number
  qw: number
  /** km/h — 바퀴 회전 표시용 */
  speed: number
}

/** 다른 사람의 최신 상태 (id → 상태). 렌더링 쪽이 매 프레임 읽는다 */
export const peers = new Map<number, PeerState>()
export const online = { connected: false, myId: 0 }

const SEND_INTERVAL = 50 // ms (초당 20번)
const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? `ws://${location.hostname}:8787`
const ROOM = new URLSearchParams(location.search).get('room') ?? 'main'

const listeners = new Set<() => void>()

/** 다른 사람이 나에게 부딪혀 보낸 충격 (속도 변화, m/s). Kart.tsx가 내 카트에 적용한다 */
let hitHandler: ((vx: number, vz: number) => void) | null = null
export function onHit(fn: typeof hitHandler) {
  hitHandler = fn
}

/** 서버가 정해 준 출발 그리드 칸. 처음 접속했을 때 한 번만 쓴다 (재접속 때 달리던 카트를 옮기지 않게) */
let spawnHandler: ((slot: number) => void) | null = null
let pendingSlot: number | null = null
let spawned = false
export function onSpawn(fn: typeof spawnHandler) {
  spawnHandler = fn
  // 카트가 준비되기 전에 칸 번호가 먼저 왔으면 지금 적용
  if (fn && pendingSlot !== null) {
    fn(pendingSlot)
    pendingSlot = null
  }
}

let socket: WebSocket | null = null
/** 내 화면에서 상대 카트(id)에 부딪혔을 때, 상대가 받을 속도 변화를 보낸다 */
export function sendHit(to: number, vx: number, vz: number) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'hit', to, vx, vz }))
}
/** 접속 상태나 참가자 목록이 바뀌면 호출된다 (위치 갱신에는 호출되지 않음) */
export function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
const notify = () => listeners.forEach((fn) => fn())

let started = false

export function startOnline() {
  if (started) return // StrictMode에서 effect가 두 번 돌아도 연결은 하나
  started = true
  connect()
}

function connect() {
  const ws = new WebSocket(`${RELAY_URL}?room=${encodeURIComponent(ROOM)}`)
  let timer = 0
  socket = ws

  ws.onopen = () => {
    online.connected = true
    notify()
    timer = window.setInterval(() => {
      const p = kartState.position
      const q = kartState.quaternion
      ws.send(
        JSON.stringify({ type: 'state', x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, speed: kartState.speedKmh }),
      )
    }, SEND_INTERVAL)
  }

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.type === 'welcome') {
      online.myId = msg.id
      // 칸 번호가 없거나 범위 밖이면(예: 예전 버전 서버) 옮기지 않고 기본 칸에 그대로 둔다
      if (!spawned && Number.isInteger(msg.slot) && msg.slot >= 0 && msg.slot < GRID_SLOTS) {
        spawned = true
        if (spawnHandler) spawnHandler(msg.slot)
        else pendingSlot = msg.slot
      }
    } else if (msg.type === 'state') {
      const isNew = !peers.has(msg.id)
      peers.set(msg.id, msg)
      if (isNew) notify()
    } else if (msg.type === 'hit') {
      hitHandler?.(msg.vx, msg.vz)
    } else if (msg.type === 'leave') {
      peers.delete(msg.id)
      notify()
    }
  }

  ws.onclose = () => {
    window.clearInterval(timer)
    online.connected = false
    peers.clear()
    notify()
    window.setTimeout(connect, 3000)
  }
}

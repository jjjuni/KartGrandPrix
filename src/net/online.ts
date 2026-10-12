import { kartState } from '../game/kartState'
import { enterLobby, enterRoom, raceProgress, startCountdown } from '../game/race'
import { GRID_SLOTS } from '../track/trackData'

/**
 * 온라인: 중계 서버(server/relay.js)에 접속 → 닉네임 → 대기실 목록 → 방 만들기/입장 → 같은 방 사람과 주행.
 * 서버 주소: VITE_RELAY_URL (기본 ws://<지금 페이지 호스트>:8787)
 * 연결이 끊기면 대기실로 돌아가고 3초마다 다시 접속한다 (닉네임은 기억해 두었다가 다시 보냄).
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
  /** 앞바퀴 조향각 (rad) */
  steer: number
  /** 미끄러지는 바퀴 비트마스크 */
  skid: number
  /** 레이스 진행도 (바퀴 단위) — 실시간 순위 */
  progress: number
}
export type RoomSummary = { id: string; name: string; locked: boolean; count: number; max: number; started: boolean; laps: number }
export type Member = { id: number; name: string; slot: number }
export type RoomDetail = { id: string; name: string; hostId: number; started: boolean; laps: number; members: Member[] }
/** 결승선 도착 기록 (도착 순서 = rank, time = 출발 신호부터 ms, 서버가 잼) */
export type Result = { id: number; name: string; time: number; rank: number }
export type ErrorCode = 'name' | 'roomName' | 'passwordFormat' | 'tooManyRooms' | 'notFound' | 'full' | 'password' | 'started'

/** 다른 사람의 최신 상태 (id → 상태). 렌더링 쪽이 매 프레임 읽는다 */
export const peers = new Map<number, PeerState>()

export const online = {
  /** connecting: 접속 중 · open: 연결됨 · closed: 끊겨서 다시 시도하는 중 */
  status: 'idle' as 'idle' | 'connecting' | 'open' | 'closed',
  myId: 0,
  /** 서버가 받아 준 닉네임 (빈 문자열이면 아직 입장 전) */
  name: '',
  rooms: [] as RoomSummary[],
  room: null as RoomDetail | null,
  /** 이 방의 출발 그리드 칸 */
  slot: 0,
  /** 이번 레이스의 도착 기록 (실시간) */
  results: [] as Result[],
  /** 방이 출발 전 상태로 돌아가는 시각 (performance.now 기준), 1등 도착 전이면 null */
  resetAt: null as number | null,
  error: null as { code: ErrorCode; roomId?: string } | null,
}

const SEND_INTERVAL = 50 // ms (초당 20번)
const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? `ws://${location.hostname}:8787`

// ---- 구독 (React는 useSyncExternalStore로 version을 본다) ----
const listeners = new Set<() => void>()
let version = 0
export function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
export const onlineVersion = () => version
function notify() {
  version++
  listeners.forEach((fn) => fn())
}

// ---- 카트 쪽 연결 (Kart.tsx가 등록) ----
/** 다른 사람이 나에게 부딪혀 보낸 충격 (속도 변화, m/s) */
let hitHandler: ((vx: number, vz: number) => void) | null = null
export function onHit(fn: typeof hitHandler) {
  hitHandler = fn
}
/** 출발 그리드 칸으로 카트를 옮긴다 (방에 들어갈 때 · 대기실로 돌아갈 때 0번 칸) */
let spawnHandler: ((slot: number) => void) | null = null
let pendingSlot: number | null = null
export function onSpawn(fn: typeof spawnHandler) {
  spawnHandler = fn
  // 카트가 준비되기 전에 칸 번호가 먼저 왔으면 지금 적용
  if (fn && pendingSlot !== null) {
    fn(pendingSlot)
    pendingSlot = null
  }
}
function spawn(slot: number) {
  if (spawnHandler) spawnHandler(slot)
  else pendingSlot = slot
}

// ---- 연결 ----
let socket: WebSocket | null = null
let wantedName = ''
let reconnectTimer = 0

const sendMsg = (msg: object) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
}

/** 닉네임으로 입장 (연결이 없으면 연결부터) */
export function enterWithName(name: string) {
  wantedName = name.trim()
  online.error = null
  if (socket && socket.readyState === WebSocket.OPEN) sendMsg({ type: 'hello', name: wantedName })
  else if (!socket || socket.readyState === WebSocket.CLOSED) connect()
  notify()
}

export function createRoom(name: string, password: string | null, laps: number) {
  online.error = null
  notify()
  sendMsg({ type: 'create', name, password, laps })
}
export function joinRoom(roomId: string, password?: string) {
  online.error = null
  notify()
  sendMsg({ type: 'join', roomId, password })
}
/** 방 나가기 — 레이스 중(카운트다운 · 주행)에는 서버도 막는다 */
export function leaveRoom() {
  if (online.room?.started) return
  sendMsg({ type: 'leave' })
  backToLobby()
}
export function startRace() {
  sendMsg({ type: 'start' })
}
/** 정해진 바퀴를 다 돌았다고 알린다 (기록은 서버가 잰다) */
export function sendFinish() {
  sendMsg({ type: 'finish' })
}
export function clearError() {
  online.error = null
  notify()
}

/** 내 화면에서 상대 카트(id)에 부딪혔을 때, 상대가 받을 속도 변화를 보낸다 */
export function sendHit(to: number, vx: number, vz: number) {
  sendMsg({ type: 'hit', to, vx, vz })
}

function backToLobby() {
  online.room = null
  online.results = []
  online.resetAt = null
  peers.clear()
  enterLobby()
  spawn(0)
  notify()
}

function connect() {
  window.clearTimeout(reconnectTimer)
  online.status = 'connecting'
  notify()
  const ws = new WebSocket(RELAY_URL)
  socket = ws
  let timer = 0

  ws.onopen = () => {
    online.status = 'open'
    if (wantedName) ws.send(JSON.stringify({ type: 'hello', name: wantedName }))
    notify()
    // 방 안에 있을 때만 내 카트 상태를 보낸다
    timer = window.setInterval(() => {
      if (!online.room) return
      const p = kartState.position
      const q = kartState.quaternion
      sendMsg({
        type: 'state',
        x: p.x,
        y: p.y,
        z: p.z,
        qx: q.x,
        qy: q.y,
        qz: q.z,
        qw: q.w,
        speed: kartState.speedKmh,
        steer: kartState.steer,
        skid: kartState.skid,
        progress: raceProgress(),
      })
    }, SEND_INTERVAL)
  }

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    switch (msg.type) {
      case 'welcome':
        online.myId = msg.id
        online.name = msg.name
        break
      case 'rooms':
        online.rooms = msg.rooms
        break
      case 'joined':
        online.room = msg.room
        // 칸 번호가 범위 밖이면(예: 다른 버전 서버) 0번 칸
        online.slot = Number.isInteger(msg.slot) && msg.slot >= 0 && msg.slot < GRID_SLOTS ? msg.slot : 0
        online.results = []
        online.resetAt = null
        peers.clear()
        enterRoom(msg.room.started, msg.room.laps)
        spawn(online.slot)
        break
      case 'results':
        online.results = msg.results
        online.resetAt = performance.now() + msg.remaining
        break
      case 'reset':
        // 1등 도착 30초 뒤: 모두 출발 그리드로 돌아가 다음 출발을 기다린다
        online.results = []
        online.resetAt = null
        enterRoom(false, online.room?.laps ?? 1)
        spawn(online.slot)
        break
      case 'room':
        online.room = msg.room
        break
      case 'countdown':
        startCountdown()
        break
      case 'error':
        online.error = { code: msg.code, roomId: msg.roomId }
        break
      case 'state': {
        const isNew = !peers.has(msg.id)
        peers.set(msg.id, msg)
        if (!isNew) return // 위치 갱신은 화면 다시 그리기가 필요 없다
        break
      }
      case 'hit':
        hitHandler?.(msg.vx, msg.vz)
        return
      case 'leave':
        peers.delete(msg.id)
        break
      default:
        return
    }
    notify()
  }

  ws.onclose = () => {
    window.clearInterval(timer)
    online.status = 'closed'
    online.rooms = [] // 닉네임(online.name)은 그대로: 다시 연결되면 같은 이름으로 대기실에 복귀
    if (online.room) backToLobby()
    notify()
    reconnectTimer = window.setTimeout(connect, 3000)
  }
}

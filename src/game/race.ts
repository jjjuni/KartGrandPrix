import { beep } from './sound'

/**
 * 레이스 진행 상태. 물리(Kart.tsx)·신호등(StartLine.tsx)은 매 프레임 읽고, 화면(카운트다운 글자)은 subscribe로 받는다.
 * - lobby: 대기실 화면 (방 밖). 카트는 출발선에 세워 둔 배경
 * - waiting: 방 안, 출발 전 — 좌우 조향만 가능
 * - countdown: 방장이 출발을 눌러 신호를 기다리는 중 — 조향만 가능
 * - racing: 자유 주행 (정해진 바퀴를 다 돌면 finished — 다시 잠김)
 */
export type Phase = 'lobby' | 'waiting' | 'countdown' | 'racing'
export type Light = 'off' | 'red' | 'yellow' | 'green'

export const race = {
  phase: 'lobby' as Phase,
  light: 'off' as Light,
  /** 화면 가운데 위에 크게 보이는 카운트다운 글자 ('3' | '2' | '1' | 'START'), 없으면 null */
  cue: null as string | null,
  /** 이 방의 바퀴 수 */
  laps: 1,
  /** 지금 몇 번째 바퀴인지 (1부터, 화면 표시용) */
  lap: 1,
  /** 정해진 바퀴를 다 돌았는지 */
  finished: false,
}

const listeners = new Set<() => void>()
let version = 0
export function subscribeRace(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
export const raceVersion = () => version
function set(next: Partial<typeof race>) {
  Object.assign(race, next)
  version++
  listeners.forEach((fn) => fn())
}

export const canDrive = () => race.phase === 'racing' && !race.finished

const PRE_DELAY = 2000 // 출발을 누른 뒤 첫 신호까지 (ms)
const BEAT = 1000 // 신호 간격 (ms)
const CUE_HOLD = 900 // START 글자를 보여 주는 시간 (ms)
// 스타트 부스터 판정 구간: 초록불 EARLY ms 전 ~ LATE ms 후 (신호음과 손의 반응을 감안해 초록불보다 조금 앞당김)
const START_BOOST_EARLY = 100
const START_BOOST_LATE = 200

/** 신호 순서: 3·2는 빨강(정지), 1은 노랑(준비), START에 초록(출발) */
const STEPS: { cue: string; light: Light; freq: number; length: number }[] = [
  { cue: '3', light: 'red', freq: 440, length: 0.18 },
  { cue: '2', light: 'red', freq: 440, length: 0.18 },
  { cue: '1', light: 'yellow', freq: 440, length: 0.18 },
  { cue: 'START', light: 'green', freq: 880, length: 0.6 },
]

let timers: number[] = []
function clearTimers() {
  timers.forEach((t) => window.clearTimeout(t))
  timers = []
}

// ---- 스타트 부스터: 초록불에 맞춰 ↑를 처음 누르면. 판정 구간보다 일찍 누르면(부정 출발) 기회가 사라진다 ----
/** 초록불 시각 (카운트다운 시작 때 예정 시각으로 정해 두고, 실제로 켜질 때 다시 맞춘다) */
let greenAt = 0
/** 지금 바퀴를 시작한 시각 (1바퀴 = 초록불, 그다음은 출발선을 통과해 새 바퀴를 시작한 순간) */
let lapStartAt = 0
/** 지금 바퀴의 경과 시간 (ms) */
export const lapTime = () => performance.now() - lapStartAt
let startBoostReady = false // 아직 판정 전 (한 레이스에 한 번)
let startBoostQueued = false // 판정 성공 — 초록불이 켜지면 부스터

/** ↑를 새로 누를 때마다 부른다 (카운트다운 중에도). 첫 입력만 판정한다 */
export function pressForward(now: number) {
  if (!startBoostReady || (race.phase !== 'countdown' && race.phase !== 'racing')) return
  startBoostReady = false
  const dt = now - greenAt
  if (dt >= -START_BOOST_EARLY && dt <= START_BOOST_LATE) startBoostQueued = true
}

/** 매 프레임 부른다: 초록불 이후 판정에 성공해 있으면 한 번 true (초록불 직전에 누른 것도 초록불에 맞춰 나간다) */
export function takeStartBoost() {
  if (!startBoostQueued || race.phase !== 'racing') return false
  startBoostQueued = false
  return true
}

export function startCountdown() {
  clearTimers()
  resetLapCount()
  startBoostReady = true
  startBoostQueued = false
  greenAt = performance.now() + PRE_DELAY + (STEPS.length - 1) * BEAT
  set({ phase: 'countdown', light: 'off', cue: null })
  STEPS.forEach((step, i) => {
    timers.push(
      window.setTimeout(
        () => {
          beep(step.freq, step.length)
          if (step.cue === 'START') greenAt = lapStartAt = performance.now()
          set({ light: step.light, cue: step.cue, ...(step.cue === 'START' ? { phase: 'racing' } : {}) })
        },
        PRE_DELAY + i * BEAT,
      ),
    )
  })
  timers.push(window.setTimeout(() => set({ cue: null }), PRE_DELAY + (STEPS.length - 1) * BEAT + CUE_HOLD))
}

/** 방에 들어왔을 때 · 레이스가 끝나 방이 초기화됐을 때: 이미 출발한 방이면 바로 주행, 아니면 대기 */
export function enterRoom(started: boolean, laps: number) {
  clearTimers()
  resetLapCount()
  lapStartAt = performance.now()
  set({
    laps,
    lap: 1,
    finished: false,
    ...(started ? { phase: 'racing', light: 'green', cue: null } : { phase: 'waiting', light: 'off', cue: null }),
  })
}

// ---- 바퀴 세기: 출발선(중심선 샘플 0번)을 앞으로 지나면 +1, 거꾸로 지나면 -1 ----
// 출발 그리드는 출발선 뒤에 있으므로 첫 통과는 1바퀴의 시작이고, 그 뒤 통과할 때마다 한 바퀴 완주
let crossings = 0
let lastIndex = -1
let lastN = 1
let timedLaps = 0 // 랩타임을 새로 시작한 완주 바퀴 수 — 출발선을 뒤로 넘었다 다시 넘어도 두 번 재시작하지 않게
function resetLapCount() {
  crossings = 0
  lastIndex = -1
  timedLaps = 0
}

/** 레이스 진행도 (바퀴 단위, 순위 비교용): 완주한 바퀴 + 이번 바퀴에서 간 비율. 출발선 뒤에서는 0보다 약간 작다 */
export function raceProgress() {
  if (lastIndex < 0) return -1
  return crossings - 1 + lastIndex / lastN
}

/**
 * 매 프레임 카트에 가장 가까운 중심선 샘플 번호(index, 전체 n개)를 넣는다.
 * 방금 마지막 바퀴를 마쳤으면 true (그때 한 번만).
 */
export function updateLap(index: number, n: number) {
  if (race.phase !== 'racing' || race.finished) return false
  const prev = lastIndex
  lastIndex = index
  lastN = n
  if (prev < 0) return false
  const forward = prev > n * 0.75 && index < n * 0.25
  const backward = prev < n * 0.25 && index > n * 0.75
  if (!forward && !backward) return false
  crossings += forward ? 1 : -1
  const done = crossings - 1 // 완주한 바퀴 수
  if (done > timedLaps) {
    timedLaps = done
    lapStartAt = performance.now()
  }
  if (done >= race.laps) {
    set({ finished: true, lap: race.laps })
    return true
  }
  const lap = Math.min(Math.max(done + 1, 1), race.laps)
  if (lap !== race.lap) set({ lap })
  return false
}

/** 레이스 종료(서버가 알림): 아직 달리던 사람도 멈춘다 */
export function endRace() {
  set({ finished: true })
}

export function enterLobby() {
  clearTimers()
  resetLapCount()
  set({ phase: 'lobby', light: 'off', cue: null, lap: 1, finished: false })
}

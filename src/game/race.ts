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
const START_BOOST_WINDOW = 300 // 초록불이 켜진 뒤 이 시간 안에 ↑를 누르면 스타트 부스터 (ms)

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

// ---- 스타트 부스터: 초록불에 맞춰 ↑를 처음 누르면. 신호 전에 미리 누르면(부정 출발) 기회가 사라진다 ----
let greenAt = 0
let startBoostReady = false

/** ↑를 새로 누를 때마다 부른다. 스타트 부스터를 써야 하면 true (한 레이스에 한 번만 판정) */
export function tryStartBoost(now: number) {
  if (!startBoostReady) return false
  if (race.phase === 'countdown') {
    startBoostReady = false // 신호 전에 누름
    return false
  }
  if (race.phase !== 'racing') return false
  startBoostReady = false
  return now - greenAt <= START_BOOST_WINDOW
}

export function startCountdown() {
  clearTimers()
  resetLapCount()
  startBoostReady = true
  set({ phase: 'countdown', light: 'off', cue: null })
  STEPS.forEach((step, i) => {
    timers.push(
      window.setTimeout(() => {
        beep(step.freq, step.length)
        if (step.cue === 'START') greenAt = performance.now()
        set({ light: step.light, cue: step.cue, ...(step.cue === 'START' ? { phase: 'racing' } : {}) })
      }, PRE_DELAY + i * BEAT),
    )
  })
  timers.push(window.setTimeout(() => set({ cue: null }), PRE_DELAY + (STEPS.length - 1) * BEAT + CUE_HOLD))
}

/** 방에 들어왔을 때 · 레이스가 끝나 방이 초기화됐을 때: 이미 출발한 방이면 바로 주행, 아니면 대기 */
export function enterRoom(started: boolean, laps: number) {
  clearTimers()
  resetLapCount()
  set({ laps, lap: 1, finished: false, ...(started ? { phase: 'racing', light: 'green', cue: null } : { phase: 'waiting', light: 'off', cue: null }) })
}

// ---- 바퀴 세기: 출발선(중심선 샘플 0번)을 앞으로 지나면 +1, 거꾸로 지나면 -1 ----
// 출발 그리드는 출발선 뒤에 있으므로 첫 통과는 1바퀴의 시작이고, 그 뒤 통과할 때마다 한 바퀴 완주
let crossings = 0
let lastIndex = -1
let lastN = 1
function resetLapCount() {
  crossings = 0
  lastIndex = -1
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
  if (done >= race.laps) {
    set({ finished: true, lap: race.laps })
    return true
  }
  const lap = Math.min(Math.max(done + 1, 1), race.laps)
  if (lap !== race.lap) set({ lap })
  return false
}

export function enterLobby() {
  clearTimers()
  resetLapCount()
  set({ phase: 'lobby', light: 'off', cue: null, lap: 1, finished: false })
}

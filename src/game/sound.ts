import type { BoostKind } from '../physics/vehicle'

/**
 * 효과음 (Web Audio로 만든 소리 — 음원 파일 없음): 출발 신호음 · 엔진 · 부스터.
 * 브라우저는 사용자가 클릭·키 입력을 하기 전에는 소리를 막으므로, 페이지에서 처음 클릭하거나 키를 누르는 순간 켠다.
 */
let ctx: AudioContext | null = null

function unlockAudio() {
  try {
    if (!ctx) {
      ctx = new AudioContext()
      // 탭이 가려지면 화면 갱신이 멈추므로 엔진 소리가 한 음으로 계속 나지 않게 멈춘다
      document.addEventListener('visibilitychange', () => void (document.hidden ? ctx?.suspend() : ctx?.resume()))
    }
    void ctx.resume()
  } catch {
    ctx = null // 소리를 못 내도 게임은 진행
  }
}

// 닉네임 입력 전(연습장 주행 · 입력창 클릭)에도 첫 클릭 · 키 입력부터 소리가 나게
for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, unlockAudio, { once: true })

/** 짧은 신호음: freq(Hz)의 사각파를 length초 동안, 끝을 부드럽게 줄여서 */
export function beep(freq: number, length: number) {
  if (!ctx) return
  const t = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'square'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + length + 0.02)
}

// ---------------------------------------------------------------------------
// 주행 소리 (내 카트만): 엔진(차량마다 다른 음색) · 드리프트 타이어 소리 · 부스터 · 충돌
// ---------------------------------------------------------------------------
type Engine = {
  low: OscillatorNode
  high: OscillatorNode
  filter: BiquadFilterNode
  pulse: GainNode // 실린더 폭발처럼 소리를 끊어 주는 떨림
  lfo: OscillatorNode
  lfoDepth: GainNode
  gain: GainNode
}
let engine: Engine | null = null
let squeal: GainNode | null = null // 드리프트 타이어 소리 (계속 틀어 두고 크기만 바꾼다)
let roar: { src: AudioBufferSourceNode; gain: GainNode } | null = null // Z 부스터가 켜져 있는 동안 이어지는 분사음
let noise: AudioBuffer | null = null
let bus: AudioNode | null = null
let lastBoost: BoostKind = 'none'
let lastCrash = 0

/** 주행 소리 출력: 여러 소리가 겹쳐도 찢어지지 않게 압축기를 거친다 */
function out(c: AudioContext) {
  if (bus) return bus
  const comp = c.createDynamicsCompressor()
  comp.threshold.value = -14
  comp.ratio.value = 6
  comp.connect(c.destination)
  bus = comp
  return bus
}

/** 1초짜리 백색 소음 (부스터 · 타이어 · 충돌 소리 재료) */
function noiseBuffer(c: AudioContext) {
  if (noise) return noise
  noise = c.createBuffer(1, c.sampleRate, c.sampleRate)
  const d = noise.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return noise
}

function noiseSource(c: AudioContext, loop = false) {
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c)
  src.loop = loop
  return src
}

/** 거칠게 찌그러뜨리는 곡선 (폭발음에 힘을 싣는다) */
let curve: Float32Array | null = null
function distortion(c: AudioContext) {
  if (!curve) {
    curve = new Float32Array(1024)
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1
      curve[i] = Math.tanh(x * 4)
    }
  }
  const ws = c.createWaveShaper()
  ws.curve = curve
  return ws
}

function startEngine(c: AudioContext): Engine {
  const low = c.createOscillator()
  const high = c.createOscillator()
  const filter = c.createBiquadFilter()
  const pulse = c.createGain()
  const lfo = c.createOscillator()
  const lfoDepth = c.createGain()
  const gain = c.createGain()
  low.type = 'square'
  high.type = 'sawtooth'
  lfo.type = 'square'
  filter.type = 'lowpass'
  filter.Q.value = 3
  pulse.gain.value = 0.5
  gain.gain.value = 0
  lfo.connect(lfoDepth).connect(pulse.gain) // 떨림: pulse 크기를 lfo로 흔든다
  low.connect(filter)
  high.connect(filter)
  filter.connect(pulse).connect(gain).connect(out(c))
  for (const o of [low, high, lfo]) o.start()
  return { low, high, filter, pulse, lfo, lfoDepth, gain }
}

/** 드리프트 타이어 소리: 좁은 대역 잡음 두 겹 '끼이익' + 낮게 갈리는 소리 (묵직하게) */
function startSqueal(c: AudioContext) {
  const g = c.createGain()
  g.gain.value = 0
  for (const [f, q] of [[1000, 11], [1900, 10], [260, 1.5]]) {
    const src = noiseSource(c, true)
    const band = c.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = f
    band.Q.value = q
    src.connect(band).connect(g)
    src.start()
  }
  g.connect(out(c))
  return g
}

/**
 * 부스터 점화: 찌그러진 저음 폭발 '쾅' + 배기 '팡' + 위로 치솟는 분사 '화아악'.
 * full(Z 부스터)은 더 크고 길게
 */
function ignite(c: AudioContext, full: boolean) {
  const t = c.currentTime
  const o = out(c)
  // 쾅: 낮게 떨어지는 사인파를 찌그러뜨려 묵직하게
  const boom = c.createOscillator()
  const bg = c.createGain()
  boom.type = 'sine'
  boom.frequency.setValueAtTime(full ? 85 : 105, t)
  boom.frequency.exponentialRampToValueAtTime(full ? 30 : 34, t + (full ? 0.55 : 0.35))
  bg.gain.setValueAtTime(full ? 0.75 : 0.5, t)
  bg.gain.exponentialRampToValueAtTime(0.0001, t + (full ? 0.65 : 0.4))
  boom.connect(distortion(c)).connect(bg).connect(o)
  boom.start(t)
  boom.stop(t + 0.7)
  // 팡: 아주 짧은 고음 잡음
  const pop = noiseSource(c)
  const hp = c.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 2500
  const pg = c.createGain()
  pg.gain.setValueAtTime(full ? 0.35 : 0.28, t)
  pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07)
  pop.connect(hp).connect(pg).connect(o)
  pop.start(t)
  pop.stop(t + 0.1)
  // 화아악: 저역 통과 잡음의 문을 확 열었다가 천천히 닫는다
  const length = full ? 1.1 : 0.6
  const rush = noiseSource(c)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 4
  lp.frequency.setValueAtTime(300, t)
  lp.frequency.exponentialRampToValueAtTime(full ? 2600 : 2200, t + 0.12)
  lp.frequency.exponentialRampToValueAtTime(700, t + length)
  const rg = c.createGain()
  rg.gain.setValueAtTime(0.0001, t)
  rg.gain.exponentialRampToValueAtTime(full ? 0.62 : 0.42, t + 0.03)
  rg.gain.exponentialRampToValueAtTime(0.0001, t + length)
  rush.connect(lp).connect(distortion(c)).connect(rg).connect(o)
  rush.start(t)
  rush.stop(t + length + 0.05)
}

/** Z 부스터가 켜져 있는 동안 고르게 이어지는 분사음 '화아아아' 켜기 · 끄기 */
function setRoar(c: AudioContext, on: boolean) {
  if (on && !roar) {
    const src = noiseSource(c, true)
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2000
    lp.Q.value = 3
    const gain = c.createGain()
    gain.gain.value = 0
    gain.gain.setTargetAtTime(0.3, c.currentTime, 0.06)
    src.connect(lp).connect(gain).connect(out(c))
    src.start()
    roar = { src, gain }
  } else if (!on && roar) {
    const { src, gain } = roar
    gain.gain.setTargetAtTime(0, c.currentTime, 0.15)
    src.stop(c.currentTime + 1)
    roar = null
  }
}

/** 부딪힘 소리: strength = 충돌로 줄어든 속도 (m/s). 묵직한 '쿵' + 낮게 부서지는 소리 + 짧은 '챙' */
export function crashSound(strength: number) {
  if (!ctx || ctx.state !== 'running' || strength < 1.5) return
  const t = ctx.currentTime
  if (t - lastCrash < 0.15) return // 한 번 부딪힐 때 여러 번 울리지 않게
  lastCrash = t
  const k = Math.min(1, strength / 12)
  const o = out(ctx)
  const thud = ctx.createOscillator()
  const tg = ctx.createGain()
  thud.type = 'triangle'
  thud.frequency.setValueAtTime(95, t)
  thud.frequency.exponentialRampToValueAtTime(28, t + 0.3)
  tg.gain.setValueAtTime(0.45 + 0.6 * k, t)
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.4)
  thud.connect(distortion(ctx)).connect(tg).connect(o)
  thud.start(t)
  thud.stop(t + 0.45)
  // 낮게 부서지는 소리: 저역 통과 잡음 한 덩이
  const crunch = noiseSource(ctx)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 450
  const ng = ctx.createGain()
  ng.gain.setValueAtTime(0.35 + 0.5 * k, t)
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.22 + 0.15 * k)
  crunch.connect(lp).connect(ng).connect(o)
  crunch.start(t)
  crunch.stop(t + 0.45)
  const clank = noiseSource(ctx)
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 500 + 700 * k
  band.Q.value = 3
  const cg = ctx.createGain()
  cg.gain.setValueAtTime(0.25 + 0.45 * k, t)
  cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12 + 0.15 * k)
  clank.connect(band).connect(cg).connect(o)
  clank.start(t)
  clank.stop(t + 0.35)
}

/**
 * 매 프레임 (Kart.tsx): 속도 · 가속 페달 · 부스터 · 뒷바퀴 미끄러짐(m/s) · 차량으로 소리를 맞춘다.
 * 카트: 낮고 툭툭 끊기는 단기통 '부르르릉' / 바이크: 높고 매끈하게 올라가는 '위이잉'
 */
export function updateDriveSound(speedKmh: number, throttle: boolean, boostKind: BoostKind, slide: number, bike: boolean) {
  if (!ctx || ctx.state !== 'running') return
  engine ??= startEngine(ctx)
  squeal ??= startSqueal(ctx)
  const t = ctx.currentTime
  const v = Math.min(Math.abs(speedKmh), 260)
  const boost = boostKind !== 'none'
  const e = engine
  if (bike) {
    const pitch = 44 + v * 0.95 + (boost ? 18 : 0)
    e.low.frequency.setTargetAtTime(pitch / 2, t, 0.05)
    e.high.frequency.setTargetAtTime(pitch, t, 0.05)
    e.lfo.frequency.setTargetAtTime(pitch, t, 0.05)
    e.lfoDepth.gain.setTargetAtTime(0.22, t, 0.1)
    e.filter.frequency.setTargetAtTime(450 + v * 10 + (throttle ? 700 : 0), t, 0.08)
    e.gain.gain.setTargetAtTime(0.1 + (throttle ? 0.06 : 0), t, 0.1)
  } else {
    const pitch = 32 + v * 0.5 + (boost ? 12 : 0)
    e.low.frequency.setTargetAtTime(pitch, t, 0.05)
    e.high.frequency.setTargetAtTime(pitch * 2, t, 0.05)
    e.lfo.frequency.setTargetAtTime(pitch / 2, t, 0.05) // 폭발 간격으로 크게 끊어 '툭툭툭'
    e.lfoDepth.gain.setTargetAtTime(0.3, t, 0.1)
    e.filter.frequency.setTargetAtTime(320 + v * 6 + (throttle ? 500 : 0), t, 0.08)
    e.gain.gain.setTargetAtTime(0.14 + (throttle ? 0.08 : 0), t, 0.1)
  }
  // 드리프트: 뒷바퀴가 2m/s 넘게 옆으로 미끄러지기 시작하면 점점 크게
  const sq = Math.min(1, Math.max(0, (slide - 2) / 6))
  squeal.gain.setTargetAtTime(sq * 0.33, t, 0.06)

  if (boostKind !== lastBoost && boost) ignite(ctx, boostKind === 'full')
  setRoar(ctx, boostKind === 'full')
  lastBoost = boostKind
}

/** 카트가 사라질 때(맵 바꿈 · 로딩): 계속 나는 소리를 끈다 — 다음 updateDriveSound에서 다시 켜진다 */
export function stopDriveSound() {
  if (!ctx) return
  engine?.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05)
  squeal?.gain.setTargetAtTime(0, ctx.currentTime, 0.05)
  setRoar(ctx, false)
  lastBoost = 'none'
}

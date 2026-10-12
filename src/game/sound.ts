/**
 * 효과음 (Web Audio로 만든 신호음 — 음원 파일 없음).
 * 브라우저는 사용자가 클릭·키 입력을 하기 전에는 소리를 막으므로, 닉네임 입력 버튼에서 unlockAudio()를 부른다.
 */
let ctx: AudioContext | null = null

export function unlockAudio() {
  try {
    ctx ??= new AudioContext()
    void ctx.resume()
  } catch {
    ctx = null // 소리를 못 내도 게임은 진행
  }
}

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

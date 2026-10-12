/** 기록 표시: 1:23.45 */
export function formatTime(ms: number) {
  const m = Math.floor(ms / 60000)
  const s = (ms % 60000) / 1000
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

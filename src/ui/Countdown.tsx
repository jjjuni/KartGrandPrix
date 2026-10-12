import { useRace } from './hooks'

/** 출발 신호와 함께 화면 가운데 위에 3 · 2 · 1 · START (글자색 = 지금 켜진 신호 색) */
export default function Countdown() {
  const r = useRace()
  if (!r.cue) return null
  return (
    // key가 바뀔 때마다 새로 그려져 등장 애니메이션이 다시 재생된다
    <div key={r.cue} className={`countdown is-${r.light}`} role="status" aria-live="assertive">
      {r.cue}
    </div>
  )
}

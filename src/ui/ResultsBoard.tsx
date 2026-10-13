import { useEffect, useState } from 'react'
import { formatTime } from './format'
import { useOnline, useRace } from './hooks'

/** resetAt까지 남은 초 (1초마다 다시 그림) */
function useSecondsLeft(resetAt: number | null) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (resetAt === null) return
    const t = window.setInterval(() => setNow(performance.now()), 250)
    return () => window.clearInterval(t)
  }, [resetAt])
  return resetAt === null ? null : Math.max(0, Math.ceil((resetAt - now) / 1000))
}

/**
 * 화면 가운데 순위표: 결승선을 통과한 사람에게 바로(다른 사람이 들어올 때마다 한 줄씩),
 * 레이스가 끝나면(모두 도착 또는 1등 도착 30초 뒤) 모두에게 최종 결과로.
 * 아직 달리는 사람에게는 1등 도착 후 남은 시간만 위쪽에 보인다.
 */
export default function ResultsBoard() {
  const o = useOnline()
  const r = useRace()
  const left = useSecondsLeft(o.resetAt)
  const room = o.room
  if (!room || r.phase !== 'racing') return null

  if (!r.finished) {
    if (left === null) return null
    return (
      <p className="finish-alert" role="status">
        {left}초
      </p>
    )
  }

  const finishedIds = new Set(o.results.map((x) => x.id))
  const stillRacing = room.members.filter((m) => !finishedIds.has(m.id))

  return (
    <section className="results" aria-labelledby="results-title">
      <div className="results-head">
        <h2 id="results-title" className="results-title">
          결과
        </h2>
        {left !== null && <span className="results-timer">{left}초</span>}
      </div>
      <ol className="results-list">
        {o.results.map((x) => (
          <li key={x.id} className={x.id === o.myId ? 'is-me' : undefined}>
            <span className="results-rank">{x.rank}</span>
            <span className="results-name">{x.name}</span>
            <span className="results-time">{formatTime(x.time)}</span>
          </li>
        ))}
        {stillRacing.map((m) => (
          <li key={m.id} className="is-racing">
            <span className="results-rank" aria-hidden="true" />
            <span className="results-name">{m.name}</span>
            <span className="results-time">{o.final ? 'RETIRE' : '주행 중'}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

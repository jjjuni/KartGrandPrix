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
 * 결승선을 통과한 사람에게만 화면 가운데 순위표. 다른 사람이 들어올 때마다 실시간으로 한 줄씩 늘어난다.
 * 아직 달리는 사람에게는 1등 도착 후 남은 시간만 위쪽에 알린다.
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
        1등이 들어왔어요. {left}초 안에 결승선을 통과하세요.
      </p>
    )
  }

  const finishedIds = new Set(o.results.map((x) => x.id))
  const stillRacing = room.members.filter((m) => !finishedIds.has(m.id))

  return (
    <section className="results" aria-labelledby="results-title">
      <h2 id="results-title" className="results-title">
        결과
      </h2>
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
            <span className="results-time">주행 중</span>
          </li>
        ))}
      </ol>
      {left !== null && <p className="results-foot">{left}초 뒤 모두 출발 그리드로 돌아가요.</p>}
    </section>
  )
}

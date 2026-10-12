import { useEffect, useState } from 'react'
import { online, peers, startOnline, subscribe } from '../net/online'

/** 미니맵 아래 접속 상태: 온라인이면 함께 달리는 인원 수 */
export default function OnlineBadge() {
  const [, rerender] = useState(0)
  useEffect(() => {
    const off = subscribe(() => rerender((n) => n + 1))
    startOnline()
    return off
  }, [])

  return (
    <div className={`online-badge ${online.connected ? 'on' : ''}`}>
      {online.connected ? `온라인 · ${peers.size + 1}명` : '오프라인'}
    </div>
  )
}

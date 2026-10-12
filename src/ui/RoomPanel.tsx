import { useEffect, useState } from 'react'
import { raceProgress } from '../game/race'
import { leaveRoom, peers, startRace, type Member, type RoomDetail } from '../net/online'
import { GRID_SLOTS } from '../track/trackData'
import { formatTime } from './format'
import { useOnline, useRace } from './hooks'

type Standing = { member: Member; time: number | null; progress: number }

/**
 * 레이스 순위: 들어온 사람(도착 순) → 아직 달리는 사람(진행도가 큰 순).
 * 진행도 = 완주한 바퀴 + 이번 바퀴에서 간 비율 — 각자 자기 값을 보내 준다 (내 것은 직접 계산)
 */
function standings(room: RoomDetail, myId: number, results: { id: number; time: number }[]): Standing[] {
  const timeOf = new Map(results.map((x) => [x.id, x.time]))
  const order = new Map(results.map((x, i) => [x.id, i]))
  const list = room.members.map((m) => ({
    member: m,
    time: timeOf.get(m.id) ?? null,
    progress: m.id === myId ? raceProgress() : (peers.get(m.id)?.progress ?? -1),
  }))
  return list.sort((a, b) => {
    if (a.time !== null || b.time !== null) {
      if (a.time === null) return 1
      if (b.time === null) return -1
      return order.get(a.member.id)! - order.get(b.member.id)!
    }
    return b.progress - a.progress
  })
}

/** 순위는 위치가 바뀔 때마다(초당 20번) 오지만, 명단은 초당 4번만 다시 그려도 충분하다 */
function useTick(active: boolean) {
  const [, setN] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => setN((n) => n + 1), 250)
    return () => window.clearInterval(t)
  }, [active])
}

/** 방 안 (주행 화면 왼쪽 위): 출발 전에는 출발 명단(그리드 순서), 초록불 뒤에는 실시간 순위 */
export default function RoomPanel() {
  const o = useOnline()
  const r = useRace()
  const room = o.room
  const racing = r.phase === 'racing'
  useTick(racing)
  if (!room) return null
  const isHost = room.hostId === o.myId

  let footer: string | null = null
  if (r.phase === 'waiting') footer = isHost ? '모두 모이면 출발을 눌러 주세요.' : '방장이 출발을 누르면 신호가 켜져요.'
  else if (r.phase === 'countdown') footer = '초록불에 맞춰 ↑를 누르면 스타트 부스터가 나가요.'
  const locked = r.phase !== 'racing'

  return (
    <>
      {/* 지금 몇 번째 바퀴인지 (미니맵 아래) */}
      {r.phase === 'racing' && !r.finished && (
        <p className="lap-counter" aria-label={`${r.laps}바퀴 중 ${r.lap}번째 바퀴`}>
          <span className="lap-num">
            {r.lap}
            <small>/{r.laps}</small>
          </span>
          바퀴
        </p>
      )}
      <section className="grid-panel" aria-labelledby="room-title">
        <div className="grid-panel-head">
          <h2 id="room-title" className="grid-panel-title">
            {room.name}
          </h2>
          <span className="grid-panel-count">
            {room.laps}바퀴, {room.members.length}/{GRID_SLOTS}명
          </span>
        </div>
        {racing ? (
          <ol className="grid-list" aria-label="실시간 순위">
            {standings(room, o.myId, o.results).map(({ member: m, time, progress }, i) => (
              <li key={m.id} className={m.id === o.myId ? 'is-me' : undefined}>
                <span className="grid-pos">{i + 1}</span>
                <span className="grid-name">{m.name}</span>
                <span className={`grid-tag ${time !== null ? 'is-done' : ''}`}>
                  {time !== null
                    ? formatTime(time)
                    : `${Math.min(Math.max(Math.floor(progress) + 1, 1), room.laps)}/${room.laps}바퀴`}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          /* 출발 그리드 칸 번호 = 실제 출발 순서 */
          <ol className="grid-list" aria-label="출발 명단">
            {room.members.map((m) => (
              <li key={m.id} className={m.id === o.myId ? 'is-me' : undefined}>
                <span className="grid-pos">{m.slot + 1}</span>
                <span className="grid-name">{m.name}</span>
                {m.id === room.hostId && <span className="grid-tag">방장</span>}
              </li>
            ))}
          </ol>
        )}
        {locked && <p className="grid-hint">출발 전에는 좌우 조향만 할 수 있어요.</p>}
        {footer && <p className="grid-hint">{footer}</p>}
        {room.started && <p className="grid-hint">레이스가 끝나면 방을 나갈 수 있어요.</p>}
        <div className="btn-row">
          {!room.started && (
            <button className="btn btn-quiet" onClick={leaveRoom}>
              방 나가기
            </button>
          )}
          {isHost && r.phase === 'waiting' && (
            <button className="btn btn-primary" onClick={startRace}>
              출발
            </button>
          )}
        </div>
      </section>
    </>
  )
}

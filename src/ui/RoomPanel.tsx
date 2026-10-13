import { useEffect, useRef, useState } from 'react'
import { lapTime, raceProgress } from '../game/race'
import { leaveRoom, peers, setRoomSettings, startRace, toggleReady, type Member, type RoomDetail } from '../net/online'
import type { SpeedClass } from '../physics/vehicle'
import { GRID_SLOTS } from '../track/trackData'
import { formatTime } from './format'
import { useOnline, useRace } from './hooks'
import { SPEED_LABEL } from './LobbyScreen'
import { MAPS } from '../track/maps'
import MapPicker from './MapPicker'

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

/** 지금 바퀴의 랩타임 — 매 프레임 글자만 바꾼다 (리렌더링 없이) */
function LapTime() {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      if (ref.current) ref.current.textContent = formatTime(Math.max(0, lapTime()))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <span className="lap-time" ref={ref} />
}

/** 방 안 (주행 화면 왼쪽 위): 출발 전에는 출발 명단(그리드 순서), 초록불 뒤에는 실시간 순위 */
/** 방장용 태그: 누르면 아래로 고르는 목록이 펼쳐진다 (바깥 클릭 · Esc로 닫힘) */
function TagMenu<T extends string | number>(props: {
  label: string
  value: T
  options: T[]
  text: (v: T) => string
  onPick: (v: T) => void
  className?: string
}) {
  const { label, value, options, text, onPick, className = '' } = props
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div className="tag-menu" ref={box}>
      <button
        type="button"
        className={`tower-laps tag-select ${className}`}
        aria-label={`${label}: ${text(value)}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {text(value)}
      </button>
      {open && (
        <ul className="tag-menu-list" role="menu" aria-label={label}>
          {options.map((v) => (
            <li key={v} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={v === value}
                onClick={() => {
                  setOpen(false)
                  if (v !== value) onPick(v)
                }}
              >
                {text(v)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function RoomPanel() {
  const o = useOnline()
  const r = useRace()
  const room = o.room
  const racing = r.phase === 'racing'
  useTick(racing)
  if (!room) return null
  const isHost = room.hostId === o.myId

  const me = room.members.find((m) => m.id === o.myId)
  // 방장을 뺀 모두가 ready를 눌러야 start 가능 (서버도 같은 규칙으로 막는다)
  const allReady = room.members.every((m) => m.id === room.hostId || m.ready)

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
          <LapTime />
        </p>
      )}
      {isHost && r.phase === 'waiting' && <MapPicker current={room.map} />}
      <section className="grid-panel" aria-labelledby="room-title">
        <div className="grid-panel-head">
          <h2 id="room-title" className="grid-panel-title">
            {room.name}
          </h2>
        </div>
        <div className="tag-row">
          <span className={`tower-laps map-${room.map}`}>{MAPS[room.map]?.name}</span>
          {isHost && r.phase === 'waiting' ? (
            <>
              <TagMenu
                label="바퀴 수"
                value={room.laps}
                options={[1, 2, 3]}
                text={(n) => `${n}바퀴`}
                onPick={(laps) => setRoomSettings({ laps })}
              />
              <TagMenu
                label="속도"
                value={room.speed}
                options={Object.keys(SPEED_LABEL) as SpeedClass[]}
                text={(s) => SPEED_LABEL[s]}
                onPick={(speed) => setRoomSettings({ speed })}
                className={room.speed !== 'normal' ? 'is-fast' : ''}
              />
            </>
          ) : (
            <>
              <span className="tower-laps">{room.laps}바퀴</span>
              <span className={`tower-laps ${room.speed !== 'normal' ? 'is-fast' : ''}`}>{SPEED_LABEL[room.speed]}</span>
            </>
          )}
          <span className="tower-laps">
            {room.members.length}/{GRID_SLOTS}명
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
                {m.id === room.hostId ? (
                  <span className="grid-tag">방장</span>
                ) : (
                  m.ready && <span className="grid-tag is-ready">준비</span>
                )}
              </li>
            ))}
          </ol>
        )}
        <div className="btn-row">
          {!room.started && (
            <button className="btn btn-quiet" onClick={leaveRoom}>
              방 나가기
            </button>
          )}
          {isHost && r.phase === 'waiting' && (
            <button className="btn btn-primary" onClick={startRace} disabled={!allReady}>
              START
            </button>
          )}
          {!isHost && r.phase === 'waiting' && (
            <button
              className={`btn ${me?.ready ? 'btn-quiet' : 'btn-primary'}`}
              onClick={toggleReady}
              aria-pressed={me?.ready ?? false}
            >
              {me?.ready ? 'READY 취소' : 'READY'}
            </button>
          )}
        </div>
      </section>
    </>
  )
}

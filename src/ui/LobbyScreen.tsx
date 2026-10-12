import { useState, type FormEvent } from 'react'
import { clearError, createRoom, joinRoom, type ErrorCode, type RoomSummary } from '../net/online'
import { useOnline } from './hooks'

const ERRORS: Partial<Record<ErrorCode, string>> = {
  roomName: '방 이름은 1~20자로 입력해 주세요.',
  passwordFormat: '비밀번호는 1~20자로 입력해 주세요.',
  tooManyRooms: '지금은 방을 더 만들 수 없어요. 열린 방에 들어가 보세요.',
  notFound: '그 방은 방금 사라졌어요. 목록에서 다른 방을 골라 주세요.',
  full: '8명이 모두 찬 방이라 들어갈 수 없어요.',
  password: '비밀번호가 맞지 않아요. 다시 입력해 주세요.',
  started: '이미 주행 중인 방이에요. 레이스가 끝나면 들어갈 수 있어요.',
}

function LockIcon() {
  return (
    <svg className="lock" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" />
    </svg>
  )
}

/** 방 한 줄: 왼쪽 큰 숫자 = 지금 인원. 비밀 방은 눌렀을 때 비밀번호 칸이 펼쳐진다 */
function RoomRow({ room, open, onOpen }: { room: RoomSummary; open: boolean; onOpen: () => void }) {
  const [password, setPassword] = useState('')
  const full = room.count >= room.max
  // 만석이거나 주행 중인 방은 들어갈 수 없다
  const closed = full || room.started
  const label = `${room.name}, ${room.laps}바퀴, ${room.count}/${room.max}명, ${room.started ? '주행 중' : '출발 전'}${room.locked ? ', 비밀 방' : ''}${full ? ', 만석' : ''}`

  const enter = () => {
    if (closed) return
    if (room.locked) onOpen()
    else joinRoom(room.id)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (password) joinRoom(room.id, password)
  }

  return (
    <li className={`tower-row ${closed ? 'is-full' : ''} ${open ? 'is-open' : ''}`}>
      <button className="tower-main" onClick={enter} disabled={closed} aria-label={label} aria-expanded={room.locked ? open : undefined}>
        <span className="tower-num">
          {room.count}
          <small>/{room.max}</small>
        </span>
        <span className="tower-name">
          {room.locked && <LockIcon />}
          {room.name}
          <span className="tower-laps">{room.laps}바퀴</span>
        </span>
        <span className={`tower-status ${room.started ? 'is-live' : ''}`}>{full ? '만석' : room.started ? '주행 중' : '출발 전'}</span>
      </button>
      {open && (
        <form className="tower-password" onSubmit={submit}>
          <input
            autoFocus
            type="password"
            value={password}
            maxLength={20}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            aria-label={`${room.name} 비밀번호`}
          />
          <button className="btn btn-primary" type="submit" disabled={!password}>
            입장
          </button>
        </form>
      )}
    </li>
  )
}

function CreateRoomForm({ onCancel }: { onCancel: () => void }) {
  const [name, setName] = useState('')
  const [locked, setLocked] = useState(false)
  const [password, setPassword] = useState('')
  const [laps, setLaps] = useState(1)
  const ready = name.trim() !== '' && (!locked || password.trim() !== '')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (ready) createRoom(name.trim(), locked ? password.trim() : null, laps)
  }

  return (
    <form className="field-stack" onSubmit={submit} aria-labelledby="create-title">
      <h2 id="create-title" className="pitwall-title">
        방 만들기
      </h2>
      <label className="field">
        <span className="field-label">방 이름</span>
        <input autoFocus value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="최대 20자" />
      </label>
      <fieldset className="laps-pick">
        <legend className="field-label">바퀴 수</legend>
        {[1, 2, 3].map((n) => (
          <label key={n} className={laps === n ? 'is-on' : undefined}>
            <input type="radio" name="laps" value={n} checked={laps === n} onChange={() => setLaps(n)} />
            <span>{n}바퀴</span>
          </label>
        ))}
      </fieldset>
      <label className="toggle">
        <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />
        <span>비밀 방으로 만들기</span>
      </label>
      {locked && (
        <label className="field">
          <span className="field-label">비밀번호</span>
          <input type="password" value={password} maxLength={20} onChange={(e) => setPassword(e.target.value)} placeholder="입장할 때 필요해요" />
        </label>
      )}
      <div className="btn-row">
        <button className="btn btn-quiet" type="button" onClick={onCancel}>
          취소
        </button>
        <button className="btn btn-primary" type="submit" disabled={!ready}>
          방 만들기
        </button>
      </div>
    </form>
  )
}

/** 대기실: 열린 방 목록(타이밍 타워) + 방 만들기 */
export default function LobbyScreen() {
  const o = useOnline()
  const [creating, setCreating] = useState(false)
  const [openRoom, setOpenRoom] = useState<string | null>(null)
  const error = o.error && ERRORS[o.error.code]

  return (
    <section className="pitwall" aria-labelledby="lobby-title">
      {creating ? (
        <CreateRoomForm
          onCancel={() => {
            setCreating(false)
            clearError()
          }}
        />
      ) : (
        <>
          <div className="pitwall-head">
            <h2 id="lobby-title" className="pitwall-title">
              대기실
            </h2>
            <span className="pitwall-me">{o.name}</span>
          </div>
          {o.rooms.length === 0 ? (
            <p className="tower-empty">아직 열린 방이 없어요. 첫 방을 만들고 친구를 불러 보세요.</p>
          ) : (
            <ul className="tower" aria-label="열린 방">
              {o.rooms.map((r) => (
                <RoomRow key={r.id} room={r} open={openRoom === r.id} onOpen={() => setOpenRoom(openRoom === r.id ? null : r.id)} />
              ))}
            </ul>
          )}
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            방 만들기
          </button>
        </>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {o.status === 'closed' && (
        <p className="notice" role="status">
          서버와 연결이 끊겼어요. 다시 연결하는 중이에요.
        </p>
      )}
    </section>
  )
}

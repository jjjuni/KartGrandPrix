import { useState, type FormEvent } from 'react'
import { unlockAudio } from '../game/sound'
import { enterWithName } from '../net/online'
import { useOnline } from './hooks'

const MAX_NAME = 12

/** 첫 화면: 닉네임을 정하고 대기실로 */
export default function EntryScreen() {
  const o = useOnline()
  const [name, setName] = useState('')
  const trimmed = name.trim()
  const waiting = o.status === 'connecting' && trimmed !== ''

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!trimmed) return
    unlockAudio() // 이 클릭 이후로 출발 신호음을 낼 수 있다
    enterWithName(trimmed)
  }

  return (
    <section className="pitwall" aria-labelledby="entry-title">
      <h1 id="entry-title" className="wordmark">
        Kart Grand Prix
      </h1>
      <p className="pitwall-lead">레이스에서 쓸 닉네임을 정해 주세요. 같은 방 사람들의 출발 명단에 이 이름이 보여요.</p>

      <form className="field-stack" onSubmit={submit}>
        <label className="field">
          <span className="field-label">닉네임</span>
          <input
            autoFocus
            value={name}
            maxLength={MAX_NAME}
            onChange={(e) => setName(e.target.value)}
            placeholder="최대 12자"
            autoComplete="nickname"
          />
        </label>
        <button className="btn btn-primary" type="submit" disabled={!trimmed || waiting}>
          {waiting ? '서버에 연결하는 중…' : '대기실로 입장'}
        </button>
        {o.status === 'closed' && (
          <p className="notice" role="status">
            서버에 연결할 수 없어요. 3초마다 다시 시도하고 있어요.
          </p>
        )}
        {o.error?.code === 'name' && (
          <p className="notice" role="alert">
            닉네임은 1~12자로 입력해 주세요.
          </p>
        )}
      </form>
    </section>
  )
}

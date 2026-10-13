import { useState, type FormEvent } from 'react'
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
    enterWithName(trimmed)
  }

  return (
    <section className="pitwall" aria-labelledby="entry-title">
      <h1 id="entry-title" className="wordmark">
        Kart Grand Prix
      </h1>
      <form className="field-stack" onSubmit={submit}>
        <label className="field">
          <span className="field-label">닉네임</span>
          <input
            autoFocus
            value={name}
            maxLength={MAX_NAME}
            onChange={(e) => setName(e.target.value)}
            autoComplete="nickname"
            placeholder="닉네임을 입력해주세요"
          />
        </label>
        <button className="btn btn-primary" type="submit" disabled={!trimmed || waiting}>
          {waiting ? '연결 중…' : '입장'}
        </button>
        {o.status === 'closed' && (
          <p className="notice" role="status">
            서버에 연결할 수 없어요
          </p>
        )}
        {o.error?.code === 'name' && (
          <p className="notice" role="alert">
            닉네임은 1~12자
          </p>
        )}
      </form>
    </section>
  )
}

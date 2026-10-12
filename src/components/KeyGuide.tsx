import { useEffect, useState } from 'react'

const STORAGE_KEY = 'kart.keyGuide.hidden'

/** 좌측 하단 조작 안내. H로 접고 펼친다 (브라우저에 기억) */
const ROWS: { keys: string[]; joiner?: string; label: string }[] = [
  { keys: ['W', 'A', 'S', 'D'], label: '운전' },
  { keys: ['Space'], label: '브레이크' },
  { keys: ['Shift', '←→'], joiner: '+', label: '드리프트' },
  { keys: ['↑'], label: '순간 부스터 (드리프트 직후)' },
  { keys: ['↑', 'Z'], joiner: '+', label: '게이지 가득: 부스터' },
  { keys: ['R'], label: '트랙으로 복귀' },
]

function readHidden() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export default function KeyGuide() {
  const [hidden, setHidden] = useState(readHidden)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyH' || e.repeat) return
      setHidden((h) => {
        try {
          localStorage.setItem(STORAGE_KEY, h ? '0' : '1')
        } catch {
          // 저장이 막혀 있어도 이번 세션에서는 동작
        }
        return !h
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (hidden) {
    return (
      <div className="keyguide collapsed">
        <kbd>H</kbd> 조작법
      </div>
    )
  }

  return (
    <div className="keyguide">
      <dl>
        {ROWS.map(({ keys, joiner, label }) => (
          <div className="keyguide-row" key={label}>
            <dt>
              {keys.map((k, i) => (
                <span key={k}>
                  {i > 0 && joiner && <span className="keyguide-join">{joiner}</span>}
                  <kbd className={k.length > 2 ? 'wide' : ''}>{k}</kbd>
                </span>
              ))}
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
      <p className="keyguide-hint">
        <kbd>H</kbd> 접기
      </p>
    </div>
  )
}

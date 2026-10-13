import { useEffect, useMemo, useRef } from 'react'
import { kartState } from '../game/kartState'
import { KART } from '../physics/vehicle'
import { useOnline } from '../ui/hooks'

/**
 * 하단 중앙 계기판: 반원형 아날로그 속도계(눈금은 방 속도 등급에 맞춤) + 디지털 속도 + 기어(P/R/D)
 * + 다이얼 아래 받침에 직선형 부스터 게이지. requestAnimationFrame으로 DOM을 직접 갱신해 리렌더링이 없다.
 */

const CX = 130
const CY = 126
const R = 104 // 눈금 바깥 반지름
const START = 180 // 0km/h 각도 (SVG: +x 기준 시계 방향, 도) — 왼쪽
const SWEEP = 180 // 왼쪽 → 위 → 오른쪽 반원

/**
 * 눈금 범위: 끝 = 부스터 최고속도 + 여유를 숫자 간격(20, 빠르면 40)의 배수로 올림. 기본 140 · 빠름 180 · 매우 빠름 240.
 * normal = 엔진 최고속도 — 여기부터는 부스터로만 닿는 구간 (하늘색)
 */
function makeDial() {
  const raw = KART.boostMaxSpeed * 3.6 + 10
  const label = raw > 180 ? 40 : 20
  const max = Math.ceil(raw / label) * label
  const tick = label / 4
  return { max, normal: KART.maxSpeed * 3.6, label, ticks: Array.from({ length: max / tick + 1 }, (_, i) => i * tick) }
}
type Dial = ReturnType<typeof makeDial>
const angleOf = (kmh: number, max: number) => START + (SWEEP * Math.min(Math.max(kmh, 0), max)) / max
const polar = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)] as const
}
const arc = (r: number, from: number, to: number, clockwise = true) => {
  const [x1, y1] = polar(r, from)
  const [x2, y2] = polar(r, to)
  const large = Math.abs(to - from) > 180 ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} ${clockwise ? 1 : 0} ${x2} ${y2}`
}

/** 위는 반원, 아래는 모서리가 둥근 직사각형 받침인 계기판 외곽 */
const BASE = 58 // 지름선 아래 받침 높이
const housing = (r: number, inset: number) => {
  const l = CX - r
  const rt = CX + r
  const b = CY + BASE - inset
  const c = 12 - inset // 아래 모서리 둥글기
  return `M ${l} ${CY} A ${r} ${r} 0 0 1 ${rt} ${CY} L ${rt} ${b - c} Q ${rt} ${b} ${rt - c} ${b} L ${l + c} ${b} Q ${l} ${b} ${l} ${b - c} Z`
}

const NEEDLE_IN = 62 // 바늘은 중앙 디지털 표시를 가리지 않게 이 반지름부터 그린다
const BAR_X = 40
const BAR_W = CX * 2 - BAR_X * 2
const BAR_Y = CY + 24
const BAR_H = 9

export default function Hud() {
  const root = useRef<HTMLDivElement>(null)
  const needle = useRef<SVGGElement>(null)
  const speed = useRef<SVGTextElement>(null)
  const gears = useRef<SVGTextElement[]>([])
  const boostFill = useRef<SVGRectElement>(null)
  const boostLabel = useRef<SVGTextElement>(null)
  const status = useRef<HTMLDivElement>(null)
  // 방 속도 등급이 바뀌면(방 입장 · 대기실) 눈금을 다시 그린다. 바늘은 매 프레임 ref로 최신 범위를 읽는다
  const o = useOnline()
  const dial: Dial = useMemo(makeDial, [o.room?.speed])
  const maxRef = useRef(dial.max)
  maxRef.current = dial.max

  useEffect(() => {
    let raf = 0
    let shown = -1
    const tick = () => {
      const s = kartState
      const kmh = Math.abs(s.speedKmh)
      needle.current?.setAttribute('transform', `rotate(${angleOf(kmh, maxRef.current)} ${CX} ${CY})`)
      const rounded = Math.round(kmh)
      if (speed.current && rounded !== shown) {
        speed.current.textContent = String(rounded)
        shown = rounded
      }
      gears.current.forEach((g) => g.classList.toggle('on', g.dataset.gear === s.gear))

      // 부스터 게이지: 충전 중(앰버) → 가득(하늘색, Z 안내) → 사용 중(남은 시간)
      const usingFull = s.boostKind === 'full'
      const fill = Math.min(Math.max(usingFull ? s.boostTime / s.boostDuration : s.gauge, 0), 1)
      boostFill.current?.setAttribute('width', String(BAR_W * fill))
      const ready = !usingFull && s.gauge >= 1
      root.current?.classList.toggle('ready', ready)
      root.current?.classList.toggle('boosting', s.boostTime > 0)
      if (boostLabel.current) {
        boostLabel.current.textContent = usingFull ? '부스터 사용 중' : ready ? 'Z  부스터 준비' : '부스터'
      }

      // 상태 표시: 코스 이탈 경고만 (드리프트·부스터 관련 메시지는 표시하지 않음)
      const text = s.offRoad ? '코스 이탈' : ''
      if (status.current) {
        status.current.textContent = text
        status.current.dataset.tone = text ? 'warn' : ''
        status.current.hidden = !text
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="cluster" ref={root}>
      <div className="cluster-status" ref={status} hidden />
      <svg viewBox={`0 0 260 ${CY + BASE + 2}`} role="img" aria-label="속도계와 부스터 게이지">
        <defs>
          <radialGradient id="dial-face" cx="50%" cy="70%" r="75%">
            <stop offset="0%" stopColor="#323a43" />
            <stop offset="100%" stopColor="#1a1f25" />
          </radialGradient>
          <linearGradient id="dial-bezel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c9d0d7" />
            <stop offset="45%" stopColor="#6d7680" />
            <stop offset="100%" stopColor="#2b3138" />
          </linearGradient>
          <filter id="glow" x="-20%" y="-200%" width="140%" height="500%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* 베젤 + 다이얼 면 (반원 + 받침) */}
        <path d={housing(124, 0)} fill="url(#dial-bezel)" />
        <path d={housing(119, 5)} fill="url(#dial-face)" />

        {/* 부스터로만 닿는 구간 (100~140) */}
        <path d={arc(R - 3, angleOf(dial.normal, dial.max), angleOf(dial.max, dial.max))} className="dial-boost-zone" />

        {/* 눈금 */}
        {dial.ticks.map((v) => {
          const major = v % dial.label === 0
          const mid = v % (dial.label / 2) === 0
          const len = major ? 13 : mid ? 8 : 4
          const [x1, y1] = polar(R, angleOf(v, dial.max))
          const [x2, y2] = polar(R - len, angleOf(v, dial.max))
          return (
            <line
              key={v}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className={`dial-tick ${major ? 'major' : ''} ${v > dial.normal ? 'boost' : ''}`}
            />
          )
        })}
        {dial.ticks
          .filter((v) => v % dial.label === 0)
          .map((v) => {
            const [x, y] = polar(R - 27, angleOf(v, dial.max))
            return (
              <text key={v} x={x} y={y} className={`dial-num ${v > dial.normal ? 'boost' : ''}`}>
                {v}
              </text>
            )
          })}

        {/* 디지털 속도 + 기어 (반원 중앙) */}
        {(['P', 'R', 'D'] as const).map((g, i) => (
          <text
            key={g}
            x={CX + (i - 1) * 18}
            y={CY - 50}
            data-gear={g}
            className="dial-gear"
            ref={(el) => {
              if (el) gears.current[i] = el
            }}
          >
            {g}
          </text>
        ))}
        <text x={CX} y={CY - 4} className="dial-speed" ref={speed}>
          0
        </text>
        <text x={CX} y={CY + 10} className="dial-unit">
          km/h
        </text>

        {/* 바늘 (0km/h 방향으로 그린 뒤 회전) */}
        <g ref={needle} transform={`rotate(${START} ${CX} ${CY})`}>
          <polygon
            points={`${CX + NEEDLE_IN},${CY - 2.5} ${CX + R - 8},${CY - 1} ${CX + R - 8},${CY + 1} ${CX + NEEDLE_IN},${CY + 2.5}`}
            className="dial-needle"
          />
        </g>

        {/* 부스터 게이지 (받침의 직선 바) */}
        <rect x={BAR_X} y={BAR_Y} width={BAR_W} height={BAR_H} rx={BAR_H / 2} className="boost-track" />
        <rect x={BAR_X} y={BAR_Y} width={0} height={BAR_H} rx={BAR_H / 2} className="boost-fill" ref={boostFill} />
        <text x={CX} y={CY + 48} className="boost-label" ref={boostLabel}>
          부스터
        </text>
      </svg>
    </div>
  )
}

import { useEffect, useMemo, useRef } from 'react'
import { kartState } from '../game/kartState'
import { peers } from '../net/online'
import { peerColor } from './RemoteKarts'
import { BRANCH_WIDTH, ROAD_WIDTH, branchPoints, centerPoints, frames } from '../track/trackData'

const SIZE = 180
const PAD = 14

/**
 * 우측 상단 미니맵 (위에서 내려다본 모습, 방향 고정).
 * 카메라 기준 화면 오른쪽이 월드 -X라서 지도도 x = -월드X, y = -월드Z로 그려 좌우가 뒤집히지 않게 한다.
 */
export default function Minimap() {
  const { path, branch, scale, toMap, start } = useMemo(() => {
    const xs = centerPoints.map((p) => -p.x)
    const ys = centerPoints.map((p) => -p.z)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const scale = (SIZE - PAD * 2) / Math.max(maxX - minX, maxY - minY)
    const ox = PAD + (SIZE - PAD * 2 - (maxX - minX) * scale) / 2
    const oy = PAD + (SIZE - PAD * 2 - (maxY - minY) * scale) / 2
    const toMap = (x: number, z: number) => [ox + (-x - minX) * scale, oy + (-z - minY) * scale] as const

    const pts = centerPoints.filter((_, i) => i % 4 === 0).map((p) => toMap(p.x, p.z))
    const path = `M ${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')} Z`

    // 출발선: 도로를 가로지르는 짧은 선
    const p0 = centerPoints[0]
    const l0 = frames[0].left
    const half = ROAD_WIDTH / 2 + 1
    const start = [toMap(p0.x + l0.x * half, p0.z + l0.z * half), toMap(p0.x - l0.x * half, p0.z - l0.z * half)]
    const bp = branchPoints.filter((_, i) => i % 4 === 0).map((p) => toMap(p.x, p.z))
    const branch = bp.length ? `M ${bp.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')}` : ''
    return { path, branch, scale, toMap, start }
  }, [])

  const marker = useRef<SVGGElement>(null)
  const others = useRef<SVGGElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const [x, y] = toMap(kartState.position.x, kartState.position.z)
      // 진행 방향: 월드 +Z(지도 위)에서 +X(지도 왼쪽)로 도는 각 → 지도에서는 반시계 회전
      const deg = (-kartState.heading * 180) / Math.PI
      marker.current?.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg.toFixed(1)})`)
      // 다른 사람: 카트 색 점 (들어오면 만들고, 나가면 지운다)
      const g = others.current
      if (g) {
        for (const dot of [...g.children]) if (!peers.has(Number((dot as SVGElement).dataset.id))) dot.remove()
        for (const [id, s] of peers) {
          let dot = g.querySelector<SVGCircleElement>(`[data-id="${id}"]`)
          if (!dot) {
            dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
            dot.dataset.id = String(id)
            dot.setAttribute('r', '4')
            dot.setAttribute('class', 'minimap-peer')
            dot.setAttribute('fill', peerColor(id))
            g.appendChild(dot)
          }
          const [px, py] = toMap(s.x, s.z)
          dot.setAttribute('cx', px.toFixed(1))
          dot.setAttribute('cy', py.toFixed(1))
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [toMap])

  const road = Math.max(3, ROAD_WIDTH * scale)
  return (
    <div className="minimap">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="미니맵">
        <path d={path} className="minimap-edge" strokeWidth={road + 3} />
        <path d={path} className="minimap-road" strokeWidth={road} />
        {branch && (
          <>
            <path d={branch} className="minimap-edge" strokeWidth={Math.max(2, BRANCH_WIDTH * scale) + 3} />
            <path d={branch} className="minimap-road" strokeWidth={Math.max(2, BRANCH_WIDTH * scale)} />
          </>
        )}
        <line x1={start[0][0]} y1={start[0][1]} x2={start[1][0]} y2={start[1][1]} className="minimap-start" />
        <g ref={others} />
        {/* 내 카트는 맨 위에 */}
        <g ref={marker}>
          <polygon points="0,-7 5,5 0,2.5 -5,5" className="minimap-kart" />
        </g>
      </svg>
    </div>
  )
}

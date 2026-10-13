import { useMemo, useRef } from 'react'
import { CatmullRomCurve3, Vector3 } from 'three'
import { setRoomSettings } from '../net/online'
import { MAPS, MAP_IDS, type MapId } from '../track/maps'

const SIZE = 100
const PAD = 10

/** 맵의 코스 모양 (미니맵과 같은 방향: x = -월드X, y = -월드Z) — 트랙 전체를 계산하지 않고 제어점 곡선만 */
function coursePath(id: MapId) {
  const pts = new CatmullRomCurve3(
    MAPS[id].controlPoints.map(([x, z]) => new Vector3(-x, 0, -z)),
    true,
    'centripetal',
  ).getSpacedPoints(160)
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.z)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const scale = (SIZE - PAD * 2) / Math.max(maxX - minX, maxY - minY)
  const ox = PAD + (SIZE - PAD * 2 - (maxX - minX) * scale) / 2
  const oy = PAD + (SIZE - PAD * 2 - (maxY - minY) * scale) / 2
  const xy = pts.map((p) => [ox + (p.x - minX) * scale, oy + (p.z - minY) * scale])
  return { d: `M ${xy.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')} Z`, start: xy[0] }
}

/** 미니맵 아래 "맵 선택" 버튼 + 맵 카드 그리드 모달 (방장 · 출발 전에만) */
export default function MapPicker({ current }: { current: MapId }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const courses = useMemo(() => MAP_IDS.map((id) => ({ id, ...coursePath(id) })), [])
  const pick = (id: MapId) => {
    if (id !== current) setRoomSettings({ map: id })
    dialog.current?.close()
  }
  return (
    <>
      <button type="button" className="btn btn-quiet map-pick-open" onClick={() => dialog.current?.showModal()}>
        맵 선택
      </button>
      <dialog
        ref={dialog}
        className="map-dialog"
        aria-labelledby="map-dialog-title"
        // 바깥(배경)을 누르면 닫힘
        onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
      >
        <h2 id="map-dialog-title" className="grid-panel-title">
          맵 선택
        </h2>
        <ul className="map-list">
          {courses.map(({ id, d, start }) => (
            <li key={id}>
              <button
                type="button"
                className="map-item"
                aria-pressed={id === current}
                onClick={() => pick(id)}
                style={{ borderBottomColor: MAPS[id].theme.walls[0] }}
              >
                <svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" style={{ background: `color-mix(in srgb, ${MAPS[id].theme.ground.b} 45%, transparent)` }}>
                  <path d={d} className="minimap-edge" strokeWidth={6} />
                  <path d={d} className="minimap-road" strokeWidth={4} />
                  <circle cx={start[0]} cy={start[1]} r={3.5} className="map-start-dot" />
                </svg>
                <span>{MAPS[id].name}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="btn-row">
          <button type="button" className="btn btn-quiet" onClick={() => dialog.current?.close()}>
            닫기
          </button>
        </div>
      </dialog>
    </>
  )
}

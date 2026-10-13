import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { makeCanvasTexture, seededRandom } from '../utils/canvasTexture'
import { ICE_RANGES, ROAD_WIDTH, SAMPLE_SPACING, centerPoints, frames, indexAtS } from './trackData'

const LIFT = 0.07 // 도로 메시(0.06)보다 살짝 위
const WIDTH = ROAD_WIDTH / 2 - 0.75 // 도로 절반 (가장자리 흰 선은 보이게)
const TEXTURE_LENGTH = 10 // 텍스처 한 장이 덮는 길이 (m)

/** 얼음 표면: 푸른 바탕 + 하얀 서리 얼룩 + 가는 금 */
function makeIceTexture() {
  return makeCanvasTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#b9dcf2'
      ctx.fillRect(0, 0, w, h)
      const rand = seededRandom(31)
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.15 + rand() * 0.25})`
        ctx.beginPath()
        ctx.ellipse(rand() * w, rand() * h, 10 + rand() * 30, 4 + rand() * 12, rand() * Math.PI, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'
      ctx.lineWidth = 1
      for (let i = 0; i < 18; i++) {
        let x = rand() * w
        let y = rand() * h
        ctx.beginPath()
        ctx.moveTo(x, y)
        for (let k = 0; k < 5; k++) ctx.lineTo((x += (rand() - 0.5) * 50), (y += (rand() - 0.5) * 50))
        ctx.stroke()
      }
    },
    true,
  )
}

/** 빙판 구간 하나: 중심선부터 side쪽 가장자리까지 [시작 s, 끝 s]를 덮는 띠 (양 끝은 둥글게 줄어든다) */
function makeStrip(start: number, end: number, side: number) {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const n = centerPoints.length
  const i0 = indexAtS(start)
  const count = Math.max(2, Math.round((end - start) / SAMPLE_SPACING))
  for (let k = 0; k <= count; k++) {
    const i = (i0 + k) % n
    const p = centerPoints[i]
    const { left } = frames[i]
    const t = k / count
    const half = (WIDTH / 2) * Math.sin(Math.PI * Math.min(1, t * 6, (1 - t) * 6) * 0.5) // 끝부분을 좁게
    const c = side * (WIDTH / 2) // 띠 가운데: 그쪽 절반의 한가운데
    const lo = c + half
    const hi = c - half
    positions.push(p.x + left.x * lo, p.y + LIFT, p.z + left.z * lo, p.x + left.x * hi, p.y + LIFT, p.z + left.z * hi)
    const v = (k * SAMPLE_SPACING) / TEXTURE_LENGTH
    uvs.push(0, v, 1, v)
    if (k < count) {
      const a = k * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

/** 극지 맵의 빙판: 이 구간의 도로는 미끄럽다 (판정은 surface.ts → vehicle.ts) */
export default function IcePatches() {
  const texture = useMemo(makeIceTexture, [])
  const strips = useMemo(() => ICE_RANGES.map(([a, b, side]) => makeStrip(a, b, side)), [])
  if (strips.length === 0) return null
  return (
    <>
      {strips.map((geo, i) => (
        <mesh key={i} geometry={geo} receiveShadow>
          <meshStandardMaterial
            map={texture}
            roughness={0.08}
            metalness={0.2}
            transparent
            opacity={0.85}
            polygonOffset
            polygonOffsetFactor={-3}
            polygonOffsetUnits={-3}
          />
        </mesh>
      ))}
    </>
  )
}

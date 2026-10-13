import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  IcosahedronGeometry,
  type Group,
  type Points,
} from 'three'
import { makeCanvasTexture, seededRandom } from '../utils/canvasTexture'
import { currentMap, trackBounds } from './trackData'

// ---------------------------------------------------------------------------
// 날씨: 카메라를 따라다니는 상자 안의 입자 (사막 모래먼지 · 극지 눈)
// ---------------------------------------------------------------------------
const BOX = { x: 70, y: 28, z: 70 } // 카메라 주변 입자 범위 (m)
/** 카메라에 이보다 가까운 입자는 위·아래로 밀어낸다 — 렌즈 바로 앞 입자는 원근 때문에 하늘을 덮는 큰 얼룩으로 보인다 */
const NEAR = 4

/** 입자 모양: 가운데가 진하고 가장자리가 흐린 동그라미 (기본은 네모) */
function makeDot() {
  return makeCanvasTexture(32, 32, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.5, 'rgba(255,255,255,0.7)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  })
}

function Weather({ kind }: { kind: 'dust' | 'snow' }) {
  const group = useRef<Group>(null)
  const points = useRef<Points>(null)
  const count = kind === 'snow' ? 2200 : 1400
  const dot = useMemo(makeDot, [])
  const { geometry, offsets, speeds } = useMemo(() => {
    const rand = seededRandom(kind === 'snow' ? 5 : 9)
    const offsets = new Float32Array(count * 3)
    const speeds = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      offsets[i * 3] = (rand() - 0.5) * BOX.x
      offsets[i * 3 + 1] = (rand() - 0.5) * BOX.y
      offsets[i * 3 + 2] = (rand() - 0.5) * BOX.z
      speeds[i] = 0.6 + rand() * 0.8
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(offsets, 3))
    return { geometry, offsets, speeds }
  }, [kind, count])

  useFrame(({ camera, clock }, dt) => {
    const g = group.current
    if (!g) return
    // 입자 상자를 카메라에 붙여 두고, 입자는 상자 안에서 움직이다 넘어가면 반대편으로
    g.position.copy(camera.position)
    const t = clock.elapsedTime
    const wrap = (v: number, size: number) => ((((v + size / 2) % size) + size) % size) - size / 2
    for (let i = 0; i < count; i++) {
      const k = i * 3
      if (kind === 'snow') {
        offsets[k] += Math.sin(t * 0.7 + i) * 0.3 * dt // 살랑살랑
        offsets[k + 1] -= 2.2 * speeds[i] * dt // 내려옴
      } else {
        offsets[k] += 14 * speeds[i] * dt // 바람에 옆으로 날림
        offsets[k + 1] += Math.sin(t * 2 + i) * 0.6 * dt
        offsets[k + 2] += 4 * speeds[i] * dt
      }
      offsets[k] = wrap(offsets[k], BOX.x)
      offsets[k + 1] = wrap(offsets[k + 1], BOX.y)
      offsets[k + 2] = wrap(offsets[k + 2], BOX.z)
      if (offsets[k] ** 2 + offsets[k + 1] ** 2 + offsets[k + 2] ** 2 < NEAR * NEAR) offsets[k + 1] = offsets[k + 1] < 0 ? -NEAR : NEAR
    }
    geometry.attributes.position.needsUpdate = true
  })

  return (
    <group ref={group}>
      <points ref={points} geometry={geometry} frustumCulled={false}>
        <pointsMaterial
          color={kind === 'snow' ? '#ffffff' : '#d9b27a'}
          map={dot}
          size={kind === 'snow' ? 0.12 : 0.09}
          transparent
          opacity={kind === 'snow' ? 0.9 : 0.55}
          depthWrite={false}
        />
      </points>
    </group>
  )
}

// ---------------------------------------------------------------------------
// 멀리 보이는 지형지물 — 안개 너머에서도 실루엣이 보이도록 fog 끔
// ---------------------------------------------------------------------------
function Landmarks({ kind }: { kind: 'pyramids' | 'icebergs' }) {
  const b = trackBounds
  const cx = (b.minX + b.maxX) / 2
  const cz = (b.minZ + b.maxZ) / 2
  const reach = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 420

  if (kind === 'pyramids') {
    // 북서쪽 지평선에 크기가 다른 피라미드 셋
    const list: [number, number, number][] = [
      [-0.75, 0.55, 140],
      [-0.55, 0.8, 100],
      [-0.9, 0.3, 75],
    ]
    return (
      <>
        {list.map(([dx, dz, h], i) => (
          <mesh key={i} position={[cx + dx * reach, h / 2 - 4, cz + dz * reach]} rotation={[0, 0.4 + i * 0.3, 0]}>
            <coneGeometry args={[h * 0.78, h, 4]} />
            <meshStandardMaterial color="#c79a5f" flatShading fog={false} roughness={1} />
          </mesh>
        ))}
      </>
    )
  }

  // 극지: 지평선을 둘러싼 빙산들
  return <Icebergs cx={cx} cz={cz} reach={reach} />
}

function Icebergs({ cx, cz, reach }: { cx: number; cz: number; reach: number }) {
  const items = useMemo(() => {
    const rand = seededRandom(77)
    return Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2 + rand() * 0.3
      const r = reach * (0.95 + rand() * 0.25)
      const geo = new IcosahedronGeometry(1, 1)
      // 꼭짓점을 흔들어 들쭉날쭉한 얼음 덩어리로
      const pos = geo.getAttribute('position')
      for (let k = 0; k < pos.count; k++) {
        const s = 0.75 + rand() * 0.5
        pos.setXYZ(k, pos.getX(k) * s, Math.max(-0.2, pos.getY(k)) * s * 1.6, pos.getZ(k) * s)
      }
      geo.computeVertexNormals()
      return { geo, x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, size: 30 + rand() * 50, rot: rand() * Math.PI }
    })
  }, [cx, cz, reach])
  return (
    <>
      {items.map((it, i) => (
        <mesh key={i} geometry={it.geo} position={[it.x, -6, it.z]} scale={it.size} rotation={[0, it.rot, 0]}>
          <meshStandardMaterial color="#dff1fb" flatShading fog={false} roughness={0.35} metalness={0.05} />
        </mesh>
      ))}
    </>
  )
}

/** 맵 분위기: 날씨 · 멀리 보이는 지형지물 (맵 정의의 theme에 따라) */
export default function MapAtmosphere() {
  const t = currentMap.theme
  return (
    <>
      {t.weather !== 'none' && <Weather kind={t.weather} />}
      {t.landmark !== 'none' && <Landmarks kind={t.landmark} />}
    </>
  )
}

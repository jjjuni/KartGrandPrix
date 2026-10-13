import { useLayoutEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Object3D,
  SphereGeometry,
  type InstancedMesh,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { seededRandom } from '../utils/canvasTexture'
import { isInGrandstand } from './Grandstand'
import { terrainHeightAt } from './terrain'
import type { ScatterKind } from './maps'
import {
  SAMPLE_SPACING,
  TUNNEL,
  WALL_OFFSET,
  currentMap,
  nearestSample,
  trackBounds,
} from './trackData'

const MARGIN = 180 // 코스 바깥으로 장식을 흩어 놓는 거리 (m)

/** 부품 하나: 꼭짓점 색을 칠하고 제자리에 놓는다 (서로 다른 색 부품을 한 지오메트리로 합치기 위해) */
function part(geo: BufferGeometry, color: string, [x, y, z]: [number, number, number], jitter = 0, seed = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo
  g.translate(x, y, z)
  const pos = g.getAttribute('position')
  // 꼭짓점을 살짝 흔들어 로우폴리 특유의 울퉁불퉁한 실루엣을 만든다
  if (jitter > 0) {
    const rand = seededRandom(seed)
    const moved = new Map<string, [number, number, number]>()
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`
      let d = moved.get(key)
      if (!d) moved.set(key, (d = [(rand() - 0.5) * jitter, (rand() - 0.5) * jitter, (rand() - 0.5) * jitter]))
      pos.setXYZ(i, pos.getX(i) + d[0], pos.getY(i) + d[1], pos.getZ(i) + d[2])
    }
  }
  const c = new Color(color)
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) colors.set([c.r, c.g, c.b], i * 3)
  g.setAttribute('color', new Float32BufferAttribute(colors, 3))
  g.deleteAttribute('uv')
  return g
}

function build(parts: BufferGeometry[]) {
  const g = mergeGeometries(parts)!
  g.computeVertexNormals() // 인덱스 없는 지오메트리 → 면마다 평평한 법선
  return g
}

/** 원뿔 4단 침엽수 */
const pine = () =>
  build([
    part(new CylinderGeometry(0.16, 0.26, 2, 6), '#5d4037', [0, 1, 0]),
    part(new ConeGeometry(2.0, 2.6, 8), '#2e6b3a', [0, 2.6, 0], 0.25, 11),
    part(new ConeGeometry(1.6, 2.3, 8), '#357a40', [0, 3.8, 0], 0.22, 12),
    part(new ConeGeometry(1.15, 2.0, 8), '#3d8746', [0, 4.9, 0], 0.18, 13),
    part(new ConeGeometry(0.65, 1.4, 7), '#46924e', [0, 5.9, 0], 0.1, 14),
  ])

/** 둥근 잎 뭉치 활엽수 */
const broadleaf = () =>
  build([
    part(new CylinderGeometry(0.18, 0.3, 2.6, 7), '#6d4c41', [0, 1.3, 0]),
    part(new CylinderGeometry(0.07, 0.1, 1.2, 5).rotateZ(0.7), '#6d4c41', [0.45, 2.5, 0]),
    part(new IcosahedronGeometry(1.7, 1), '#5c9e3c', [0, 3.7, 0], 0.35, 21),
    part(new IcosahedronGeometry(1.2, 1), '#6aab45', [1.1, 3.2, 0.3], 0.3, 22),
    part(new IcosahedronGeometry(1.1, 1), '#549436', [-0.9, 3.4, -0.5], 0.3, 23),
    part(new IcosahedronGeometry(0.9, 1), '#73b54d', [0.2, 4.8, 0.2], 0.25, 24),
  ])

const bush = () =>
  build([
    part(new IcosahedronGeometry(0.8, 1).scale(1.3, 0.75, 1), '#4f8f37', [0, 0.45, 0], 0.18, 31),
    part(new IcosahedronGeometry(0.55, 1), '#5ea142', [0.6, 0.45, 0.2], 0.12, 32),
    part(new IcosahedronGeometry(0.5, 1), '#478530', [-0.5, 0.4, -0.25], 0.12, 33),
  ])

const rock = () =>
  build([
    part(new DodecahedronGeometry(0.9, 0).scale(1.3, 0.7, 1), '#8a8d91', [0, 0.35, 0], 0.3, 41),
    part(new DodecahedronGeometry(0.5, 0), '#9a9da1', [0.9, 0.15, 0.3], 0.2, 42),
  ])

// ---- 사막 ----
/** 사구아로 선인장: 줄기 + 양쪽으로 꺾여 올라가는 팔 */
const cactus = () =>
  build([
    part(new CylinderGeometry(0.32, 0.38, 4.2, 8), '#4f8a3a', [0, 2.1, 0], 0.04, 51),
    part(new SphereGeometry(0.32, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#5c9a44', [0, 4.2, 0]),
    part(new CylinderGeometry(0.2, 0.2, 0.9, 7).rotateZ(Math.PI / 2), '#4f8a3a', [0.6, 2.0, 0]),
    part(new CylinderGeometry(0.2, 0.22, 1.4, 7), '#4f8a3a', [1.02, 2.65, 0]),
    part(new SphereGeometry(0.2, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2), '#5c9a44', [1.02, 3.35, 0]),
    part(new CylinderGeometry(0.18, 0.18, 0.7, 7).rotateZ(Math.PI / 2), '#4f8a3a', [-0.5, 2.7, 0]),
    part(new CylinderGeometry(0.18, 0.2, 1.0, 7), '#4f8a3a', [-0.82, 3.15, 0]),
    part(new SphereGeometry(0.18, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2), '#5c9a44', [-0.82, 3.65, 0]),
  ])

/** 붉은 사암 바위기둥 (층이 진 후두) */
const redRock = () =>
  build([
    part(new DodecahedronGeometry(1.6, 0).scale(1.2, 0.8, 1), '#b5562e', [0, 0.8, 0], 0.4, 61),
    part(new DodecahedronGeometry(1.1, 0).scale(1, 1.4, 0.9), '#c9693a', [0.2, 2.6, 0.1], 0.3, 62),
    part(new DodecahedronGeometry(0.8, 0).scale(1.3, 0.6, 1.2), '#a64b26', [0.1, 4.0, 0], 0.2, 63),
  ])

/** 마른 덤불 (굴러다니는 회전초 느낌) */
const dryBush = () =>
  build([
    part(new IcosahedronGeometry(0.7, 1).scale(1.2, 0.8, 1), '#9a7a4a', [0, 0.5, 0], 0.25, 71),
    part(new IcosahedronGeometry(0.45, 1), '#8a6a3c', [0.5, 0.4, 0.2], 0.15, 72),
  ])

// ---- 극지 ----
/** 눈 쌓인 침엽수: 원뿔마다 위쪽에 흰 눈 */
const snowPine = () =>
  build([
    part(new CylinderGeometry(0.16, 0.26, 2, 6), '#5d4037', [0, 1, 0]),
    part(new ConeGeometry(2.0, 2.6, 8), '#2f5d45', [0, 2.6, 0], 0.25, 81),
    part(new ConeGeometry(1.4, 1.3, 8), '#f4f8fc', [0, 3.35, 0], 0.15, 82),
    part(new ConeGeometry(1.5, 2.2, 8), '#356a4d', [0, 4.0, 0], 0.2, 83),
    part(new ConeGeometry(1.05, 1.1, 8), '#f4f8fc', [0, 4.65, 0], 0.12, 84),
    part(new ConeGeometry(0.9, 1.7, 7), '#3d7656', [0, 5.3, 0], 0.1, 85),
    part(new ConeGeometry(0.6, 0.9, 7), '#ffffff', [0, 5.85, 0], 0.06, 86),
  ])

/** 얼음 덩어리 (하늘색 결정) */
const iceBlock = () =>
  build([
    part(new IcosahedronGeometry(1.2, 0).scale(1, 1.5, 0.9), '#bfe6f7', [0, 1.2, 0], 0.35, 91),
    part(new IcosahedronGeometry(0.7, 0).scale(1, 1.8, 1), '#d6f1fb', [1.0, 0.9, 0.3], 0.2, 92),
  ])

/** 눈 덮인 바위 */
const snowRock = () =>
  build([
    part(new DodecahedronGeometry(0.9, 0).scale(1.3, 0.7, 1), '#6f7880', [0, 0.35, 0], 0.3, 101),
    part(new DodecahedronGeometry(0.75, 0).scale(1.3, 0.35, 1), '#f4f8fc', [0, 0.72, 0], 0.15, 102),
  ])

/** 펭귄: 검은 몸 · 흰 배 · 주황 부리와 발 */
const penguin = () =>
  build([
    part(new SphereGeometry(0.32, 10, 8).scale(1, 1.45, 0.9), '#1d2126', [0, 0.48, 0]),
    part(new SphereGeometry(0.26, 10, 8).scale(0.9, 1.35, 0.6), '#f6f6f2', [0, 0.45, 0.13]),
    part(new SphereGeometry(0.2, 10, 8), '#1d2126', [0, 0.98, 0.02]),
    part(new ConeGeometry(0.06, 0.18, 6).rotateX(Math.PI / 2), '#f39c12', [0, 0.96, 0.25]),
    part(new SphereGeometry(0.1, 8, 6).scale(1.2, 0.4, 1.6), '#f39c12', [0.1, 0.03, 0.08]),
    part(new SphereGeometry(0.1, 8, 6).scale(1.2, 0.4, 1.6), '#f39c12', [-0.1, 0.03, 0.08]),
    part(new SphereGeometry(0.09, 8, 6).scale(0.5, 1.8, 1), '#1d2126', [0.3, 0.5, 0]),
    part(new SphereGeometry(0.09, 8, 6).scale(0.5, 1.8, 1), '#1d2126', [-0.3, 0.5, 0]),
  ])

/** 이글루: 반구 + 입구 터널 */
const igloo = () =>
  build([
    part(new SphereGeometry(2.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#f2f7fc', [0, 0, 0], 0.08, 111),
    part(
      new CylinderGeometry(0.9, 0.9, 1.6, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2),
      '#e8f0f8',
      [0, 0, 2.3],
    ),
    part(
      new CylinderGeometry(0.6, 0.6, 0.1, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2),
      '#22303c',
      [0, 0, 3.12],
    ),
  ])

type Kind = { make: () => BufferGeometry; clearance: number; minScale: number; maxScale: number; hue: [number, number] }

const KINDS: Record<ScatterKind, Kind> = {
  pine: { make: pine, clearance: WALL_OFFSET + 4, minScale: 0.75, maxScale: 1.5, hue: [0.9, 1.1] },
  broadleaf: { make: broadleaf, clearance: WALL_OFFSET + 4, minScale: 0.8, maxScale: 1.3, hue: [0.85, 1.15] },
  bush: { make: bush, clearance: WALL_OFFSET + 1.5, minScale: 0.6, maxScale: 1.4, hue: [0.85, 1.15] },
  rock: { make: rock, clearance: WALL_OFFSET + 1.5, minScale: 0.5, maxScale: 1.6, hue: [0.9, 1.05] },
  cactus: { make: cactus, clearance: WALL_OFFSET + 3, minScale: 0.7, maxScale: 1.4, hue: [0.9, 1.1] },
  redRock: { make: redRock, clearance: WALL_OFFSET + 5, minScale: 0.6, maxScale: 2.2, hue: [0.88, 1.08] },
  dryBush: { make: dryBush, clearance: WALL_OFFSET + 1.5, minScale: 0.5, maxScale: 1.2, hue: [0.9, 1.1] },
  snowPine: { make: snowPine, clearance: WALL_OFFSET + 4, minScale: 0.75, maxScale: 1.5, hue: [0.95, 1.05] },
  iceBlock: { make: iceBlock, clearance: WALL_OFFSET + 3, minScale: 0.6, maxScale: 2, hue: [0.95, 1.05] },
  snowRock: { make: snowRock, clearance: WALL_OFFSET + 1.5, minScale: 0.5, maxScale: 1.6, hue: [0.95, 1.05] },
  penguin: { make: penguin, clearance: WALL_OFFSET + 2, minScale: 0.85, maxScale: 1.2, hue: [1, 1] },
  igloo: { make: igloo, clearance: WALL_OFFSET + 8, minScale: 0.9, maxScale: 1.2, hue: [1, 1] },
}

function Scatter({ kind, count, seed }: { kind: Kind; count: number; seed: number }) {
  const ref = useRef<InstancedMesh>(null)
  const geometry = useMemo(kind.make, [kind])

  const items = useMemo(() => {
    const rand = seededRandom(seed)
    const list: { x: number; y: number; z: number; scale: number; rot: number; tint: number; tilt: number }[] = []
    let guard = 0
    // 배치 범위: 코스를 감싸는 사각형 + 여유
    const b = trackBounds
    while (list.length < count && guard++ < count * 12) {
      const x = b.minX - MARGIN + rand() * (b.maxX - b.minX + MARGIN * 2)
      const z = b.minZ - MARGIN + rand() * (b.maxZ - b.minZ + MARGIN * 2)
      const scale = kind.minScale + rand() * (kind.maxScale - kind.minScale)
      const rot = rand() * Math.PI * 2
      const tint = kind.hue[0] + rand() * (kind.hue[1] - kind.hue[0])
      const tilt = (rand() - 0.5) * 0.12
      if (isInGrandstand(x, z)) continue
      const near = nearestSample(x, z)
      if (near.distance < kind.clearance + scale) continue // 방벽 안쪽·도로 위 제외
      const s = near.index * SAMPLE_SPACING
      if (TUNNEL && near.distance < 80 && s > TUNNEL[0] - 40 && s < TUNNEL[1] + 40) continue // 터널 위 산(Tunnel.tsx)에 묻히지 않게
      list.push({ x, y: terrainHeightAt(x, z) - 0.15, z, scale, rot, tint, tilt })
    }
    return list
  }, [kind, count, seed])

  useLayoutEffect(() => {
    const mesh = ref.current!
    const dummy = new Object3D()
    const color = new Color()
    items.forEach((t, i) => {
      dummy.position.set(t.x, t.y, t.z)
      dummy.rotation.set(t.tilt, t.rot, t.tilt * 0.5)
      dummy.scale.setScalar(t.scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      // 꼭짓점 색에 곱해지는 밝기 변화 (약간 노랗거나 푸르게)
      color.setRGB(t.tint * (t.tint > 1 ? 1.04 : 1), t.tint, t.tint * (t.tint < 1 ? 1.05 : 0.95))
      mesh.setColorAt(i, color)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor!.needsUpdate = true
  }, [items])

  return (
    <instancedMesh ref={ref} args={[geometry, undefined, items.length]} castShadow receiveShadow>
      <meshStandardMaterial vertexColors flatShading roughness={0.85} />
    </instancedMesh>
  )
}

/** 트랙 주변 장식: 맵이 정한 종류·개수대로 흩어 놓는다. 종류마다 InstancedMesh 1개 */
export default function Trees() {
  return (
    <>
      {currentMap.theme.scatter.map(({ kind, count }, i) => (
        <Scatter key={kind} kind={KINDS[kind]} count={count} seed={42 + i * 97} />
      ))}
    </>
  )
}

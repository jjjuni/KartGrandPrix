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
  type InstancedMesh,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { seededRandom } from '../utils/canvasTexture'
import { isInGrandstand } from './Grandstand'
import { terrainHeightAt } from './terrain'
import { TRACK_SCALE, WALL_OFFSET, nearestSample } from './trackData'

const AREA = 230 * TRACK_SCALE // 배치 범위 (중심 기준 ±m)
const CENTER = { x: 15 * TRACK_SCALE, z: 35 * TRACK_SCALE }

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

type Kind = { make: () => BufferGeometry; count: number; clearance: number; minScale: number; maxScale: number; hue: [number, number] }

const KINDS: Record<string, Kind> = {
  pine: { make: pine, count: 260, clearance: WALL_OFFSET + 4, minScale: 0.75, maxScale: 1.5, hue: [0.9, 1.1] },
  broadleaf: { make: broadleaf, count: 150, clearance: WALL_OFFSET + 4, minScale: 0.8, maxScale: 1.3, hue: [0.85, 1.15] },
  bush: { make: bush, count: 220, clearance: WALL_OFFSET + 1.5, minScale: 0.6, maxScale: 1.4, hue: [0.85, 1.15] },
  rock: { make: rock, count: 90, clearance: WALL_OFFSET + 1.5, minScale: 0.5, maxScale: 1.6, hue: [0.9, 1.05] },
}

function Scatter({ kind, seed }: { kind: Kind; seed: number }) {
  const ref = useRef<InstancedMesh>(null)
  const geometry = useMemo(kind.make, [kind])

  const items = useMemo(() => {
    const rand = seededRandom(seed)
    const list: { x: number; y: number; z: number; scale: number; rot: number; tint: number; tilt: number }[] = []
    let guard = 0
    while (list.length < kind.count && guard++ < kind.count * 12) {
      const x = CENTER.x + (rand() * 2 - 1) * AREA
      const z = CENTER.z + (rand() * 2 - 1) * AREA
      const scale = kind.minScale + rand() * (kind.maxScale - kind.minScale)
      const rot = rand() * Math.PI * 2
      const tint = kind.hue[0] + rand() * (kind.hue[1] - kind.hue[0])
      const tilt = (rand() - 0.5) * 0.12
      if (isInGrandstand(x, z)) continue
      if (nearestSample(x, z).distance < kind.clearance + scale) continue // 방벽 안쪽·도로 위 제외
      list.push({ x, y: terrainHeightAt(x, z) - 0.15, z, scale, rot, tint, tilt })
    }
    return list
  }, [kind, seed])

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

/** 트랙 주변 자연물: 침엽수 · 활엽수 · 덤불 · 바위. 종류마다 InstancedMesh 1개 (draw call 4번) */
export default function Trees() {
  return (
    <>
      <Scatter kind={KINDS.pine} seed={42} />
      <Scatter kind={KINDS.broadleaf} seed={7} />
      <Scatter kind={KINDS.bush} seed={99} />
      <Scatter kind={KINDS.rock} seed={1234} />
    </>
  )
}

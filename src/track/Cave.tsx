import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  BufferGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  LatheGeometry,
  Matrix4,
  Quaternion,
  Vector2,
  Vector3,
  type InstancedMesh,
} from 'three'
import { seededRandom } from '../utils/canvasTexture'
import { isInGrandstand } from './Grandstand'
import { CAVE, SAMPLE_SPACING, WALL_OFFSET, caveSizeAt, centerPoints, frames, offsetPoints } from './trackData'

const ARC = 20 // 굴 단면 꼭짓점 수
const FROM = -0.25 * Math.PI // 단면을 바닥 아래까지 둘러, 바닥과 굴 벽 사이에 틈이 없게
const TO = 1.25 * Math.PI
const STEP = 2 // 굴 고리 간격 (샘플 수)
const LAMP_EVERY = 14 // 굴 천장 등 간격 (m)

/** 바위 느낌: 위치마다 정해진 들쭉날쭉한 값 (-1 ~ 1) */
const bumpy = (a: number, b: number) => (Math.sin(a * 1.7 + b * 2.3) + Math.sin(a * 0.6 - b * 3.1) * 0.6 + Math.sin(a * 3.9 + b) * 0.3) / 1.9

type Dome = NonNullable<NonNullable<typeof CAVE>['dome']>

/** 큰 동굴(반타원체) 안쪽인지. scale < 1이면 그만큼 줄인 안쪽만 */
function inDome(d: Dome, x: number, y: number, z: number, scale = 1) {
  const r = Math.hypot(x - d.x, z - d.z) / (d.radius * scale)
  const h = (y - d.floor) / ((d.top - d.floor) * scale)
  return y > d.floor - 5 && r * r + h * h < 1
}

/** 코스를 덮는 굴 (반폭 · 높이가 코스를 따라 바뀜). 큰 동굴 안에 들어간 부분은 지운다 */
function tube(dome: Dome | null) {
  const pos: number[] = []
  const idx: number[] = []
  const n = centerPoints.length
  const rings = Math.floor(n / STEP)
  for (let r = 0; r <= rings; r++) {
    const i = (r * STEP) % n
    const p = centerPoints[i]
    const { left } = frames[i]
    const { half, height } = caveSizeAt(i * SAMPLE_SPACING)
    for (let a = 0; a <= ARC; a++) {
      const t = FROM + ((TO - FROM) * a) / ARC
      const rock = 1 + 0.12 * bumpy(r * 0.35, a * 0.9) // 들쭉날쭉한 바위 벽
      const u = Math.cos(t) * half * rock
      pos.push(p.x + left.x * u, p.y + Math.sin(t) * height * rock, p.z + left.z * u)
    }
  }
  const at = (r: number, a: number) => r * (ARC + 1) + a
  for (let r = 0; r < rings; r++) {
    for (let a = 0; a < ARC; a++) {
      const quad = [at(r, a), at(r + 1, a), at(r, a + 1), at(r + 1, a + 1)]
      if (dome) {
        // 네 꼭짓점 평균이 큰 동굴 안쪽 깊이 들어가면 지운다 — 이음매는 큰 동굴 벽과 겹치게 남겨 틈이 없게
        let x = 0
        let y = 0
        let z = 0
        for (const v of quad) {
          x += pos[v * 3] / 4
          y += pos[v * 3 + 1] / 4
          z += pos[v * 3 + 2] / 4
        }
        if (inDome(dome, x, y, z, 0.93)) continue
      }
      idx.push(quad[0], quad[1], quad[2], quad[2], quad[1], quad[3])
    }
  }
  return geometry(pos, idx)
}

/** 큰 동굴: 반타원체 돔. 굴이 들어오는 자리(굴 안쪽에 든 면)는 지워서 입구를 낸다 */
function domeShell(d: Dome) {
  const pos: number[] = []
  const idx: number[] = []
  const SEG = 72
  const RINGS = 28
  for (let r = 0; r <= RINGS; r++) {
    const phi = (Math.PI / 2) * (r / RINGS) // 0 = 바닥 둘레, π/2 = 꼭대기
    for (let s = 0; s <= SEG; s++) {
      const th = (Math.PI * 2 * s) / SEG
      const rock = 1 + 0.07 * bumpy(s * 0.5, r * 0.8)
      const rad = d.radius * Math.cos(phi) * rock
      pos.push(d.x + Math.cos(th) * rad, d.floor - 8 + (d.top - d.floor + 8) * Math.sin(phi) * rock, d.z + Math.sin(th) * rad)
    }
  }
  // 굴 안쪽 판정용: 큰 동굴 근처의 코스 샘플
  const near = centerPoints
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => Math.hypot(p.x - d.x, p.z - d.z) < d.radius + 60)
  const inTube = (x: number, y: number, z: number) => {
    for (const { p, i } of near) {
      const dx = x - p.x
      const dz = z - p.z
      if (dx * dx + dz * dz > 70 * 70) continue
      const { left, tangent } = frames[i]
      if (Math.abs(dx * tangent.x + dz * tangent.z) > 2) continue // 이 샘플의 단면 근처만
      const { half, height } = caveSizeAt(i * SAMPLE_SPACING)
      const u = (dx * left.x + dz * left.z) / half
      const h = (y - p.y) / height
      if (u * u + h * h < 0.8) return true // 굴 안쪽 깊이만 뚫는다 — 가장자리는 굴 벽과 겹치게
    }
    return false
  }
  const at = (r: number, s: number) => r * (SEG + 1) + s
  for (let r = 0; r < RINGS; r++) {
    for (let s = 0; s < SEG; s++) {
      const quad = [at(r, s), at(r + 1, s), at(r, s + 1), at(r + 1, s + 1)]
      let x = 0
      let y = 0
      let z = 0
      for (const v of quad) {
        x += pos[v * 3] / 4
        y += pos[v * 3 + 1] / 4
        z += pos[v * 3 + 2] / 4
      }
      if (inTube(x, y, z)) continue
      idx.push(quad[0], quad[2], quad[1], quad[2], quad[3], quad[1])
    }
  }
  return geometry(pos, idx)
}

function geometry(pos: number[], idx: number[]) {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** 등 위치: 굴 천장 한가운데 (큰 동굴 안은 길가 기둥 높이) */
function lampSpots(dome: Dome | null) {
  const spots: Vector3[] = []
  const n = centerPoints.length
  const every = Math.round(LAMP_EVERY / SAMPLE_SPACING)
  for (let i = 0; i < n; i += every) {
    const p = centerPoints[i]
    const { height } = caveSizeAt(i * SAMPLE_SPACING)
    if (dome && Math.hypot(p.x - dome.x, p.z - dome.z) < dome.radius - 10) {
      // 큰 동굴: 길 양옆 3m 높이에 번갈아
      const side = (i / every) % 2 ? 1 : -1
      const { left } = frames[i]
      spots.push(new Vector3(p.x + left.x * (WALL_OFFSET + 0.8) * side, p.y + 3, p.z + left.z * (WALL_OFFSET + 0.8) * side))
    } else spots.push(new Vector3(p.x, p.y + height - 0.6, p.z))
  }
  return spots
}

// ---------------------------------------------------------------------------
// 장식: 철길 · 광산 수레 · 벽에 박힌 원석과 수정 (화면용, 스스로 빛나지 않음)
// ---------------------------------------------------------------------------
const RAIL_OFFSET = WALL_OFFSET + 5 // 철길 중심 (방벽 바깥, 진행 방향 왼쪽)
const RAIL_BED = 1.1 // 철길을 올린 자갈 둑 높이 — 방벽(0.9m) 너머로 레일과 수레가 보이게
const RAIL_STEP = 1.2 // 침목 간격 (m)
const CART_EVERY = 90 // 수레 간격 (침목 수, 약 110m)
const RAIL_TOP = 0.26 // 레일 윗면 높이 (노면 기준)
const WHEEL_R = 0.3

/** 원석 종류 (자연스러운 광물 색): 자수정 · 에메랄드 · 사파이어 (육각 결정) · 금 (덩어리) */
const GEMS = [
  { color: '#6b4a8c', nugget: false },
  { color: '#2f6e4c', nugget: false },
  { color: '#33558a', nugget: false },
  { color: '#a8862e', nugget: true },
] as const

/** 육각기둥 + 뾰족한 끝 수정 하나 (밑동이 원점, +Y로 자란다) */
function crystalGeometry() {
  const profile = [new Vector2(0, -0.1), new Vector2(0.42, -0.1), new Vector2(0.5, 0.15), new Vector2(0.46, 0.75), new Vector2(0, 1.15)]
  return new LatheGeometry(profile, 6)
}

const UP = new Vector3(0, 1, 0)
const ONE = new Vector3(1, 1, 1)
const compose = (pos: Vector3, q: Quaternion, scale: Vector3) => new Matrix4().compose(pos, q, scale)
const local = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(sx, sy, sz))

/**
 * 광산 수레 한 대의 부품 (수레 기준 좌표, 바닥 = 레일 윗면). 녹슨 몸통은 위가 넓게 벌어지고,
 * 쇠 테두리 · 세로 보강대 · 아래 틀 · 차축 · 테 달린 바퀴 · 연결고리를 붙인다
 */
function cartParts() {
  const lean = 0.17 // 벽이 바깥으로 벌어진 각도 (rad)
  const y0 = WHEEL_R + 0.12 // 바닥판 높이
  const rust: Matrix4[] = [local(0, y0, 0, 0, 0, 0, 1.2, 0.06, 1.9)]
  const iron: Matrix4[] = []
  const wheels: Matrix4[] = []
  for (const s of [-1, 1]) {
    rust.push(local(s * 0.68, y0 + 0.45, 0, 0, 0, -s * lean, 0.06, 0.9, 2.0)) // 옆벽
    rust.push(local(0, y0 + 0.45, s * 1.0, s * lean, 0, 0, 1.34, 0.9, 0.06)) // 앞뒤 벽
    iron.push(local(s * 0.77, y0 + 0.92, 0, 0, 0, 0, 0.1, 0.08, 2.18)) // 위 테두리 (옆)
    iron.push(local(0, y0 + 0.92, s * 1.09, 0, 0, 0, 1.64, 0.08, 0.1)) // 위 테두리 (앞뒤)
    for (const z of [-0.65, 0, 0.65]) iron.push(local(s * 0.72, y0 + 0.45, z, 0, 0, -s * lean, 0.05, 0.94, 0.09)) // 세로 보강대
    iron.push(local(s * 0.45, y0 - 0.08, 0, 0, 0, 0, 0.1, 0.12, 2.0)) // 아래 틀
    iron.push(local(0, WHEEL_R, s * 0.65, 0, 0, Math.PI / 2, 0.05, 1.3, 0.05)) // 차축 (원기둥을 옆으로)
    iron.push(local(0, y0 - 0.02, s * 1.22, 0, 0, 0, 0.14, 0.1, 0.35)) // 연결고리
    for (const x of [-1, 1]) {
      wheels.push(local(x * 0.62, WHEEL_R, s * 0.65, 0, 0, Math.PI / 2, WHEEL_R, 0.09, WHEEL_R)) // 바퀴
      wheels.push(local(x * 0.56, WHEEL_R, s * 0.65, 0, 0, Math.PI / 2, WHEEL_R + 0.06, 0.03, WHEEL_R + 0.06)) // 안쪽 테 (레일에 걸림)
    }
  }
  return { rust, iron, wheels, top: y0 + 0.75 }
}

function decorations(dome: Dome | null) {
  const rand = seededRandom(91)
  const out = {
    beds: [] as Matrix4[],
    rails: [] as Matrix4[],
    sleepers: [] as Matrix4[],
    rust: [] as Matrix4[],
    iron: [] as Matrix4[],
    wheels: [] as Matrix4[],
    rocks: [] as Matrix4[],
    gems: GEMS.map(() => [] as Matrix4[]),
  }
  const n = centerPoints.length
  const nearDome = (x: number, z: number, pad: number) => !!dome && Math.hypot(x - dome.x, z - dome.z) < dome.radius + pad
  const cart = cartParts()

  // ---- 철길: 굴이 넉넉히 넓은 곳에만 (큰 동굴 · 관중석 자리는 비움) ----
  const segs = offsetPoints(RAIL_OFFSET, RAIL_STEP)
  let run = 0
  segs.forEach((seg, k) => {
    const { half } = caveSizeAt((k / segs.length) * n * SAMPLE_SPACING)
    const p = seg.position
    if (half < RAIL_OFFSET + 3 || nearDome(p.x, p.z, 15) || isInGrandstand(p.x, p.z)) {
      run = 0
      return
    }
    const q = new Quaternion().setFromEuler(new Euler(...seg.rotation))
    const base = compose(p, q, ONE)
    const at = (m: Matrix4) => base.clone().multiply(m)
    out.beds.push(at(local(0, RAIL_BED / 2 - 0.15, 0, 0, 0, 0, 2.8, RAIL_BED + 0.3, seg.length + 0.05))) // 자갈 둑
    out.sleepers.push(at(local(0, RAIL_BED + 0.07, 0, 0, (rand() - 0.5) * 0.08, 0, 2.1, 0.14, 0.26)))
    for (const x of [-0.62, 0.62]) {
      out.rails.push(at(local(x, RAIL_BED + RAIL_TOP - 0.06, 0, 0, 0, 0, 0.07, 0.12, seg.length + 0.03))) // 레일 머리
      out.rails.push(at(local(x, RAIL_BED + 0.16, 0, 0, 0, 0, 0.16, 0.03, seg.length + 0.03))) // 레일 밑판
    }
    // ---- 광산 수레: 철길이 이어진 곳마다, 원석 섞인 돌을 싣고 ----
    if (++run % CART_EVERY === 30) {
      const cb = base.clone().multiply(local(0, RAIL_BED + RAIL_TOP, 0, 0, (rand() - 0.5) * 0.05, 0))
      for (const m of cart.rust) out.rust.push(cb.clone().multiply(m))
      for (const m of cart.iron) out.iron.push(cb.clone().multiply(m))
      for (const m of cart.wheels) out.wheels.push(cb.clone().multiply(m))
      const ore = Math.floor(rand() * GEMS.length)
      for (let j = 0; j < 14; j++) {
        const x = (rand() - 0.5) * 1.1
        const z = (rand() - 0.5) * 1.7
        const mound = cart.top + 0.18 * (1 - Math.min(1, Math.hypot(x / 0.6, z / 0.9))) // 가운데가 볼록하게
        const size = 0.18 + rand() * 0.16
        const m = cb.clone().multiply(local(x, mound, z, rand() * 6, rand() * 6, rand() * 6, size, size * 0.8, size))
        if (rand() < 0.35) out.gems[ore].push(m.multiply(new Matrix4().makeScale(0.8, 0.8, 0.8)))
        else out.rocks.push(m)
      }
    }
  })

  // ---- 원석 · 수정: 바위 밑동에서 길이 · 굵기 · 각도가 제각각인 결정들이 무리 지어 자란다 ----
  const cluster = (pos: Vector3, inward: Vector3, size: number) => {
    const type = Math.floor(rand() * GEMS.length)
    // 바위 밑동
    out.rocks.push(compose(pos, new Quaternion().setFromEuler(new Euler(rand() * 6, rand() * 6, rand() * 6)), new Vector3(1, 0.6, 1).multiplyScalar(size * 0.7)))
    const count = GEMS[type].nugget ? 4 : 5 + Math.floor(rand() * 3)
    for (let j = 0; j < count; j++) {
      const spread = j === 0 ? 0.15 : 0.75 // 첫 결정은 곧게, 나머지는 사방으로 기울어
      const dir = inward.clone().add(new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(spread * 2)).normalize()
      const q = new Quaternion().setFromUnitVectors(UP, dir).multiply(new Quaternion().setFromAxisAngle(UP, rand() * Math.PI))
      const along = new Vector3(rand() - 0.5, 0, rand() - 0.5).multiplyScalar(size * 0.6)
      if (GEMS[type].nugget) {
        const k = size * (0.35 + rand() * 0.35)
        out.gems[type].push(compose(pos.clone().add(along).addScaledVector(inward, k * 0.4), q, new Vector3(k, k * 0.75, k * 0.9)))
      } else {
        const len = size * (j === 0 ? 1.8 : 0.6 + rand() * 1.1)
        const r = size * (0.16 + rand() * 0.12)
        out.gems[type].push(compose(pos.clone().add(along), q, new Vector3(r, len, r)))
      }
    }
  }
  const rings = Math.floor(n / STEP)
  for (let c = 0; c < 300; c++) {
    const i = (Math.floor(rand() * rings) * STEP) % n
    const p = centerPoints[i]
    const { left } = frames[i]
    const { half, height } = caveSizeAt(i * SAMPLE_SPACING)
    // 벽(옆) ~ 천장 쪽 각도만 (바닥 근처는 피한다)
    const t = rand() < 0.5 ? 0.08 + rand() * 0.37 : 0.55 + rand() * 0.37
    const u = Math.cos(Math.PI * t) * half * 0.96
    const pos = new Vector3(p.x + left.x * u, p.y + Math.sin(Math.PI * t) * height * 0.96, p.z + left.z * u)
    if (dome && inDome(dome, pos.x, pos.y, pos.z, 0.93)) continue // 큰 동굴로 뚫려 굴 벽이 없는 자리
    const inward = new Vector3(p.x, p.y + height * 0.3, p.z).sub(pos).normalize()
    cluster(pos, inward, Math.min(1.5, 0.55 + half * 0.025))
  }
  // 큰 동굴 지붕 · 벽에도 (굴이 뚫고 들어온 자리 근처는 피한다)
  if (dome) {
    for (let c = 0; c < 140; c++) {
      const phi = (Math.PI / 2) * (0.08 + rand() * 0.8)
      const th = rand() * Math.PI * 2
      const pos = new Vector3(
        dome.x + Math.cos(th) * Math.cos(phi) * dome.radius * 0.97,
        dome.floor - 8 + (dome.top - dome.floor + 8) * Math.sin(phi) * 0.97,
        dome.z + Math.sin(th) * Math.cos(phi) * dome.radius * 0.97,
      )
      if (centerPoints.some((q) => Math.hypot(q.x - pos.x, q.z - pos.z) < 40 && Math.abs(q.y - pos.y) < 25)) continue
      cluster(pos, new Vector3(dome.x, dome.floor, dome.z).sub(pos).normalize(), 2.2)
    }
  }
  return out
}

/** 같은 모양을 여러 군데에 (InstancedMesh) */
function Instances({ matrices, children, shadow = false }: { matrices: Matrix4[]; children: ReactNode; shadow?: boolean }) {
  const ref = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
    mesh.instanceMatrix.needsUpdate = true
  }, [matrices])
  if (!matrices.length) return null
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, matrices.length]} castShadow={shadow} receiveShadow>
      {children}
    </instancedMesh>
  )
}

/** 광산 동굴: 바위 굴 + 큰 동굴 + 등불 + 철길 · 수레 · 원석 (화면용 — 충돌은 방벽 · 지형이 맡음) */
export default function Cave() {
  const parts = useMemo(() => {
    if (!CAVE) return null
    const dome = CAVE.dome
    return {
      tube: tube(dome),
      dome: dome ? domeShell(dome) : null,
      lamps: lampSpots(dome).map((v) => compose(v, new Quaternion(), ONE)),
      deco: decorations(dome),
      crystal: crystalGeometry(),
    }
  }, [])

  if (!parts) return null
  const { deco } = parts
  const rock = <meshStandardMaterial color="#5a4a3c" roughness={1} flatShading side={DoubleSide} />
  return (
    <>
      <mesh geometry={parts.tube} receiveShadow>
        {rock}
      </mesh>
      {parts.dome && (
        <mesh geometry={parts.dome} receiveShadow>
          {rock}
        </mesh>
      )}
      <Instances matrices={parts.lamps}>
        <sphereGeometry args={[0.35, 10, 8]} />
        <meshStandardMaterial color="#ffd27a" emissive="#ffb347" emissiveIntensity={3} />
      </Instances>
      {/* 철길: 자갈 둑 + 나무 침목 + 쇠 레일 (어두운 굴에서도 보이게 밝은 색) */}
      <Instances matrices={deco.beds}>
        <boxGeometry />
        <meshStandardMaterial color="#6b5d50" roughness={1} />
      </Instances>
      <Instances matrices={deco.sleepers} shadow>
        <boxGeometry />
        <meshStandardMaterial color="#9a7752" roughness={1} />
      </Instances>
      <Instances matrices={deco.rails}>
        <boxGeometry />
        <meshStandardMaterial color="#c4c8cf" metalness={0.35} roughness={0.4} />
      </Instances>
      {/* 광산 수레: 녹슨 몸통 · 쇠 테두리와 보강대 · 바퀴 */}
      <Instances matrices={deco.rust} shadow>
        <boxGeometry />
        <meshStandardMaterial color="#8a4f2b" metalness={0.3} roughness={0.85} />
      </Instances>
      <Instances matrices={deco.iron} shadow>
        <boxGeometry />
        <meshStandardMaterial color="#4a4744" metalness={0.6} roughness={0.55} />
      </Instances>
      <Instances matrices={deco.wheels} shadow>
        <cylinderGeometry args={[1, 1, 1, 16]} />
        <meshStandardMaterial color="#2e2c2a" metalness={0.6} roughness={0.5} />
      </Instances>
      {/* 바위 덩어리 (수정 밑동 · 수레에 실은 돌) */}
      <Instances matrices={deco.rocks}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#4b4038" roughness={1} flatShading />
      </Instances>
      {/* 원석 · 수정: 자연스러운 광물 색 */}
      {GEMS.map((g, i) => (
        <Instances key={i} matrices={deco.gems[i]}>
          {g.nugget ? <dodecahedronGeometry args={[1, 0]} /> : <primitive object={parts.crystal} attach="geometry" />}
          {/* 아주 은은하게만 스스로 밝다 (주변을 비추지는 않음) — 어두운 굴에서도 알아볼 정도 */}
          {g.nugget ? (
            <meshStandardMaterial color={g.color} emissive={g.color} emissiveIntensity={0.18} roughness={0.45} metalness={0.75} flatShading />
          ) : (
            // 수정: 반투명 유리처럼 — 뒷면까지 비쳐 보이고, 겉면엔 매끈한 코팅 반사
            <meshPhysicalMaterial
              color={g.color}
              emissive={g.color}
              emissiveIntensity={0.3}
              transparent
              opacity={0.68}
              roughness={0.05}
              metalness={0}
              clearcoat={1}
              clearcoatRoughness={0.05}
              ior={1.55}
              side={DoubleSide}
              flatShading
            />
          )}
        </Instances>
      ))}
    </>
  )
}

import { useLayoutEffect, useMemo, useRef } from 'react'
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Matrix4, Path, Quaternion, Shape, ShapeGeometry, Vector3, type InstancedMesh } from 'three'
import { terrainHeightAt } from './terrain'
import { SAMPLE_SPACING, TUNNEL, WALL_OFFSET, centerPoints, currentMap, frames, indexAtS } from './trackData'

const HALF = WALL_OFFSET + 1 // 터널 안쪽 반폭 (방벽 바깥까지)
const HEIGHT = 9.5 // 천장 높이 — 위로 지나는 길(14m)의 다리 상판보다 낮게
const WALL = 2.5 // 터널 벽 두께 (입구 석벽에서 보인다)
const HILL_PORTAL = HEIGHT + WALL + 2 // 입구 바로 위 산 높이 (도로 기준)
const HILL_PEAK = 31 // 터널 한가운데 산꼭대기 (도로 기준) — 그 위를 지나는 길(32m)보다 살짝 낮게
const HILL_FLAT = HALF + WALL + 4 // 산마루 평평한 반폭
const HILL_SLOPE = 50 // 그 바깥 비탈 폭
const APPROACH = 30 // 입구 앞으로 이어지는 비탈 길이 (m) — 길 위는 깎아서 비워 둔다
const HILL_STEP = 2.5 // 산 메시 격자 (m)
const ARC = 14 // 단면 꼭짓점 수
const LIGHT_EVERY = 8 // 천장 조명 간격 (m)

/** 중심선 s 구간을 덮는 반타원 단면 껍질 (half · height 크기) */
function shell(from: number, to: number, half: number, height: number) {
  const pos: number[] = []
  const idx: number[] = []
  const n = centerPoints.length
  const i0 = indexAtS(from)
  const count = Math.max(1, Math.round((to - from) / SAMPLE_SPACING / 2))
  for (let k = 0; k <= count; k++) {
    const i = (i0 + k * 2) % n
    const p = centerPoints[i]
    const { left } = frames[i]
    for (let a = 0; a <= ARC; a++) {
      const t = (Math.PI * a) / ARC
      const side = Math.cos(t) * half
      pos.push(p.x + left.x * side, p.y + Math.sin(t) * height, p.z + left.z * side)
      if (k < count && a < ARC) {
        const v = k * (ARC + 1) + a
        idx.push(v, v + ARC + 1, v + 1, v + 1, v + ARC + 1, v + ARC + 2)
      }
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/**
 * 터널 중심선 s(m)에서 옆으로 u(m) 떨어진 곳의 산 높이 (도로 기준). 바깥은 원래 지형과 이어진다.
 * 터널 안: 입구 바로 위 HILL_PORTAL → 한가운데 HILL_PEAK. 입구 앞: 길 양옆으로만 비탈이 내려온다 (길 위는 깎은 골짜기)
 */
function hillHeight(i: number, u: number, s: number) {
  const [a, b] = TUNNEL!
  const p = centerPoints[i]
  const { left } = frames[i]
  const fall = 1 - smoothstep(HILL_FLAT, HILL_FLAT + HILL_SLOPE, Math.abs(u))
  const out = s < a ? a - s : s - b
  const top =
    out <= 0
      ? HILL_PORTAL + (HILL_PEAK - HILL_PORTAL) * Math.sin((Math.PI * (s - a)) / (b - a))
      : HILL_PORTAL * (1 - smoothstep(0, APPROACH, out)) * smoothstep(HALF + WALL, HALF + WALL + 10, Math.abs(u))
  const ground = terrainHeightAt(p.x + left.x * u, p.z + left.z * u) - p.y
  // 산 표면은 살짝 울퉁불퉁하게 (낮은 곳일수록 약하게)
  const rough = Math.sin(u * 0.21 + i * 0.013) * 0.8 * Math.min(1, top / 5)
  return Math.max(ground, (top + rough) * fall)
}

function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

const hillWidth = HILL_FLAT + HILL_SLOPE

/**
 * 터널 위를 덮는 산 (화면용). 지형(Heightfield)은 한 지점에 높이가 하나뿐이라 터널 길 높이를 따르므로,
 * 산은 따로 메시로 덮는다. uv: 지면과 같은 질감이 이어지게 월드 좌표 → uv
 */
export function tunnelHill(uv: (x: number, z: number) => [number, number]) {
  if (!TUNNEL) return null
  const [a, b] = TUNNEL
  const n = centerPoints.length
  const pos: number[] = []
  const uvs: number[] = []
  const idx: number[] = []
  /** s0~s1(길 따라) × u0~u1(옆으로) 격자 한 장 (s0 < s1, u0 < u1) */
  const grid = (s0: number, s1: number, u0: number, u1: number) => {
    const rows = Math.max(1, Math.round(Math.abs(s1 - s0) / 2))
    const cols = Math.max(1, Math.round(Math.abs(u1 - u0) / HILL_STEP))
    const base = pos.length / 3
    for (let r = 0; r <= rows; r++) {
      const s = s0 + ((s1 - s0) * r) / rows
      const i = indexAtS(s) % n
      const p = centerPoints[i]
      const { left } = frames[i]
      for (let c = 0; c <= cols; c++) {
        const u = u0 + ((u1 - u0) * c) / cols
        const x = p.x + left.x * u
        const z = p.z + left.z * u
        pos.push(x, p.y + hillHeight(i, u, s), z)
        uvs.push(...uv(x, z))
        if (r < rows && c < cols) {
          const v = base + r * (cols + 1) + c
          // u가 왼쪽(+)으로 커지는 격자라 이 순서여야 면이 위를 향한다 (반대면 위에서 안 보여 뚫려 보임)
          idx.push(v, v + cols + 1, v + 1, v + 1, v + cols + 1, v + cols + 2)
        }
      }
    }
  }
  // 산 몸통: 터널 위 전체
  grid(a, b, -hillWidth, hillWidth)
  // 입구 앞 비탈: 길 양옆에만 (길 위는 비워 두고, 그 사이 단면은 입구 석벽이 막는다)
  const cut = HALF + WALL
  for (const [s0, s1] of [[a - APPROACH, a], [b, b + APPROACH]]) {
    grid(s0, s1, cut, hillWidth)
    grid(s0, s1, -hillWidth, -cut)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** 입구 석벽: 산 단면 모양에서 아치 구멍을 뚫은 면 — 산의 끝을 막고 터널 벽 두께가 보이게 */
function headwall(s: number) {
  const i = indexAtS(s)
  // 산 몸통 앞면 중 비탈이 덮지 않는 가운데(길 위 + 비탈이 낮아지는 폭)만 석벽으로
  const w = HALF + WALL + 10
  const shape = new Shape()
  shape.moveTo(-w, -1.5)
  for (let u = -w; u <= w + 0.01; u += HILL_STEP) shape.lineTo(u, hillHeight(i, u, s))
  shape.lineTo(w, -1.5)
  shape.closePath()
  const hole = new Path()
  hole.moveTo(HALF, -1)
  for (let a = 0; a <= ARC; a++) {
    const t = (Math.PI * a) / ARC
    hole.lineTo(Math.cos(t) * HALF, Math.sin(t) * HEIGHT)
  }
  hole.lineTo(-HALF, -1)
  shape.holes.push(hole)
  const g = new ShapeGeometry(shape)
  // 단면 평면(u, 높이) → 월드: 중심선 점 + left·u + 위·h
  const p = centerPoints[i]
  const { left } = frames[i]
  const attr = g.getAttribute('position')
  for (let k = 0; k < attr.count; k++) {
    const u = attr.getX(k)
    const h = attr.getY(k)
    attr.setXYZ(k, p.x + left.x * u, p.y + h, p.z + left.z * u)
  }
  g.computeVertexNormals()
  return g
}

/** 입체 교차 아래 길의 터널: 반타원 콘크리트 껍질 + 천장 조명 + 양쪽 입구 테두리 (화면용, 충돌은 방벽이 맡음) */
export default function Tunnel() {
  const parts = useMemo(() => {
    if (!TUNNEL) return null
    const [a, b] = TUNNEL
    return {
      body: shell(a, b, HALF, HEIGHT),
      portals: [shell(a, a + 2, HALF + 0.6, HEIGHT + 0.6), shell(b - 2, b, HALF + 0.6, HEIGHT + 0.6)],
      walls: [headwall(a), headwall(b)],
      lights: Array.from({ length: Math.floor((b - a) / LIGHT_EVERY) }, (_, k) => indexAtS(a + LIGHT_EVERY / 2 + k * LIGHT_EVERY)),
    }
  }, [])

  const lightRef = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = lightRef.current
    if (!mesh || !parts) return
    const m = new Matrix4()
    const q = new Quaternion()
    parts.lights.forEach((i, k) => {
      const p = centerPoints[i]
      q.setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(frames[i].tangent.x, frames[i].tangent.z))
      m.compose(new Vector3(p.x, p.y + HEIGHT - 0.15, p.z), q, new Vector3(1, 1, 1))
      mesh.setMatrixAt(k, m)
    })
    mesh.instanceMatrix.needsUpdate = true
  }, [parts])

  if (!parts) return null
  return (
    <>
      <mesh geometry={parts.body} castShadow receiveShadow>
        <meshStandardMaterial color="#8f8a80" emissive="#2e2a24" roughness={0.95} side={DoubleSide} />
      </mesh>
      {parts.portals.map((g, i) => (
        <mesh key={i} geometry={g} castShadow>
          <meshStandardMaterial color={currentMap.theme.walls[0]} roughness={0.8} side={DoubleSide} />
        </mesh>
      ))}
      {parts.walls.map((g, i) => (
        <mesh key={i} geometry={g} castShadow receiveShadow>
          <meshStandardMaterial color="#7d776d" roughness={1} side={DoubleSide} />
        </mesh>
      ))}
      <instancedMesh ref={lightRef} args={[undefined, undefined, parts.lights.length]}>
        <boxGeometry args={[3, 0.15, 1.2]} />
        <meshStandardMaterial color="#fff3c4" emissive="#ffe08a" emissiveIntensity={2.5} />
      </instancedMesh>
    </>
  )
}

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  Color,
  DoubleSide,
  ExtrudeGeometry,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  Shape,
  Vector3,
  type InstancedMesh,
} from 'three'
import { useWorld } from '../physics/PhysicsWorld'
import { WALL_COLLIDER_HEIGHT, WALL_THICKNESS, createWallBodies, wallTransform } from '../physics/trackBodies'
import { makeCanvasTexture } from '../utils/canvasTexture'
import { terrainHeightAt } from './terrain'
import {
  BRANCH_WIDTH,
  CAVE,
  ROAD_WIDTH,
  WALL_OFFSET,
  branchFrames,
  branchPoints,
  branchWallOffset,
  centerPoints,
  currentMap,
  offsetPoints,
  type Segment,
} from './trackData'

const WALL_SEGMENT = 3
const WALL_HEIGHT = 0.9 // 보이는 높이 (충돌 높이는 WALL_COLLIDER_HEIGHT로 더 높음 — 튀어서 넘어가지 못하게)
const FENCE_HEIGHT = 1.6 // 방벽 위 철망 높이
const POST_EVERY = 2 // 기둥 간격 (세그먼트 수)

/** 콘크리트 방호벽 단면 (아래가 넓고 위로 좁아지는 저지 배리어). 인스턴스 원점 = 충돌 박스 중심 */
function barrierGeometry(length: number) {
  const w = WALL_THICKNESS / 2
  const top = 0.13
  const s = new Shape()
  s.moveTo(-w, 0)
  s.lineTo(w, 0)
  s.lineTo(w, 0.08)
  s.lineTo(w * 0.45, 0.3)
  s.lineTo(top, WALL_HEIGHT - 0.04)
  s.quadraticCurveTo(top, WALL_HEIGHT, top - 0.04, WALL_HEIGHT)
  s.lineTo(-top + 0.04, WALL_HEIGHT)
  s.quadraticCurveTo(-top, WALL_HEIGHT, -top, WALL_HEIGHT - 0.04)
  s.lineTo(-w * 0.45, 0.3)
  s.lineTo(-w, 0.08)
  s.closePath()
  const g = new ExtrudeGeometry(s, { depth: length, bevelEnabled: false, curveSegments: 3 })
  g.translate(0, -WALL_COLLIDER_HEIGHT / 2, -length / 2)
  g.computeVertexNormals()
  return g
}

/** 철망 무늬 (마름모 격자, 알파 테스트용) */
function makeFenceTexture() {
  const tex = makeCanvasTexture(
    64,
    64,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h)
      ctx.strokeStyle = 'rgba(200,205,210,1)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(w, h)
      ctx.moveTo(w, 0)
      ctx.lineTo(0, h)
      ctx.stroke()
    },
    true,
  )
  tex.repeat.set(WALL_SEGMENT / 0.25, FENCE_HEIGHT / 0.25)
  return tex
}

/**
 * 트랙 바깥 방벽. 물리는 세그먼트 박스를 여러 개씩 묶은 정적 body,
 * 화면은 InstancedMesh(방호벽 · 철망 · 기둥)로 수백 개의 세그먼트를 적은 draw call로 그린다.
 */
/** 다른 길 위에 놓인 방벽 조각은 빼서 갈림길을 연다 (높이 차가 큰 입체 교차의 위 · 아래 길은 그대로) */
export function openJunctions(segments: Segment[]) {
  if (!branchPoints.length) return segments
  const roads = [
    { points: centerPoints, half: ROAD_WIDTH / 2 + 1.5 },
    { points: branchPoints, half: BRANCH_WIDTH / 2 + 1.5 },
  ]
  return segments.filter(
    ({ position: s }) =>
      !roads.some(({ points, half }) =>
        points.some((p) => Math.abs(p.y - s.y) < 4 && (p.x - s.x) ** 2 + (p.z - s.z) ** 2 < half * half),
      ),
  )
}

/**
 * 동굴 맵의 낭떠러지: 방벽 바깥 4m의 땅이 4m 넘게 꺼져 있으면 그 조각은 세우지 않는다 (떨어질 수 있게).
 * 동굴 맵만 — 다른 맵의 다리(입체 교차) 옆은 아래 길로 떨어지지 않게 그대로 둔다
 */
function openCliffs(segments: Segment[], offset: number) {
  if (!CAVE) return segments
  const side = Math.sign(offset)
  return segments.filter(({ position: p, yaw }) => {
    // 세그먼트 진행 방향 (sin yaw, cos yaw)의 왼쪽 = (cos yaw, -sin yaw), 여기에 offset 부호를 곱하면 바깥쪽
    const x = p.x + Math.cos(yaw) * side * 4
    const z = p.z - Math.sin(yaw) * side * 4
    return terrainHeightAt(x, z) > p.y - 4
  })
}

function WallSide({
  offset,
  fence,
  branch = false,
}: {
  offset: number
  fence: ReturnType<typeof makeFenceTexture>
  branch?: boolean
}) {
  const segments = useMemo(
    () =>
      openJunctions(
        openCliffs(
          branch
            ? // 지름길이 낭떠러지를 건너는 구간(양 끝보다 10m 넘게 낮은 곳)에는 방벽을 세우지 않는다
              offsetPoints(offset, WALL_SEGMENT, branchPoints, branchFrames, false).filter(
                (s) => s.position.y > Math.min(branchPoints[0].y, branchPoints[branchPoints.length - 1].y) - 10,
              )
            : offsetPoints(offset, WALL_SEGMENT),
          offset,
        ),
      ),
    [offset, branch],
  )
  // 낭떠러지 · 갈림길로 조각이 모두 빠진 쪽은 그리지 않는다 (빈 인스턴스는 색 버퍼가 없어 오류)
  return segments.length ? <WallBody segments={segments} fence={fence} /> : null
}

function WallBody({ segments, fence }: { segments: Segment[]; fence: ReturnType<typeof makeFenceTexture> }) {
  // 경사 구간은 세그먼트가 조금 더 길다 → 가장 긴 값 기준 + 틈 방지 여유
  const length = Math.max(...segments.map((s) => s.length)) + 0.15

  const world = useWorld()
  const bodies = useMemo(() => createWallBodies(segments, length), [segments, length])
  useEffect(() => {
    for (const b of bodies) world.addBody(b)
    return () => bodies.forEach((b) => world.removeBody(b))
  }, [world, bodies])

  const wallRef = useRef<InstancedMesh>(null)
  const fenceRef = useRef<InstancedMesh>(null)
  const postRef = useRef<InstancedMesh>(null)
  const geometry = useMemo(() => barrierGeometry(length), [length])
  // 세그먼트 진행 방향(+z)을 따라 세운 철망 판
  const fenceGeometry = useMemo(() => new PlaneGeometry(length, FENCE_HEIGHT).rotateY(Math.PI / 2), [length])
  const postCount = Math.ceil(segments.length / POST_EVERY)

  useLayoutEffect(() => {
    // 맵 색 블록 (6m = 2칸마다 번갈아)
    const [colorA, colorB] = currentMap.theme.walls.map((c) => new Color(c))
    const m = new Matrix4()
    const one = new Vector3(1, 1, 1)
    const up = new Vector3()
    const ahead = new Vector3()
    segments.forEach((seg, i) => {
      const { position, quaternion: q } = wallTransform(seg)
      const pos = new Vector3(position.x, position.y, position.z)
      const quat = new Quaternion(q.x, q.y, q.z, q.w)
      m.compose(pos, quat, one)
      wallRef.current!.setMatrixAt(i, m)
      // 6m(2칸)마다 색이 바뀌는 블록
      wallRef.current!.setColorAt(i, Math.floor(i / 2) % 2 ? colorA : colorB)

      // 철망: 방벽 윗면에서 FENCE_HEIGHT만큼
      up.set(0, WALL_HEIGHT - WALL_COLLIDER_HEIGHT / 2 + FENCE_HEIGHT / 2, 0).applyQuaternion(quat)
      m.compose(pos.clone().add(up), quat, one)
      fenceRef.current!.setMatrixAt(i, m)

      if (i % POST_EVERY === 0) {
        ahead
          .set(0, WALL_HEIGHT - WALL_COLLIDER_HEIGHT / 2 + FENCE_HEIGHT / 2 + 0.05, -seg.length / 2)
          .applyQuaternion(quat)
        m.compose(pos.clone().add(ahead), quat, one)
        postRef.current!.setMatrixAt(i / POST_EVERY, m)
      }
    })
    for (const r of [wallRef, fenceRef, postRef]) r.current!.instanceMatrix.needsUpdate = true
    wallRef.current!.instanceColor!.needsUpdate = true
  }, [segments])

  return (
    <>
      <instancedMesh ref={wallRef} args={[geometry, undefined, segments.length]} castShadow receiveShadow>
        <meshStandardMaterial roughness={0.75} />
      </instancedMesh>
      <instancedMesh ref={fenceRef} args={[fenceGeometry, undefined, segments.length]}>
        <meshStandardMaterial map={fence} alphaTest={0.5} side={DoubleSide} metalness={0.6} roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={postRef} args={[undefined, undefined, postCount]} castShadow>
        <cylinderGeometry args={[0.04, 0.04, FENCE_HEIGHT + 0.1, 6]} />
        <meshStandardMaterial color="#9ea4aa" metalness={0.8} roughness={0.3} />
      </instancedMesh>
    </>
  )
}

export default function Walls() {
  const fence = useMemo(makeFenceTexture, [])
  return (
    <>
      <WallSide offset={WALL_OFFSET} fence={fence} />
      <WallSide offset={-WALL_OFFSET} fence={fence} />
      {branchPoints.length > 0 && (
        <>
          <WallSide offset={branchWallOffset()} fence={fence} branch />
          <WallSide offset={-branchWallOffset()} fence={fence} branch />
        </>
      )}
    </>
  )
}

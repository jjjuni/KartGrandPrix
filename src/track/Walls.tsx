import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Color, DoubleSide, ExtrudeGeometry, Matrix4, PlaneGeometry, Quaternion, Shape, Vector3, type InstancedMesh } from 'three'
import { useWorld } from '../physics/PhysicsWorld'
import { WALL_COLLIDER_HEIGHT, WALL_THICKNESS, createWallBodies, wallTransform } from '../physics/trackBodies'
import { makeCanvasTexture } from '../utils/canvasTexture'
import { WALL_OFFSET, currentMap, offsetPoints } from './trackData'

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
function WallSide({ offset, fence }: { offset: number; fence: ReturnType<typeof makeFenceTexture> }) {
  const segments = useMemo(() => offsetPoints(offset, WALL_SEGMENT), [offset])
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
        ahead.set(0, WALL_HEIGHT - WALL_COLLIDER_HEIGHT / 2 + FENCE_HEIGHT / 2 + 0.05, -seg.length / 2).applyQuaternion(quat)
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
    </>
  )
}

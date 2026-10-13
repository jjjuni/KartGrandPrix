import { Body, Box, Quaternion as CQuaternion, Vec3 } from 'cannon-es'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Euler, Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three'
import { useWorld } from '../physics/PhysicsWorld'
import { GROUP, materials } from '../physics/world'
import { terrainHeightAt } from './terrain'
import { WALL_OFFSET, offsetPoints, type Segment } from './trackData'

const STEP = 2 // 상판 조각 길이 (m)
const THICK = 0.6 // 물리 상판 두께 (윗면 = 도로면)
const LOOK = 1.2 // 보이는 상판 두께
const EXTEND = 3 // 교차 구간 앞뒤로 더 까는 조각 수

/** 세그먼트 회전 (XYZ 오일러) → 쿼터니언 */
const toQuat = (s: Segment) => new Quaternion().setFromEuler(new Euler(...s.rotation))

/**
 * 다리 상판 조각들: 입체 교차에서 지형보다 뜬 도로 구간.
 * 입체 교차에서 지형(Heightfield)은 한 지점에 높이가 하나뿐이라 아래 길 높이를 따르므로, 위 길은 이 상판이 받친다.
 */
export function bridgeDecks() {
  const segments = offsetPoints(0, STEP)
  const width = WALL_OFFSET * 2 + 1
  // 지형보다 2m 이상 뜬 곳(입체 교차)만 — 언덕 꼭대기에서 격자(2m) 보간으로 살짝 낮아진 곳은 제외.
  // 그 앞뒤 EXTEND 조각까지 이어 깔아, 지형 → 상판으로 넘어가는 경사 부분에 틈이 없게
  const over = segments.map((s) => terrainHeightAt(s.position.x, s.position.z) < s.position.y - 2)
  return segments
    .filter((_, i) => over.slice(Math.max(0, i - EXTEND), i + EXTEND + 1).some(Boolean))
    .map((s) => ({ ...s, width }))
}

/** 상판 물리: 조각마다 상자 하나 (윗면 = 도로면), 정적 body 하나에 묶음 */
export function createDeckBody(decks: ReturnType<typeof bridgeDecks>) {
  const body = new Body({ mass: 0, type: Body.STATIC, material: materials.ground, collisionFilterGroup: GROUP.STATIC })
  const down = new Vector3()
  for (const d of decks) {
    const q = toQuat(d)
    down.set(0, -THICK / 2, 0).applyQuaternion(q)
    body.addShape(
      new Box(new Vec3(d.width / 2, THICK / 2, d.length / 2 + 0.05)),
      new Vec3(d.position.x + down.x, d.position.y + down.y, d.position.z + down.z),
      new CQuaternion(q.x, q.y, q.z, q.w),
    )
  }
  return body
}

export default function Bridge() {
  const decks = useMemo(bridgeDecks, [])
  const world = useWorld()
  useEffect(() => {
    if (!decks.length) return
    const body = createDeckBody(decks)
    world.addBody(body)
    return () => {
      world.removeBody(body)
    }
  }, [world, decks])

  const ref = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new Matrix4()
    const down = new Vector3()
    decks.forEach((d, i) => {
      const q = toQuat(d)
      down.set(0, -LOOK / 2 - 0.03, 0).applyQuaternion(q) // 도로 리본 바로 아래
      m.compose(d.position.clone().add(down), q, new Vector3(d.width, LOOK, d.length + 0.1))
      mesh.setMatrixAt(i, m)
    })
    mesh.instanceMatrix.needsUpdate = true
  }, [decks])

  if (!decks.length) return null
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, decks.length]} castShadow receiveShadow>
      <boxGeometry />
      <meshStandardMaterial color="#8a8378" roughness={0.9} />
    </instancedMesh>
  )
}

import { useFrame } from '@react-three/fiber'
import { Body, Cylinder } from 'cannon-es'
import { useEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import { useWorld } from '../physics/PhysicsWorld'
import { GROUP, materials } from '../physics/world'
import { ROAD_WIDTH, SAMPLE_SPACING, centerPoints, curvature, frames, trackVersion } from './trackData'

/** 코너 안쪽에 놓인 라바콘 — 부딪히면 넘어진다 */
function Cone({ position }: { position: [number, number, number] }) {
  const world = useWorld()
  const ref = useRef<Group>(null)
  const body = useMemo(() => {
    const b = new Body({
      mass: 2,
      material: materials.prop,
      collisionFilterGroup: GROUP.PROP,
      collisionFilterMask: GROUP.STATIC | GROUP.KART | GROUP.PROP,
    })
    b.addShape(new Cylinder(0.08, 0.25, 0.7, 8))
    b.position.set(...position)
    return b
    // 초기 위치는 처음 한 번만 쓴다 (이후엔 물리가 움직임)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    world.addBody(body)
    return () => world.removeBody(body)
  }, [world, body])
  // 물리 결과(보간된 위치·회전)를 화면에 반영
  useFrame(() => {
    const g = ref.current
    if (!g) return
    const p = body.interpolatedPosition
    const q = body.interpolatedQuaternion
    g.position.set(p.x, p.y, p.z)
    g.quaternion.set(q.x, q.y, q.z, q.w)
  })
  return (
    <group ref={ref}>
      <mesh castShadow>
        <cylinderGeometry args={[0.06, 0.25, 0.7, 12]} />
        <meshStandardMaterial color="#ff6d00" />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.15, 0.19, 0.12, 12]} />
        <meshStandardMaterial color="#fff" />
      </mesh>
      <mesh position={[0, -0.33, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.55, 0.04, 0.55]} />
        <meshStandardMaterial color="#e65100" />
      </mesh>
    </group>
  )
}

/** 가장 급한 코너 3곳의 에이펙스 샘플 인덱스와 안쪽 방향 (+1: 왼쪽) */
function findApexes() {
  const n = curvature.length
  const order = curvature.map((c, i) => ({ i, c: Math.abs(c) })).sort((a, b) => b.c - a.c)
  const apexes: number[] = []
  for (const { i } of order) {
    const farEnough = apexes.every((a) => Math.min(Math.abs(a - i), n - Math.abs(a - i)) * SAMPLE_SPACING > 60)
    if (farEnough) apexes.push(i)
    if (apexes.length === 3) break
  }
  // 좌회전 코너면 왼쪽(+1)이 안쪽
  return apexes.map((index) => ({ index, side: (curvature[index] > 0 ? 1 : -1) as 1 | -1 }))
}

let apexCache: { version: number; apexes: ReturnType<typeof findApexes> } | null = null
/** 지금 맵에서 가장 급한 코너 3곳 (맵이 바뀌면 다시 찾는다) — 타이어 더미도 쓴다 */
export function getApexes() {
  if (!apexCache || apexCache.version !== trackVersion) apexCache = { version: trackVersion, apexes: findApexes() }
  return apexCache.apexes
}

/** 에이펙스 앞뒤 10m 간격으로 콘 3개씩 */
function findPlacements() {
  const n = curvature.length
  return getApexes().flatMap(({ index: apex, side }) =>
    [-10, 0, 10].map((meters) => ({ index: (apex + Math.round(meters / SAMPLE_SPACING) + n) % n, side })),
  )
}

export default function Cones() {
  const placements = useMemo(findPlacements, [])
  return (
    <>
      {placements.map(({ index, side }) => {
        const p = centerPoints[index]
        const l = frames[index].left
        const d = (ROAD_WIDTH / 2 - 1) * side
        return <Cone key={index} position={[p.x + l.x * d, p.y + 0.45, p.z + l.z * d]} />
      })}
    </>
  )
}

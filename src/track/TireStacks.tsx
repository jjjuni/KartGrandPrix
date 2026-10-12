import { Body, Box, Quaternion as CQuaternion, Vec3 } from 'cannon-es'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Color, Object3D, type InstancedMesh } from 'three'
import { useWorld } from '../physics/PhysicsWorld'
import { GROUP, materials } from '../physics/world'
import { APEXES } from './Cones'
import { WALL_OFFSET, centerPoints, frames, offsetPoints } from './trackData'

const SPAN = 14 // 에이펙스 앞뒤로 쌓는 범위 (m)
const STEP = 0.62 // 타이어 더미 간격
const LAYERS = 4
const TIRE_R = 0.3
const TIRE_H = 0.2
const BLACK = new Color('#1b1b1b')
const WHITE = new Color('#f0f0f0')
const RED = new Color('#d32f2f')
const COLLIDER_HEIGHT = 1.4
const CHUNK = 2 // 충돌 박스 하나가 덮는 길이 (m)
const OFFSET = WALL_OFFSET - 0.3 - TIRE_R // 방벽 안쪽 면에 붙여 쌓음

/** 급한 코너 바깥 방벽 앞에 쌓아 둔 타이어 더미. 물리는 구간별 박스로 단순화 */
export default function TireStacks() {
  const ref = useRef<InstancedMesh>(null)

  const tires = useMemo(() => {
    const list: { x: number; y: number; z: number; rot: number; color: Color }[] = []
    // 바깥 방벽 앞 곡선을 STEP 간격으로 고르게 나눈 점 (코너 바깥쪽이 왼쪽/오른쪽인 경우 각각)
    const rows = { 1: offsetPoints(OFFSET, STEP), [-1]: offsetPoints(-OFFSET, STEP) }
    APEXES.forEach(({ index: apex, side }) => {
      const out = -side as 1 | -1 // 코너 바깥쪽
      const a = centerPoints[apex].clone().addScaledVector(frames[apex].left, OFFSET * out)
      const near = rows[out].filter((seg) => seg.position.distanceTo(a) < SPAN)
      near.forEach((seg, k) => {
        const p = seg.position
        // 세 더미마다 한 번 흰색, 그 사이 가끔 빨간 띠
        const stackColor = k % 3 === 0 ? WHITE : k % 6 === 4 ? RED : BLACK
        for (let layer = 0; layer < LAYERS; layer++) {
          list.push({
            x: p.x,
            y: p.y + TIRE_H / 2 + layer * TIRE_H,
            z: p.z,
            rot: (k * 1.7 + layer) % Math.PI,
            color: layer === LAYERS - 1 || stackColor !== RED ? stackColor : BLACK,
          })
        }
      })
    })
    return list
  }, [])

  // 충돌: 에이펙스마다 정적 body 하나에 CHUNK 길이의 박스를 이어 붙임
  const world = useWorld()
  const bodies = useMemo(() => {
    const rows = { 1: offsetPoints(OFFSET, CHUNK), [-1]: offsetPoints(-OFFSET, CHUNK) }
    const shape = new Box(new Vec3(TIRE_R, COLLIDER_HEIGHT / 2, CHUNK / 2 + 0.1))
    return APEXES.map(({ index: apex, side }) => {
      const out = -side as 1 | -1
      const a = centerPoints[apex].clone().addScaledVector(frames[apex].left, OFFSET * out)
      const body = new Body({ mass: 0, type: Body.STATIC, material: materials.wall, collisionFilterGroup: GROUP.STATIC })
      body.position.set(a.x, a.y, a.z)
      for (const seg of rows[out].filter((sg) => sg.position.distanceTo(a) < SPAN + CHUNK / 2)) {
        const p = seg.position
        const offset = new Vec3(p.x - a.x, p.y + COLLIDER_HEIGHT / 2 - a.y, p.z - a.z)
        body.addShape(shape, offset, new CQuaternion().setFromEuler(0, seg.yaw, 0))
      }
      return body
    })
  }, [])
  useEffect(() => {
    for (const b of bodies) world.addBody(b)
    return () => bodies.forEach((b) => world.removeBody(b))
  }, [world, bodies])

  useLayoutEffect(() => {
    const mesh = ref.current!
    const dummy = new Object3D()
    tires.forEach((t, i) => {
      dummy.position.set(t.x, t.y, t.z)
      dummy.rotation.set(Math.PI / 2, 0, t.rot)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, t.color)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor!.needsUpdate = true
  }, [tires])

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, tires.length]} castShadow receiveShadow>
      <torusGeometry args={[TIRE_R - TIRE_H / 2, TIRE_H / 2, 8, 16]} />
      <meshStandardMaterial roughness={0.9} />
    </instancedMesh>
  )
}

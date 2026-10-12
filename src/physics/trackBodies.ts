import { Body, Box, Heightfield, Quaternion, Vec3 } from 'cannon-es'
import { TERRAIN_ELEMENT, TERRAIN_MAX_Z, TERRAIN_MIN_X, terrainHeights } from '../track/terrain'
import type { Segment } from '../track/trackData'
import { GROUP, materials } from './world'

/**
 * 지형 Heightfield. cannon Heightfield는 로컬 Z가 높이 → X축으로 -90도 눕히면 로컬 Y가 월드 -Z가 된다.
 * 그래서 원점을 (최소 X, 최대 Z) 모서리에 둔다 (terrain.ts의 gridX/gridZ와 같은 규칙)
 */
export function createGroundBody() {
  const body = new Body({
    mass: 0,
    type: Body.STATIC,
    material: materials.ground,
    collisionFilterGroup: GROUP.STATIC,
  })
  body.addShape(new Heightfield(terrainHeights, { elementSize: TERRAIN_ELEMENT }))
  body.position.set(TERRAIN_MIN_X, 0, TERRAIN_MAX_Z)
  body.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
  return body
}

export const WALL_THICKNESS = 0.6
export const WALL_COLLIDER_HEIGHT = 2.5 // 보이는 높이보다 높게 — 부스터로 부딪혀 튀어도 넘어가지 못하게

const WALLS_PER_BODY = 12 // 세그먼트 여러 개를 body 하나에 묶어 broadphase 비용을 줄인다

/** 세그먼트 하나의 방벽 박스 중심·회전 (물리와 화면이 같은 값을 쓴다) */
export function wallTransform(s: Segment) {
  const position = new Vec3(s.position.x, s.position.y + WALL_COLLIDER_HEIGHT / 2, s.position.z)
  const quaternion = new Quaternion().setFromEuler(...s.rotation)
  return { position, quaternion }
}

/**
 * 방벽 정적 body들. 세그먼트(경사를 따라 기울어진 박스)를 WALLS_PER_BODY개씩 묶는다.
 * 세그먼트마다 body를 따로 두면 수백 개가 되어 매 스텝 broadphase가 크게 느려진다.
 */
export function createWallBodies(segments: Segment[], length: number) {
  const shape = new Box(new Vec3(WALL_THICKNESS / 2, WALL_COLLIDER_HEIGHT / 2, length / 2)) // 같은 크기라 공유
  const bodies: Body[] = []
  for (let start = 0; start < segments.length; start += WALLS_PER_BODY) {
    const chunk = segments.slice(start, start + WALLS_PER_BODY).map(wallTransform)
    const body = new Body({
      mass: 0,
      type: Body.STATIC,
      material: materials.wall,
      collisionFilterGroup: GROUP.STATIC,
    })
    // body 원점 = 묶음의 중심, 각 박스는 그 기준 오프셋
    const center = new Vec3()
    for (const t of chunk) center.vadd(t.position, center)
    center.scale(1 / chunk.length, center)
    body.position.copy(center)
    for (const t of chunk) body.addShape(shape, t.position.vsub(center), t.quaternion)
    bodies.push(body)
  }
  return bodies
}

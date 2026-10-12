import { useEffect } from 'react'
import { useWorld } from '../physics/PhysicsWorld'
import { addContactMaterials } from '../physics/world'

/**
 * 차체·바닥·벽·소품 사이 마찰/반발 설정을 물리 월드에 등록한다 (내용은 physics/world.ts).
 * 바퀴 접지력은 타이어 모델(physics/vehicle.ts)이 따로 계산하므로, 여기서는 차체가 직접 닿을 때만 해당한다.
 */
export default function ContactMaterials() {
  const world = useWorld()
  useEffect(() => addContactMaterials(world), [world])
  return null
}

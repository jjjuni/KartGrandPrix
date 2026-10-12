import { ContactMaterial, Material, SAPBroadphase, Vec3, World } from 'cannon-es'

/** 물리 고정 스텝 (s). 타이어·서스펜션 힘을 매 스텝 계산하므로 60Hz보다 촘촘하게 */
export const FIXED_STEP = 1 / 120
export const MAX_SUB_STEPS = 10

/** 충돌 그룹 (비트 마스크) */
export const GROUP = {
  STATIC: 1, // 지면, 방벽 — 바퀴 레이캐스트가 맞는 대상
  KART: 2,
  PROP: 4, // 콘 등 움직이는 소품
} as const

export const materials = {
  ground: new Material('ground'),
  wall: new Material('wall'),
  chassis: new Material('chassis'),
  prop: new Material('prop'),
}

export function createWorld() {
  const world = new World({
    gravity: new Vec3(0, -9.81, 0),
    allowSleep: false,
    /**
     * cannon-es는 접촉 마찰 상한을 μ·|g|·질량으로 잡는데, 이 값을 '힘'이 아니라 '스텝당 충격량'으로 적용한다.
     * 그대로 두면 마찰이 1/스텝시간 배(120Hz면 120배) 강해져, 벽에 스치기만 해도 달라붙어 급정거하고 튕겨 돈다.
     * 마찰 계산용 중력에 스텝 시간을 곱해 설정한 μ대로 작용하게 한다.
     */
    frictionGravity: new Vec3(0, 9.81 * FIXED_STEP, 0),
  })
  // 넓은 지형 위에 물체가 흩어져 있을 때 Naive보다 효율적
  world.broadphase = new SAPBroadphase(world)
  world.defaultContactMaterial.friction = 0.3
  world.defaultContactMaterial.restitution = 0.05
  return world
}

/**
 * 차체 박스가 바닥·벽에 직접 닿았을 때의 마찰.
 * 바퀴 접지력은 타이어 모델(vehicle.ts)이 따로 계산하므로 차체 자체는 미끄럽게 해서
 * 거친 착지나 벽에 스칠 때 급정거하지 않고 흘러가게 한다.
 */
export function addContactMaterials(world: World) {
  const { ground, wall, chassis, prop } = materials
  world.addContactMaterial(new ContactMaterial(chassis, ground, { friction: 0.02, restitution: 0 }))
  world.addContactMaterial(new ContactMaterial(chassis, wall, { friction: 0.05, restitution: 0.15 }))
  world.addContactMaterial(new ContactMaterial(chassis, prop, { friction: 0.2, restitution: 0.2 }))
  // 온라인 상대 카트(키네마틱 상자)와의 충돌 — 범퍼카처럼 조금 튕긴다
  world.addContactMaterial(new ContactMaterial(chassis, chassis, { friction: 0.05, restitution: 0.3 }))
  world.addContactMaterial(new ContactMaterial(prop, ground, { friction: 0.6, restitution: 0.1 }))
}

import { Body, Box, Quaternion, RaycastResult, Vec3, type World } from 'cannon-es'
import type { Surface } from '../track/surface'
import { GROUP, materials } from './world'

/**
 * 물리 기반 카트.
 *
 * - 서스펜션: 바퀴마다 아래로 레이캐스트 → 스프링 + 댐퍼 + 안티롤바
 * - 타이어: 슬립각에 비례하는 횡력, 구동/제동력, 마찰원(합력 ≤ μ·하중)
 * - 마찰: 정지마찰(μs) > 운동마찰(μk). 한번 미끄러지면 접지력이 낮아져 미끄러짐이 유지된다 (드리프트가 유지되는 원리)
 * - 드리프트(Shift): 뒷바퀴를 잠깐 잠가(사이드브레이크) 미끄러짐을 시작하고,
 *   Shift를 누르는 동안 뒷바퀴는 운동마찰 상태로 유지. 가속하면 휠스핀으로 앞으로 미는 힘과 횡력이 함께 생긴다.
 * - 부스터: 바퀴가 아닌 무게중심에 작용하는 추진력 → 앞들림 토크가 없다
 *
 * 좌표: 차체 로컬 +Z 앞, +Y 위, +X 왼쪽. body 원점 = 무게중심.
 */
const MASS = 250 // kg (카트 + 운전자). 질량에 따라 아래 서스펜션·관성 값이 함께 정해진다
const G = 9.81
const SAG = 0.055 // 정지 시 서스펜션이 눌리는 길이 (m)
const SPRING_K = (MASS * G) / 4 / SAG // 바퀴 하나가 1/4 하중을 SAG만큼 눌려서 받치는 스프링
const DAMPING_RATIO = 0.8 // 임계감쇠 대비 비율 (1 = 출렁임 없이 가장 빨리 멈춤)

export const KART = {
  mass: MASS,
  /**
   * 관성 모멘트 (kg·m²) — [피치(X축), 요(Y축), 롤(Z축)].
   * 길이 2m·폭 1.3m 차체에 질량이 퍼져 있다고 보고 질량에 비례시킨다 (180kg 기준 55 / 75 / 28)
   */
  inertia: [MASS * 0.305, MASS * 0.42, MASS * 0.155] as const,
  /** 차체 충돌 박스 반크기 (무게중심 기준, 지면 위 약 0.3m) */
  chassisHalf: [0.6, 0.1, 1.0] as const, // 바닥이 지면 위 약 0.2m — 착지 때 서스펜션이 먼저 받도록

  // ---- 바퀴 / 서스펜션 ----
  wheelRadius: 0.3,
  /** 바퀴 연결점 (로컬). 앞바퀴가 무게중심에서 더 멀어서 하중이 뒤로 약간 쏠림 (앞 46 : 뒤 54) */
  wheelX: 0.6,
  frontZ: 0.72,
  rearZ: -0.62,
  restLength: 0.24,
  /** 연결점 높이 = 정지 시 바퀴 중심이 무게중심 높이(지면 위 0.3m = 바퀴 반지름)에 오도록 */
  connectionY: 0.24 - SAG,
  maxCompression: 0.21, // 이보다 더 눌리면 범프 스톱 (차체 바닥이 닿는 눌림은 약 0.25)
  springK: SPRING_K, // N/m (250kg에서 약 11,100)
  damperC: DAMPING_RATIO * 2 * Math.sqrt((SPRING_K * MASS) / 4), // N·s/m, 눌릴 때 (250kg에서 약 1,330)
  /** 늘어날 때(리바운드) 감쇠 배율 — 실제 댐퍼처럼 리바운드를 더 강하게 잡아 착지 후 튕겨 오르지 않게 */
  reboundRatio: 1.8,
  /** 댐퍼 블로오프: 이 속도(m/s) 이상의 압축/신장에는 힘이 더 커지지 않음. 높이맵 격자 모서리에서 생기는 하중 스파이크 방지 */
  damperMaxVelocity: 2,
  antiRoll: SPRING_K * 0.75, // N/m — 좌우 눌림 차이에 대한 복원력

  // ---- 타이어 ----
  muStatic: 2.0, // 정지마찰계수 (접지) — 아케이드 감각으로 실제 슬릭(약 1.5)보다 높게. 고속 조향 한계각도 이 값에 비례
  muKinetic: 1.5, // 운동마찰계수 (미끄러짐) — 정지마찰의 약 3/4
  /** 한계를 넘은 비율이 이만큼(1 = 수요가 한계의 2배)이 될 때까지 마찰이 정지→운동마찰로 서서히 떨어진다 */
  tireFalloff: 1,
  /**
   * 코너링 강성 (하중 1N, 슬립각 1rad당 횡력 N). 슬립각 약 μs/값 ≈ 7~9도에서 포화.
   * 뒷바퀴를 더 단단하게 → 약한 언더스티어 성향: 고속에서 뒤가 먼저 털리지 않는다
   */
  corneringFront: 9,
  corneringRear: 12,
  /** 타이어 하중 민감도: 타이어 힘 계산에 쓰는 하중 상한 (정적 하중의 배수) — 하중이 늘어도 마찰력은 비례해서 늘지 않음 */
  maxTireLoadFactor: 2,
  lowSpeed: 2.5, // 저속에서 슬립각 계산이 튀지 않도록 하는 최소 속도 (m/s)
  rollingResistance: 0.015,
  dragArea: 0.5, // 공기저항 CdA (m²) — 운전자가 그대로 노출된 카트 수준

  // ---- 잔디 (도로 밖) ----
  grassGrip: 0.7, // 마찰계수 배율 — 잔디는 미끄럽다
  grassRolling: 0.06, // 구름저항 계수 (도로 0.015)
  /** 속도에 비례하는 저항 (N per m/s, 네 바퀴 합계) — 바퀴가 잔디·흙을 밀고 나가는 저항. 잔디 최고속도 약 50km/h */
  grassDrag: 95,
  /** 빙판 위 접지력 배율 (극지 맵) — 주행 보조도 이만큼 약해진다 */
  iceGrip: 1,

  // ---- 벽 충돌 ----
  /**
   * 충돌 마찰계수: 벽을 따라가는 속도를 (충돌로 없어진 벽 방향 속도 × 이 값)만큼 깎는다.
   * 쿨롱 마찰(접선 충격량 ≤ μ × 수직 충격량) — 세게, 깊은 각도로 부딪힐수록 많이 느려진다
   */
  wallImpactFriction: 0.8,
  wallScrapeDecel: 5, // 벽에 붙어 긁는 동안의 감속 (m/s²)

  // ---- 주차 ----
  /** 입력이 없고 이 속도(m/s)보다 느리면 P(주차): 네 바퀴를 정지마찰 한도 안에서 붙잡아 경사에서도 서 있는다 */
  parkSpeed: 2,

  // ---- 구동 ----
  /**
   * 엔진 출력 (W). 구동력 = min(engineForce, 출력 / 속도) — 저속에선 접지력(마찰원)에, 고속에선 출력에 걸린다.
   * 고속으로 갈수록 가속이 줄어드는 실제 차의 특성이 그대로 나온다.
   */
  enginePower: 22000,
  engineForce: 2600, // 저속 최대 구동력 (N, 뒷바퀴 합계)
  reverseForce: 900,
  brakeForce: MASS * G * 1.4, // 네 바퀴 합계 — 실제로는 마찰원에 걸려 제한됨
  maxSpeed: 100 / 3.6, // 엔진 거버너 (m/s)
  maxReverseSpeed: 15 / 3.6,
  maxSteer: 0.5, // 저속 최대 조향각 (rad)
  /**
   * 속도 감응 조향: 키를 끝까지 눌렀을 때의 조향각 = 그 속도에서 타이어 한계로 돌 수 있는 반경에 맞는 각도 + 여유.
   * 조향각 ≈ 휠베이스 / (v² / (μ·g)) + steerMargin. 고속에서 키보드 입력이 타이어 한계를 넘겨 뒤가 털리는 것 방지
   */
  steerMargin: 0.07,
  /** 타이어 한계 조향각의 배수 — 언더스티어 세팅(앞이 먼저 포화)이라 한계보다 더 꺾어도 대부분 앞바퀴 슬립으로 흡수된다 */
  steerLimitScale: 2,
  minSteer: 0.03, // 최고속도에서 타이어 한계 각(약 0.026rad)보다 크면 안 됨 — 크면 그만큼 뒤가 털린다
  steerRate: 4, // 저속 조향 속도 (rad/s) — 최고속도에서는 절반 (드리프트 아닐 때)

  // ---- 드리프트 ----
  driftMinSpeed: 28 / 3.6,
  /** 드리프트 중 뒷바퀴 마찰계수 — muKinetic과 분리: 접지력을 올려도 드리프트 감속은 원래 튜닝(1.12) 그대로 */
  driftGrip: 1.12,
  handbrakeTime: 0.15, // 드리프트 시작 시 뒷바퀴를 잠그는 시간 (s)
  /** 드리프트 중 가속 시 뒷바퀴 표면이 지면보다 빠르게 도는 속도 (m/s) — 클수록 앞으로 미는 비중이 커짐 */
  wheelSpin: 1,
  /**
   * 드리프트 보조 (게임 보조) — 앞바퀴는 언제나 방향키대로 두고(자동 역조향 없음),
   * 드리프트 각은 차체 회전(요)을 직접 조절해 목표 각에 맞춘다: 얕으면 안쪽으로, 깊으면 바깥쪽으로.
   */
  driftAngle: 0.6, // 목표 드리프트 각 (rad, 약 34도) — 차체가 진행 방향보다 안쪽을 향하는 각도
  driftAngleTight: 0.2, // 같은 방향키: 목표 각 + (더 깊게)
  driftAngleWide: 0.4, // 반대 방향키: 목표 각 − (거의 펴서 넓게 — 뒷바퀴 힘이 주로 앞으로)
  driftYawAssist: 35, // 드리프트 각 오차 → 차체 회전 가속 (rad/s² per rad)
  driftYawDamping: 8, // 드리프트 각 변화 속도 → 반대 회전 (1/s) — 출렁임 방지
  /** 드리프트가 아닌데 뒤가 미끄러질 때(탈출 직후 등) 차체 회전을 줄이는 정도 (1/s) — 앞바퀴 대신 스핀을 막는다 */
  slideYawDamping: 4,
  driftFrontGrip: 0.15, // 드리프트 중 앞바퀴 접지력 배율

  // ---- 주행 보조 (게임 보조 — 드리프트가 아닐 때, 바퀴가 땅에 있을 때) ----
  /** 옆으로 미끄러지는 속도를 줄이는 빠르기 (1/s) — 고속에서 꺾어도 뒤가 털리지 않게 */
  gripAssist: 8,
  /** 차체 회전 속도를 앞바퀴 각도(자전거 모델)에 맞추는 빠르기 (1/s) — 꺾은 만큼 실제로 돈다 */
  yawFollow: 8,
  /** 보조로 낼 수 있는 최대 옆 가속도 (m/s², 약 2.5g) — 이보다 급하게는 못 꺾는다 */
  maxLateralAccel: 25,
  /** 드리프트를 끊은 뒤 보조가 0에서 최대까지 서서히 켜지는 시간 (s) — 그동안 움직이던 방향으로 조금 더 흘러간다 */
  driftExitBlend: 0.8,
  gaugeDistance: 110, // 뒷바퀴가 4m/s 이상 옆으로 미끄러지며 이만큼(m) 달리면 게이지가 가득

  // ---- 공중 자세 보조 (게임 보조 — 네 바퀴가 모두 떠 있을 때만) ----
  airTiltDamping: 1.5, // 피치·롤 회전 감쇠 (1/s)
  airLevel: 6, // 수평으로 세우는 각가속도 (rad/s² per rad)
  airGravity: 7, // 공중에서 더하는 아래 방향 가속도 (m/s²) — 중력 1.7배쯤: 덜 둥둥 뜨고 묵직하게 떨어진다
  // 착지 흡수: 이 속도(m/s)보다 빠르게 떨어지며 내려앉으면 landingAbsorb초 동안 튕겨 오르는 위 속도를 빠르게 없앤다
  // (높이 떨어져도 통통 튀지 않게). 둔덕을 넘는 가벼운 착지에는 작동하지 않는다
  landingImpact: 7,
  landingAbsorb: 0.4,
  landingDamp: 25, // 튕겨 오르는 속도를 줄이는 빠르기 (1/s)

  // ---- 부스터 ----
  /** Z 부스터: 게이지가 가득 찼을 때 ↑를 누른 상태에서 Z. ↑를 떼면 즉시 끝난다 */
  boostDuration: 3,
  boostKick: 2.5, // 부스터 시작 순간 속도 증가 (m/s) — 무게중심에 충격량으로
  /** 순간 부스터: 드리프트 탈출(Shift를 뗀 순간) 후 boostWindow 안에 ↑ 재입력. 게이지를 쓰지 않는 짧은 가속 */
  boostWindow: 0.2,
  minDriftTime: 0.3,
  instantBoostTime: 0.6,
  instantBoostKick: 1.5,
  /** 스타트 부스터 (초록불에 맞춰 ↑) — 드리프트 순간 부스터보다 길고 세게 */
  startBoostTime: 1.1,
  startBoostKick: 2.2,
  boostThrust: MASS * 9, // 무게중심에 작용하는 추진력 (N) — 약 0.9g
  boostMaxSpeed: 130 / 3.6,
}

/** 방 속도 등급 (방을 만들 때 고름) */
export type SpeedClass = 'normal' | 'fast' | 'faster'

// 등급별 배율: 최고속도(부스터 최고속도 포함) · 엔진 출력(고속 가속) · 저속 구동력(초반 가속)
const SPEED_CLASSES: Record<SpeedClass, { speed: number; power: number; force: number }> = {
  normal: { speed: 1, power: 1, force: 1 },
  fast: { speed: 1.25, power: 1.45, force: 1.15 },
  faster: { speed: 1.5, power: 2, force: 1.3 },
}

/** 차량 종류 (모양과 일부 성능이 다르다) */
export type Vehicle = 'kart' | 'bike'

// 차량별 배율: 바이크는 게이지가 빨리 차는 대신 Z 부스터가 짧고, 최고속도가 아주 조금 높다
const VEHICLE_STATS: Record<Vehicle, { speed: number; gauge: number; boost: number }> = {
  kart: { speed: 1, gauge: 1, boost: 1 },
  bike: { speed: 1.03, gauge: 1.25, boost: 0.8 },
}

const BASE = {
  maxSpeed: KART.maxSpeed,
  boostMaxSpeed: KART.boostMaxSpeed,
  enginePower: KART.enginePower,
  engineForce: KART.engineForce,
  gaugeDistance: KART.gaugeDistance,
  boostDuration: KART.boostDuration,
}
let speedClass: SpeedClass = 'normal'
let vehicle: Vehicle = 'kart'

/** 방 속도 등급 × 차량 배율을 KART에 적용 (내 카트 하나에만 쓰이는 값) */
function applyTuning() {
  const k = SPEED_CLASSES[speedClass] ?? SPEED_CLASSES.normal
  const v = VEHICLE_STATS[vehicle] ?? VEHICLE_STATS.kart
  KART.maxSpeed = BASE.maxSpeed * k.speed * v.speed
  KART.boostMaxSpeed = BASE.boostMaxSpeed * k.speed * v.speed
  KART.enginePower = BASE.enginePower * k.power * v.speed // 높아진 최고속도까지 닿도록 출력도 같은 만큼
  KART.engineForce = BASE.engineForce * k.force
  KART.gaugeDistance = BASE.gaugeDistance / v.gauge
  KART.boostDuration = BASE.boostDuration * v.boost
}

/** 방에 들어갈 때 그 방의 속도 등급으로 맞춘다 (대기실로 나오면 normal) */
export function setSpeedClass(cls: SpeedClass) {
  speedClass = cls
  applyTuning()
}

/** 맵의 노면 특성: 코스 밖(잔디·모래·눈)의 접지력·저항, 빙판 접지력 */
export function setSurfaceTuning(s: { offGrip: number; offDrag: number; offRolling: number; iceGrip: number }) {
  KART.grassGrip = s.offGrip
  KART.grassDrag = s.offDrag
  KART.grassRolling = s.offRolling
  KART.iceGrip = s.iceGrip
}

/** 내가 고른 차량의 성능으로 맞춘다 */
export function setVehicleStats(v: Vehicle) {
  vehicle = v
  applyTuning()
}

export type Gear = 'P' | 'R' | 'D'
export type BoostKind = 'none' | 'instant' | 'full'

export type DriveInput = {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
  brake: boolean
  /** Z 부스터 */
  boost: boolean
  drift: boolean
}

export type WheelState = {
  local: Vec3
  front: boolean
  contact: boolean
  compression: number
  /** 연결점에서 바퀴 중심까지 거리 (화면 표시용) */
  springLength: number
  load: number
  steer: number
  spin: number
  sliding: boolean
  /** 접지점이 미끄러지는 속도 (m/s) — 불꽃·게이지에 사용 */
  slipSpeed: number
  hitPoint: Vec3
  hitNormal: Vec3
  surface: Surface
}

const UP = new Vec3(0, 1, 0)
const FWD = new Vec3(0, 0, 1)
const LEFT = new Vec3(1, 0, 0)

// 매 스텝 재사용하는 임시 객체
const tmp = {
  up: new Vec3(),
  fwd: new Vec3(),
  left: new Vec3(),
  conn: new Vec3(),
  to: new Vec3(),
  rel: new Vec3(),
  dir: new Vec3(),
  f: new Vec3(),
  l: new Vec3(),
  v: new Vec3(),
  force: new Vec3(),
  q: new Quaternion(),
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/**
 * 이 속도(전진 m/s)에서 방향키를 끝까지 눌렀을 때의 앞바퀴 각도 (rad).
 * 여유각은 고속으로 갈수록 줄여, 최고속도에서는 타이어 한계 각도만 남긴다 (살짝 꺾어도 뒤가 털리지 않게).
 * 물리 조향과 화면 표시(바퀴 각도 · 바이크 기울기)가 같이 쓴다.
 */
export function steerLimit(vLong: number) {
  const speedRatio = clamp(Math.abs(vLong) / KART.maxSpeed, 0, 1)
  const wheelBase = KART.frontZ - KART.rearZ
  const limit =
    (KART.steerLimitScale * wheelBase * KART.muStatic * G) / Math.max(vLong * vLong, 1) +
    KART.steerMargin * (1 - speedRatio)
  return clamp(limit, KART.minSteer, KART.maxSteer)
}

export class KartPhysics {
  readonly body: Body
  readonly wheels: WheelState[]
  private readonly world: World
  private readonly ray = new RaycastResult()
  private readonly onPreStep = () => this.step(this.world.dt)
  /** 직전 스텝이 끝났을 때의 속도 — 이번 스텝의 충돌 해결 전 속도 (벽 충돌 세기 계산용) */
  private readonly prevVelocity = new Vec3()
  private readonly onPostStep = () => this.prevVelocity.copy(this.body.velocity)
  private readonly surfaceAt: (x: number, z: number) => Surface

  input: DriveInput = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    brake: false,
    boost: false,
    drift: false,
  }
  steer = 0
  /** 화면에 보이는 앞바퀴 각도 (rad): 이 속도의 조향 한계 대비 비율 × 저속 최대 각 — 고속에서도 꺾는 게 잘 보이게 */
  steerVisual = 0

  // ---- 게임 상태 ----
  drifting = false
  driftDir = 0
  driftTime = 0
  handbrake = 0
  gauge = 0
  boostWindow = 0
  boostTime = 0
  boostKind: BoostKind = 'none'
  /** true로 두면 다음 스텝에 순간 부스터 (출발 신호에 맞춘 스타트 부스터 — Kart.tsx가 건다) */
  queueStartBoost = false
  gear: Gear = 'P'
  private prevForward = false
  private prevBoost = false
  private prevDriftAngle = 0
  /** 마지막 드리프트가 끝난 뒤 지난 시간 (s) */
  private sinceDrift = 99

  // ---- 관측값 (HUD·이펙트·테스트용) ----
  forwardSpeed = 0
  bodySlip = 0
  groundedWheels = 0
  private wasAirborne = false
  private landingTime = 0
  rearSlide = 0
  /** 잔디 위 바퀴 수 */
  offRoadWheels = 0
  /** 이번 스텝에 벽에 닿아 있는지 */
  touchingWall = false
  /** 지난번 읽은 뒤 가장 세게 벽에 부딪힌 세기 (줄어든 속도 m/s) — 충돌 소리용, 읽는 쪽이 0으로 되돌린다 */
  wallImpact = 0

  /** surfaceAt: 위치의 노면 판정 (기본: 전부 도로) — track/surface.ts의 createSurfaceTracker() */
  constructor(
    world: World,
    position: [number, number, number],
    yaw: number,
    surfaceAt: (x: number, z: number) => Surface = () => 'road',
  ) {
    this.world = world
    this.surfaceAt = surfaceAt
    const [hx, hy, hz] = KART.chassisHalf
    this.body = new Body({
      mass: KART.mass,
      material: materials.chassis,
      collisionFilterGroup: GROUP.KART,
      collisionFilterMask: GROUP.STATIC | GROUP.PROP,
      angularDamping: 0.05,
      linearDamping: 0,
    })
    this.body.addShape(new Box(new Vec3(hx, hy, hz)))
    // 박스 모양으로 자동 계산된 관성 대신 운전자·엔진을 포함한 실제 카트에 가까운 값
    const [ix, iy, iz] = KART.inertia
    this.body.inertia.set(ix, iy, iz)
    this.body.invInertia.set(1 / ix, 1 / iy, 1 / iz)
    this.body.updateInertiaWorld(true)

    const { wheelX, frontZ, rearZ, connectionY } = KART
    this.wheels = [
      [wheelX, frontZ, true], // 0 앞-왼
      [-wheelX, frontZ, true], // 1 앞-오
      [wheelX, rearZ, false], // 2 뒤-왼
      [-wheelX, rearZ, false], // 3 뒤-오
    ].map(([x, z, front]) => ({
      local: new Vec3(x as number, connectionY, z as number),
      front: front as boolean,
      contact: false,
      compression: 0,
      springLength: KART.restLength,
      load: 0,
      steer: 0,
      spin: 0,
      sliding: false,
      slipSpeed: 0,
      hitPoint: new Vec3(),
      hitNormal: new Vec3(),
      surface: 'road' as Surface,
    }))

    this.reset(position, yaw)
    world.addBody(this.body)
    world.addEventListener('preStep', this.onPreStep)
    world.addEventListener('postStep', this.onPostStep)
  }

  dispose() {
    this.world.removeEventListener('preStep', this.onPreStep)
    this.world.removeEventListener('postStep', this.onPostStep)
    this.world.removeBody(this.body)
  }

  reset(position: [number, number, number], yaw: number) {
    const b = this.body
    b.position.set(...position)
    b.previousPosition.copy(b.position)
    b.interpolatedPosition.copy(b.position)
    b.quaternion.setFromEuler(0, yaw, 0)
    b.previousQuaternion.copy(b.quaternion)
    b.interpolatedQuaternion.copy(b.quaternion)
    b.velocity.setZero()
    this.prevVelocity.setZero()
    b.angularVelocity.setZero()
    b.force.setZero()
    b.torque.setZero()
    for (const w of this.wheels) {
      w.compression = 0
      w.sliding = false
    }
    this.drifting = false
    this.handbrake = 0
    this.boostTime = 0
    this.boostKind = 'none'
    this.boostWindow = 0
    this.steer = 0
    this.steerVisual = 0
  }

  private endDrift(allowBoost: boolean) {
    this.drifting = false
    this.handbrake = 0
    if (allowBoost && this.driftTime >= KART.minDriftTime) this.boostWindow = KART.boostWindow
  }

  /** 물리 스텝마다 호출 (world preStep) */
  step(dt: number) {
    const b = this.body
    const input = this.input
    const { up, fwd, left } = tmp
    b.quaternion.vmult(UP, up)
    b.quaternion.vmult(FWD, fwd)
    b.quaternion.vmult(LEFT, left)

    const vel = b.velocity
    const vLongBody = vel.dot(fwd)
    const vLatBody = vel.dot(left)
    const speed = Math.hypot(vLongBody, vLatBody)
    this.forwardSpeed = vLongBody
    this.bodySlip = speed > 1 ? Math.atan2(vLatBody, Math.abs(vLongBody)) : 0
    const steerInput = (input.left ? 1 : 0) - (input.right ? 1 : 0)
    const grounded = this.groundedWheels >= 2

    // ---------------- 드리프트 상태 ----------------
    if (!this.drifting && input.drift && steerInput !== 0 && grounded && vLongBody > KART.driftMinSpeed) {
      this.drifting = true
      this.driftDir = steerInput
      this.driftTime = 0
      this.handbrake = KART.handbrakeTime
      this.boostWindow = 0
    } else if (this.drifting) {
      this.driftTime += dt
      this.sinceDrift = 0
      this.handbrake = Math.max(0, this.handbrake - dt)
      if (!input.drift) this.endDrift(true)
      else if (vLongBody < KART.driftMinSpeed * 0.5) this.endDrift(false)
    }

    // ---------------- 부스터 ----------------
    const forwardPressed = input.forward && !this.prevForward
    this.prevForward = input.forward
    const boostPressed = input.boost && !this.prevBoost
    this.prevBoost = input.boost
    const startBoost = (time: number, kind: BoostKind, kick: number) => {
      this.boostTime = time
      this.boostKind = kind
      // 무게중심에 충격량 → 회전(앞들림) 없이 속도만 증가
      tmp.dir.set(fwd.x, 0, fwd.z)
      tmp.dir.normalize()
      b.applyImpulse(tmp.dir.scale(KART.mass * kick, tmp.force))
    }
    if (this.queueStartBoost) {
      this.queueStartBoost = false
      startBoost(KART.startBoostTime, 'instant', KART.startBoostKick)
    }
    // 순간 부스터: 드리프트 탈출 직후 ↑ 재입력 (게이지 소모 없음)
    if (this.boostWindow > 0) {
      this.boostWindow = Math.max(0, this.boostWindow - dt)
      if (forwardPressed) {
        this.boostWindow = 0
        if (this.boostKind !== 'full') startBoost(KART.instantBoostTime, 'instant', KART.instantBoostKick)
      }
    }
    // Z 부스터: 게이지가 가득 찼고 ↑를 누르고 있을 때
    if (boostPressed && this.gauge >= 1 && input.forward) {
      this.gauge = 0
      startBoost(KART.boostDuration, 'full', KART.boostKick)
    }
    // ↑를 떼면 부스터 즉시 종료
    if (!input.forward) this.boostTime = 0
    const boosting = this.boostTime > 0
    if (boosting) this.boostTime = Math.max(0, this.boostTime - dt)
    if (this.boostTime === 0) this.boostKind = 'none'

    // ---------------- 조향 ----------------
    const yawRate = b.angularVelocity.dot(up)
    const speedRatio = clamp(Math.abs(vLongBody) / KART.maxSpeed, 0, 1)
    const rearSliding = this.wheels[2].sliding || this.wheels[3].sliding
    if (this.drifting && vLongBody > 2) {
      const dir = this.driftDir
      const toward = steerInput * dir // +1 같은 방향키(깊게), −1 반대 방향키(얕게)
      const angle = -this.bodySlip * dir // 현재 드리프트 각
      const angleRate = this.driftTime > dt ? (angle - this.prevDriftAngle) / dt : 0
      this.prevDriftAngle = angle
      const targetAngle =
        KART.driftAngle + (toward > 0 ? KART.driftAngleTight : toward < 0 ? -KART.driftAngleWide : 0)
      // 드리프트 각은 차체 회전으로 맞춘다 (얕으면 안쪽, 깊으면 바깥쪽 + 변화 속도 감쇠). 앞바퀴는 아래에서 방향키대로
      const yawAccel = KART.driftYawAssist * (targetAngle - angle) - KART.driftYawDamping * angleRate
      b.angularVelocity.vadd(up.scale(dir * yawAccel * dt, tmp.v), b.angularVelocity)
    }
    if (!this.drifting) this.sinceDrift += dt
    // 드리프트를 끊은 직후에는 보조를 약하게 시작해 서서히 최대로 (끊는 순간 진행 방향이 확 바뀌지 않게)
    const exitBlend = clamp(this.sinceDrift / KART.driftExitBlend, 0, 1)
    if (!this.drifting && rearSliding && vLongBody > 2) {
      // 탈출 직후처럼 뒤가 미끄러지는 동안은 차체 회전을 줄여 스핀을 막는다 (앞바퀴는 건드리지 않음)
      b.angularVelocity.vadd(up.scale(-yawRate * Math.min(1, KART.slideYawDamping * exitBlend * dt), tmp.v), b.angularVelocity)
    }
    // 주행 보조: 드리프트가 아닐 때 옆 미끄러짐을 줄이고, 차체 회전을 앞바퀴 각도에 맞춘다 (옆 가속도 상한 안에서)
    // 빙판 위에서는 보조도 약하게 — 아니면 미끄러운 노면이 느껴지지 않는다
    const onIce = this.wheels.some((w) => w.contact && w.surface === 'ice')
    const assist = exitBlend * (onIce ? KART.iceGrip ** 2 : 1)
    if (!this.drifting && grounded && Math.abs(vLongBody) > 2) {
      const kLat = Math.min(1, KART.gripAssist * assist * dt)
      vel.x -= left.x * vLatBody * kLat
      vel.z -= left.z * vLatBody * kLat
      const maxYaw = KART.maxLateralAccel / Math.abs(vLongBody)
      const yawTarget = clamp((vLongBody * Math.tan(this.steer)) / (KART.frontZ - KART.rearZ), -maxYaw, maxYaw)
      b.angularVelocity.vadd(up.scale((yawTarget - yawRate) * Math.min(1, KART.yawFollow * assist * dt), tmp.v), b.angularVelocity)
    }
    // 앞바퀴는 언제나 방향키대로 (드리프트 중에도 자동 역조향 없음)
    const limit = steerLimit(vLongBody)
    const targetSteer = clamp(steerInput * limit, -0.65, 0.65)
    const ds = KART.steerRate * (1 - 0.5 * speedRatio) * dt
    this.steer += clamp(targetSteer - this.steer, -ds, ds)
    this.steerVisual = clamp(this.steer / limit, -1, 1) * KART.maxSteer

    // ---------------- 기어: P(주차) / R / D ----------------
    // 입력 없이 거의 멈추면 P — 네 바퀴를 붙잡아 경사에서도 미끄러져 내려가지 않는다
    const parked = !input.forward && !input.backward && grounded && speed < KART.parkSpeed
    this.gear = parked ? 'P' : vLongBody < -0.3 || (input.backward && vLongBody < 1) ? 'R' : 'D'

    // ---------------- 구동력 (뒷바퀴 합계) ----------------
    let drive = 0
    let braking = input.brake
    if (input.forward) {
      const powerLimited = Math.min(KART.engineForce, KART.enginePower / Math.max(vLongBody, 1))
      drive = powerLimited * clamp((KART.maxSpeed - vLongBody) / 0.8, 0, 1)
    } else if (input.backward) {
      if (vLongBody > 1) braking = true // 앞으로 가는 중 S는 브레이크
      else drive = -KART.reverseForce * clamp((KART.maxReverseSpeed + vLongBody) / 1, 0, 1)
    }

    // ---------------- 바퀴: 서스펜션 + 타이어 ----------------
    let contacts = 0
    let rearSlide = 0
    const rayLength = KART.restLength + KART.wheelRadius + 0.15
    for (const w of this.wheels) {
      const conn = b.pointToWorldFrame(w.local, tmp.conn)
      tmp.to.set(conn.x - up.x * rayLength, conn.y - up.y * rayLength, conn.z - up.z * rayLength)
      this.ray.reset()
      this.world.raycastClosest(conn, tmp.to, { collisionFilterMask: GROUP.STATIC, skipBackfaces: true }, this.ray)
      w.steer = w.front ? this.steer : 0

      if (!this.ray.hasHit) {
        w.contact = false
        w.compression = 0
        w.load = 0
        w.sliding = false
        w.slipSpeed = 0
        w.springLength = Math.min(w.springLength + dt * 2, KART.restLength + 0.15)
        w.spin += (vLongBody / KART.wheelRadius) * dt
        continue
      }
      contacts++
      w.hitPoint.copy(this.ray.hitPointWorld)
      w.hitNormal.copy(this.ray.hitNormalWorld)
      w.surface = this.surfaceAt(w.hitPoint.x, w.hitPoint.z)
      const springLength = Math.max(0, this.ray.distance - KART.wheelRadius)
      const compression = KART.restLength - springLength
      const compVel = (compression - w.compression) / dt
      w.compression = compression
      w.springLength = springLength
      w.contact = compression > -0.001

      const damper = KART.damperC * (compVel < 0 ? KART.reboundRatio : 1)
      let fs = KART.springK * compression + damper * clamp(compVel, -KART.damperMaxVelocity, KART.damperMaxVelocity)
      // 범프 스톱: 끝까지 눌리면 급격히 단단해짐 (차체 바닥이 지면에 닿기 전에 받아줌). 눌리는 중에만 작용해 되튕김 없음
      if (compression > KART.maxCompression && compVel > 0) fs += KART.springK * 15 * (compression - KART.maxCompression)
      w.load = Math.max(0, fs)
    }
    this.groundedWheels = contacts

    // ---------------- 착지 흡수 ----------------
    if (contacts > 0 && this.wasAirborne && this.prevVelocity.y < -KART.landingImpact) this.landingTime = KART.landingAbsorb
    this.wasAirborne = contacts === 0
    if (this.landingTime > 0 && contacts > 0) {
      this.landingTime -= dt
      // 위로 튀어 오르는 속도 중 '오르막을 따라 오르는 데 필요한 만큼'을 넘는 부분만 줄인다 (앞으로 가는 속도는 그대로)
      const n = tmp.dir.set(0, 0, 0)
      for (const w of this.wheels) if (w.contact) n.vadd(w.hitNormal, n)
      n.normalize()
      if (n.y > 0.3) {
        const slopeVy = Math.max(0, -(n.x * vel.x + n.z * vel.z) / n.y)
        const bounce = vel.y - slopeVy
        if (bounce > 0) vel.y -= bounce * Math.min(1, KART.landingDamp * dt)
      }
    }
    this.offRoadWheels = this.wheels.filter((w) => w.contact && w.surface === 'grass').length

    // 안티롤바: 같은 축 좌우 눌림 차이만큼 하중을 옮겨 차체 기울기를 줄인다
    for (const [a, c] of [
      [0, 1],
      [2, 3],
    ]) {
      const wa = this.wheels[a]
      const wc = this.wheels[c]
      if (!wa.contact || !wc.contact) continue
      const arb = KART.antiRoll * (wa.compression - wc.compression)
      wa.load = Math.max(0, wa.load + arb)
      wc.load = Math.max(0, wc.load - arb)
    }

    for (const w of this.wheels) {
      if (!w.contact || w.load <= 0) continue
      const conn = b.pointToWorldFrame(w.local, tmp.conn)
      // 서스펜션 힘: 연결점에 차체 위 방향으로
      conn.vsub(b.position, tmp.rel)
      b.applyForce(up.scale(w.load, tmp.force), tmp.rel)

      // 타이어 좌표계: 접지면에 투영한 바퀴 진행 방향 f, 왼쪽 l
      const p = w.hitPoint
      const n = w.hitNormal
      tmp.q.setFromAxisAngle(UP, w.steer)
      b.quaternion.mult(tmp.q, tmp.q).vmult(FWD, tmp.f)
      tmp.f.vsub(n.scale(tmp.f.dot(n), tmp.v), tmp.f)
      tmp.f.normalize()
      n.cross(tmp.f, tmp.l)
      const f = tmp.f
      const l = tmp.l

      b.getVelocityAtWorldPoint(p, tmp.v)
      const vLong = tmp.v.dot(f)
      const vLat = tmp.v.dot(l)

      let fx = 0
      let fy = 0
      const isRear = !w.front
      const tireLoad = Math.min(w.load, (KART.maxTireLoadFactor * KART.mass * 9.81) / 4)
      const grass = w.surface === 'grass'
      // 드리프트 중 앞바퀴: 방향키대로 꺾여 있어도 노면을 긁어 급감속하지 않게 접지력을 줄인다 (역조향 대신)
      const surfaceGrip = grass ? KART.grassGrip : w.surface === 'ice' ? KART.iceGrip : 1
      const grip = surfaceGrip * (this.drifting && w.front ? KART.driftFrontGrip : 1)
      const muK = KART.muKinetic * grip * tireLoad
      const muS = KART.muStatic * grip * tireLoad

      if (isRear && this.drifting) {
        // ---- 드리프트 중 뒷바퀴: 운동마찰. 힘의 방향 = 접지점 미끄러짐의 반대 방향 ----
        // 잠김(사이드브레이크): 바퀴가 안 돌아서 진행 속도 전체가 미끄러짐
        // 가속 중: 바퀴 표면이 지면보다 wheelSpin만큼 빨리 돌아 앞쪽으로 미는 성분이 생김
        let surface = vLong
        if (this.handbrake > 0) surface = 0
        else if (input.forward && vLongBody < KART.maxSpeed) surface = vLong + KART.wheelSpin
        const sx = vLong - surface
        const sy = vLat
        const slip = Math.hypot(sx, sy)
        const mag = KART.driftGrip * grip * tireLoad * Math.min(1, slip / 0.3) // 미끄러짐이 아주 작으면 힘도 줄여 떨림 방지
        if (slip > 1e-4) {
          fx = (-sx / slip) * mag
          fy = (-sy / slip) * mag
        }
        if (grass) fx -= (vLong * KART.grassDrag) / 4
        w.sliding = true
        w.slipSpeed = slip
        w.spin += (surface / KART.wheelRadius) * dt
      } else {
        // ---- 일반 주행: 구동/제동 + 슬립각 횡력, 마찰원으로 제한 ----
        if (parked) {
          // P: 바퀴를 붙잡는다 — 이 바퀴가 받치는 질량(1/4)의 속도를 한 스텝에 절반씩 없애는 힘 (정지마찰 한도 안)
          const hold = (KART.mass / 4 / dt) * 0.5
          fx = -vLong * hold
          fy = -vLat * hold
        } else {
          if (isRear) fx += drive / 2
          if (braking) fx -= clamp(vLong * 2, -1, 1) * (KART.brakeForce / 4)
          fx -= clamp(vLong / 0.5, -1, 1) * (grass ? KART.grassRolling : KART.rollingResistance) * tireLoad
          if (grass) fx -= (vLong * KART.grassDrag) / 4
          const alpha = Math.atan2(vLat, Math.max(Math.abs(vLong), KART.lowSpeed))
          fy = -(w.front ? KART.corneringFront : KART.corneringRear) * tireLoad * alpha
        }

        const demand = Math.hypot(fx, fy)
        // 실제 타이어처럼 한계(정지마찰)를 넘으면 슬립이 커질수록 마찰이 운동마찰까지 '서서히' 떨어진다.
        // 계단식으로 뚝 떨어지면 고속에서 한계를 살짝만 넘어도 뒤가 갑자기 털린다.
        // 한번 크게 미끄러진 바퀴는 수요가 운동마찰 아래로 내려와야 다시 접지 (드리프트 탈출 후 자연스러운 회복)
        const over = demand / Math.max(muS, 1e-6) - 1 // 한계를 넘은 비율
        const fade = clamp(over / KART.tireFalloff, 0, 1)
        if (!w.sliding && fade >= 1) w.sliding = true
        else if (w.sliding && demand < muK) w.sliding = false
        const cap = w.sliding ? muK : muS - (muS - muK) * fade
        if (demand > cap) {
          fx *= cap / demand
          fy *= cap / demand
        }
        w.slipSpeed = w.sliding || fade > 0.3 ? Math.abs(vLat) : 0
        w.spin += (vLong / KART.wheelRadius) * dt
      }
      if (isRear) rearSlide += Math.abs(vLat) / 2

      tmp.force.set(f.x * fx + l.x * fy, f.y * fx + l.y * fy, f.z * fx + l.z * fy)
      p.vsub(b.position, tmp.rel)
      b.applyForce(tmp.force, tmp.rel)
    }
    this.rearSlide = rearSlide

    // ---------------- 게이지: 뒷바퀴가 미끄러지며 달린 거리만큼 ----------------
    if (this.drifting && contacts >= 2) {
      const moved = Math.hypot(b.velocity.x, b.velocity.z) * dt
      this.gauge = Math.min(1, this.gauge + (moved / KART.gaugeDistance) * clamp(rearSlide / 4, 0, 1))
    }

    // ---------------- 벽 충돌: 충격량에 비례한 마찰 + 긁힘 감속 ----------------
    // cannon의 접촉 마찰은 수직 충격량과 무관하게 작아서, 충돌 순간의 쿨롱 마찰을 직접 적용한다
    let impact = 0
    let wallNormal: Vec3 | null = null
    for (const c of this.world.contacts) {
      let sign = 0
      if (c.bi === b && c.bj.material === materials.wall) sign = 1 // ni: 카트 → 벽
      else if (c.bj === b && c.bi.material === materials.wall) sign = -1
      if (!sign) continue
      tmp.v.set(c.ni.x * sign, 0, c.ni.z * sign)
      const len = tmp.v.length()
      if (len < 1e-3) continue
      tmp.v.scale(1 / len, tmp.v)
      // 이번 스텝 충돌 해결이 없앤 벽 방향 속도 = 수직 충격량 / 질량 (반발 포함)
      const removed = this.prevVelocity.dot(tmp.v) - (vel.x * tmp.v.x + vel.z * tmp.v.z)
      if (!wallNormal || removed > impact) {
        impact = Math.max(0, removed)
        wallNormal = (wallNormal ?? new Vec3()).copy(tmp.v)
      }
    }
    this.touchingWall = wallNormal !== null
    this.wallImpact = Math.max(this.wallImpact, impact)
    if (wallNormal) {
      // 벽을 따라가는(접선) 수평 속도
      const vn = vel.x * wallNormal.x + vel.z * wallNormal.z
      const tx = vel.x - wallNormal.x * vn
      const tz = vel.z - wallNormal.z * vn
      const vt = Math.hypot(tx, tz)
      if (vt > 1e-3) {
        const loss = impact * KART.wallImpactFriction + KART.wallScrapeDecel * dt
        const k = Math.max(0, vt - loss) / vt
        vel.x = wallNormal.x * vn + tx * k
        vel.z = wallNormal.z * vn + tz * k
      }
    }

    // ---------------- 공중 자세 보조 ----------------
    if (contacts === 0) {
      const av = b.angularVelocity
      // 피치·롤만 감쇠 (요는 건드리지 않는다 — 공중에서 저절로 방향이 바뀌지 않게)
      const kt = Math.max(0, 1 - KART.airTiltDamping * dt)
      av.set(av.x * kt, av.y, av.z * kt)
      // 차체 위 방향을 월드 위 방향으로: 회전축 = up × Y, 크기 = sin(기울기)
      tmp.dir.set(-up.z, 0, up.x) // up × (0,1,0)
      av.x += tmp.dir.x * KART.airLevel * dt
      av.z += tmp.dir.z * KART.airLevel * dt
      vel.y -= KART.airGravity * dt
    }

    // ---------------- 공기저항, 부스터 추진 (무게중심) ----------------
    const v = vel.length()
    if (v > 0.1) {
      const drag = 0.5 * 1.2 * KART.dragArea * v
      b.applyForce(vel.scale(-drag, tmp.force))
    }
    if (boosting && vLongBody < KART.boostMaxSpeed) {
      tmp.dir.set(fwd.x, 0, fwd.z)
      tmp.dir.normalize()
      const thrust = KART.boostThrust * clamp((KART.boostMaxSpeed - vLongBody) / 2, 0, 1)
      b.applyForce(tmp.dir.scale(thrust, tmp.force))
    }
  }
}

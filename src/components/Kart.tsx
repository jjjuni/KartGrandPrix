import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import {
  AdditiveBlending,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type PerspectiveCamera,
} from 'three'
import { kartState } from '../game/kartState'
import { crashSound, stopDriveSound, updateDriveSound } from '../game/sound'
import { useControls } from '../hooks/useControls'
import { canDrive, pressForward, takeStartBoost, updateLap } from '../game/race'
import { onHit, onSpawn, sendFinish } from '../net/online'
import { useWorld } from '../physics/PhysicsWorld'
import { KART, KartPhysics } from '../physics/vehicle'
import { createSurfaceTracker } from '../track/surface'
import { WALL_OFFSET, branchDistance, branchWallOffset, ceilingAt, centerPoints, gridPose, nearestSample, poseAt } from '../track/trackData'
import { useOnline } from '../ui/hooks'
import BikeModel from './BikeModel'
import KartModel from './KartModel'
import SkidMarks, { isSkidding, type MarkWheel } from './SkidMarks'
import Wheel from './Wheel'

// 주행·드리프트·부스터 수치는 physics/vehicle.ts의 KART에서 조절

/** KartModel은 원래 차체 중심이 지면 위 약 0.39m인 기준으로 만들어져 있어, 무게중심(0.30m)에서 이만큼 올려 그린다 */
const MODEL_OFFSET_Y = 0.09
const WHEEL_WIDTH = 0.25

// ---- 카메라: 카트 뒤쪽 위에서 따라감 ----
const CAMERA_OFFSET = new Vector3(0, 3, -7)
const CAMERA_LOOK_AHEAD = new Vector3(0, 0.5, 4)
const CAMERA_FOLLOW = 8 // 카메라 위치 보간 속도 (고속에서 카메라가 뒤처지지 않게)
const CAMERA_TURN = 5 // 카메라 방향 보간 속도
const BASE_FOV = 60

const FLIP_RESET_TIME = 1.5 // 뒤집힌 채 이 시간이 지나면 자동 리셋 (s)
const OFF_TRACK_RESET_TIME = 1 // 방벽 밖으로 나간 채 이 시간이 지나면 자동 리셋 (s)

type KartProps = {
  position?: [number, number, number]
  /** 시작 시 바라보는 방향 (Y축 회전, rad) */
  yaw?: number
}

const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b))

export default function Kart({ position = [0, 1, 0], yaw = 0 }: KartProps) {
  const controls = useControls()
  const world = useWorld()
  const kartRef = useRef<KartPhysics | null>(null)
  // 고른 차량 (모양만 다르다). 바이크는 뒷바퀴가 하나라 불꽃·타이어 자국을 가운데 한 줄로
  const { vehicle } = useOnline()
  const isBike = useRef(false)
  isBike.current = vehicle === 'bike'
  const spin = useRef(0) // BikeModel 바퀴 회전용

  useEffect(() => {
    const kart = new KartPhysics(world, position, yaw, createSurfaceTracker())
    kartRef.current = kart
    // 온라인 상대가 나를 들이받으면 그만큼 밀려난다
    // 동굴 천장: 물리 스텝마다 검사해 뚫고 나가지 않고 부딪혀 아래로 튕겨 떨어지게 (가까운 중심선 샘플은 프레임마다 갱신)
    const ceilingHit = () => {
      const b = kart.body
      // 천장은 바로 아래 길 기준: 높이를 보지 않는 수평 거리로 가까운 샘플 (프레임마다 찾은 샘플 근처에서)
      const n = centerPoints.length
      let index = game.current.nearIndex
      let best = Infinity
      for (let k = -40; k <= 40; k++) {
        const i = (game.current.nearIndex + k + n) % n
        const p = centerPoints[i]
        const d = (p.x - b.position.x) ** 2 + (p.z - b.position.z) ** 2
        if (d < best) {
          best = d
          index = i
        }
      }
      const ceiling = ceilingAt(b.position.x, b.position.z, index) - 0.6
      if (b.position.y <= ceiling) return
      b.position.y = ceiling
      if (b.velocity.y > 0) {
        crashSound(b.velocity.y)
        b.velocity.y *= -0.3
      }
    }
    world.addEventListener('postStep', ceilingHit)
    onHit((vx, vz) => {
      kart.body.velocity.x += vx
      kart.body.velocity.z += vz
      crashSound(Math.hypot(vx, vz) * 2)
    })
    // 방에 들어가면 서버가 정해 준 출발 그리드 칸으로 (다른 사람과 겹치지 않게), 대기실로 돌아가면 0번 칸
    onSpawn((slot) => {
      const pose = gridPose(slot)
      kart.reset(pose.position, pose.yaw)
      kart.gauge = 0 // 새 레이스 · 방 입장 · 대기실: 게이지도 비운다 (R 복귀는 reset만 써서 게이지 유지)
    })
    return () => {
      onHit(null)
      onSpawn(null)
      world.removeEventListener('postStep', ceilingHit)
      stopDriveSound()
      kart.dispose()
      kartRef.current = null
    }
    // 시작 위치는 처음 한 번만 사용
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world])

  const chassisRef = useRef<Group>(null)
  const wheelRefs = [useRef<Group>(null), useRef<Group>(null), useRef<Group>(null), useRef<Group>(null)]
  const sparks = [
    useRef<Mesh<BufferGeometry, MeshBasicMaterial>>(null),
    useRef<Mesh<BufferGeometry, MeshBasicMaterial>>(null),
  ]
  const flame = useRef<Group>(null)
  const steer = useRef(0) // KartModel의 핸들·운전자 기울기용

  const game = useRef({ prevReset: false, prevForward: false, flippedTime: 0, offTrackTime: 0, camYaw: yaw, nearIndex: 0 })

  // 타이어 자국용 바퀴 상태 (매 프레임 같은 객체를 채워서 돌려준다)
  const markWheels = useRef<MarkWheel[]>(
    [0, 1, 2, 3].map(() => ({ sliding: false, point: new Vector3(), normal: new Vector3(), slip: 0 })),
  )
  const getMarkWheels = useRef(() => {
    const kart = kartRef.current
    if (!kart) return null
    kart.wheels.forEach((w, i) => {
      const m = markWheels.current[i]
      m.sliding = isSkidding(w)
      m.point.set(w.hitPoint.x, w.hitPoint.y, w.hitPoint.z)
      m.normal.set(w.hitNormal.x, w.hitNormal.y, w.hitNormal.z)
      m.slip = w.slipSpeed
    })
    // 타이어 자국은 뒷바퀴에서만
    const [f0, f1, r0, r1] = markWheels.current
    f0.sliding = f1.sliding = false
    if (isBike.current) {
      r0.sliding ||= r1.sliding
      r0.point.lerp(r1.point, 0.5)
      r1.sliding = false
    }
    return markWheels.current
  }).current
  const tmp = useRef({
    pos: new Vector3(),
    quat: new Quaternion(),
    fwd: new Vector3(),
    up: new Vector3(),
    yawQuat: new Quaternion(),
    camTarget: new Vector3(),
    lookAt: new Vector3(),
    worldUp: new Vector3(0, 1, 0),
  })

  // ---- 물리 스텝 전(priority -2): 입력 전달, 리셋 ----
  useFrame((_, rawDelta) => {
    const kart = kartRef.current
    if (!kart) return
    const delta = Math.min(rawDelta, 0.05)
    const c = controls.current
    const input = kart.input
    // 짧게 눌렀다 뗀 키도 이번 프레임에는 눌린 것으로 전달 (부스터·순간 부스터 입력을 놓치지 않게)
    input.forward = c.forward || c.tapped.has('forward')
    input.backward = c.backward
    input.left = c.left
    input.right = c.right
    input.brake = c.brake
    input.boost = c.boost || c.tapped.has('boost')
    c.tapped.clear()
    input.drift = c.drift
    // 스타트 부스터: 초록불에 맞춰 ↑를 새로 누르면 (판정은 race.ts)
    const gs = game.current
    if (input.forward && !gs.prevForward) pressForward(performance.now())
    if (takeStartBoost()) kart.queueStartBoost = true
    gs.prevForward = input.forward
    // 출발 신호 전(대기실 · 대기 · 카운트다운)에는 좌우 조향만
    if (!canDrive()) {
      input.forward = input.backward = input.brake = input.drift = input.boost = false
    }

    // R은 가장 가까운 트랙 위로, 뒤집히거나 방벽 밖으로 나가거나 떨어져도 자동 리셋
    const g = game.current
    const b = kart.body
    const t = tmp.current
    const q = b.quaternion
    t.up.set(0, 1, 0).applyQuaternion(t.quat.set(q.x, q.y, q.z, q.w))
    g.flippedTime = t.up.y < 0.3 ? g.flippedTime + delta : 0
    const nearest = nearestSample(b.position.x, b.position.z, b.position.y)
    // 바퀴 세기 — 마지막 바퀴를 마친 순간 서버에 도착을 알린다 (기록은 서버가 잰다)
    if (updateLap(nearest.index, centerPoints.length)) sendFinish()
    const offTrack = nearest.distance > WALL_OFFSET + 1.5 && branchDistance(b.position.x, b.position.z) > branchWallOffset() + 1.5
    g.offTrackTime = offTrack ? g.offTrackTime + delta : 0
    // R은 주행 중에만 (대기 · 카운트다운 · 완주 후에는 막는다)
    g.nearIndex = nearest.index
    const resetPressed = c.reset && !g.prevReset && canDrive()
    g.prevReset = c.reset
    if (
      resetPressed ||
      g.flippedTime > FLIP_RESET_TIME ||
      g.offTrackTime > OFF_TRACK_RESET_TIME ||
      b.position.y < -20
    ) {
      const pose = poseAt(nearest.index)
      kart.reset(pose.position, pose.yaw)
      g.flippedTime = 0
      g.offTrackTime = 0
      g.camYaw = pose.yaw
    }
  }, -2)

  // ---- 물리 스텝 후(priority 0): 화면 반영, HUD 상태, 카메라 ----
  useFrame(({ camera }, rawDelta) => {
    const kart = kartRef.current
    const chassis = chassisRef.current
    if (!kart || !chassis) return
    const delta = Math.min(rawDelta, 0.05)
    const g = game.current
    const t = tmp.current
    const b = kart.body

    // 차체: 고정 스텝 사이를 보간한 위치·회전
    const p = b.interpolatedPosition
    const q = b.interpolatedQuaternion
    chassis.position.set(p.x, p.y, p.z)
    chassis.quaternion.set(q.x, q.y, q.z, q.w)
    t.pos.copy(chassis.position)
    t.fwd.set(0, 0, 1).applyQuaternion(chassis.quaternion)
    steer.current = kart.steerVisual // 핸들·운전자·바이크: 보이는 각도 (고속에서도 크게)

    // 바퀴: 서스펜션 길이만큼 아래로, 조향(Y) 후 굴러가는 회전(X)
    kart.wheels.forEach((w, i) => {
      const ref = wheelRefs[i].current
      if (!ref) return
      ref.position.set(w.local.x, w.local.y - w.springLength, w.local.z)
      ref.rotation.set(w.spin % (Math.PI * 2), w.front ? kart.steerVisual : 0, 0, 'YXZ')
    })
    spin.current = kart.wheels[2].spin

    // HUD·조명이 읽는 상태
    const s = kartState
    s.position.copy(t.pos)
    s.quaternion.copy(chassis.quaternion)
    const heading = Math.atan2(t.fwd.x, t.fwd.z)
    s.heading = heading
    s.speedKmh = kart.forwardSpeed * 3.6
    s.gauge = kart.gauge
    s.drifting = kart.drifting
    s.boostWindow = kart.boostWindow
    s.boostTime = kart.boostTime
    s.boostKind = kart.boostKind
    s.boostDuration = kart.boostKind === 'instant' ? KART.instantBoostTime : KART.boostDuration
    s.gear = kart.gear
    s.steer = kart.steerVisual
    // 미끄러지는 바퀴 (비트 0~3 = 바퀴 0~3) — 다른 사람 화면에 타이어 자국을 그리는 데 쓴다
    s.skid = kart.wheels.reduce((bits, w, i) => (isSkidding(w) ? bits | (1 << i) : bits), 0)
    s.offRoad = kart.offRoadWheels >= 2
    s.airborne = kart.groundedWheels === 0
    updateDriveSound(s.speedKmh, kart.input.forward, kart.boostKind, kart.groundedWheels >= 2 ? kart.rearSlide : 0, isBike.current)
    crashSound(kart.wallImpact)
    kart.wallImpact = 0
    const boosting = kart.boostTime > 0

    // ---- 이펙트: 드리프트 불꽃(뒷바퀴가 실제로 미끄러질 때), 부스터 화염 ----
    const sparkColor = kart.gauge >= 1 ? 0x4fc3f7 : 0xffa726
    sparks.forEach((ref, k) => {
      const m = ref.current
      const w = kart.wheels[2 + k]
      if (!m) return
      const on = kart.drifting && w.contact && w.slipSpeed > 2 && !(isBike.current && k === 1)
      m.visible = on
      if (on) {
        m.position.set(
          isBike.current ? 0 : w.local.x,
          w.local.y - w.springLength - KART.wheelRadius + 0.08,
          w.local.z - 0.15,
        )
        m.scale.setScalar(0.6 + Math.random() * 0.8)
        m.material.color.setHex(sparkColor)
      }
    })
    if (flame.current) {
      flame.current.visible = boosting
      if (boosting) flame.current.scale.set(1, 1, 0.8 + Math.random() * 0.6)
    }

    // ---- 추적 카메라 ----
    // 기울거나 튀어도 흔들리지 않도록 Y축 회전만 사용. 드리프트 중에는 차체 방향과 진행 방향의 중간을 바라본다
    const camTargetYaw = kart.drifting ? heading + kart.bodySlip * 0.5 : heading
    g.camYaw += angleDiff(camTargetYaw, g.camYaw) * Math.min(1, CAMERA_TURN * delta)
    t.yawQuat.setFromAxisAngle(t.worldUp, g.camYaw)
    t.camTarget.copy(CAMERA_OFFSET).applyQuaternion(t.yawQuat).add(t.pos)
    camera.position.lerp(t.camTarget, 1 - Math.exp(-CAMERA_FOLLOW * delta))
    t.lookAt.copy(CAMERA_LOOK_AHEAD).applyQuaternion(t.yawQuat).add(t.pos)
    camera.lookAt(t.lookAt)

    // 속도감: 빠를수록, 부스터 중일수록 화각을 넓힘
    const cam = camera as PerspectiveCamera
    const targetFov = BASE_FOV + Math.min(1, Math.max(0, kart.forwardSpeed) / KART.maxSpeed) * 6 + (boosting ? 12 : 0)
    if (Math.abs(cam.fov - targetFov) > 0.05) {
      cam.fov += (targetFov - cam.fov) * Math.min(1, 4 * delta)
      cam.updateProjectionMatrix()
    }
  })

  return (
    <>
      <group ref={chassisRef}>
        <group position={[0, MODEL_OFFSET_Y, 0]}>
          {vehicle === 'bike' ? <BikeModel steer={steer} spin={spin} /> : <KartModel steer={steer} />}
          {/* 부스터 화염 (배기구 뒤로) */}
          <group ref={flame} position={[0.22, 0.02, -1.22]} visible={false}>
            <mesh position={[0, 0, -0.3]} rotation={[-Math.PI / 2, 0, 0]}>
              <coneGeometry args={[0.1, 0.6, 10]} />
              <meshBasicMaterial
                color="#4fc3f7"
                toneMapped={false}
                transparent
                opacity={0.85}
                blending={AdditiveBlending}
              />
            </mesh>
            <mesh position={[0, 0, -0.18]} rotation={[-Math.PI / 2, 0, 0]}>
              <coneGeometry args={[0.06, 0.35, 10]} />
              <meshBasicMaterial color="#ffffff" toneMapped={false} blending={AdditiveBlending} />
            </mesh>
          </group>
        </group>
        {/* 드리프트 불꽃 (뒷바퀴 접지점, 위치는 매 프레임 갱신) */}
        {sparks.map((ref, i) => (
          <mesh key={i} ref={ref} visible={false}>
            <sphereGeometry args={[0.13, 8, 6]} />
            <meshBasicMaterial
              color="#ffa726"
              toneMapped={false}
              transparent
              opacity={0.9}
              blending={AdditiveBlending}
            />
          </mesh>
        ))}
        {wheelRefs.map((ref, i) => (
          // physics/vehicle.ts: 0·2번이 +X 쪽, 1·3번이 -X 쪽 바퀴 → 림이 바깥을 향하도록
          <group key={i} visible={vehicle === 'kart'}>
            <Wheel ref={ref} radius={KART.wheelRadius} width={WHEEL_WIDTH} left={i % 2 === 1} />
          </group>
        ))}
      </group>
      {/* 타이어 자국 (월드 좌표) */}
      <SkidMarks wheels={getMarkWheels} />
    </>
  )
}

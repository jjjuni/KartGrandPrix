import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Body, Box, Vec3 } from 'cannon-es'
import { createRef, useEffect, useMemo, useRef, useState } from 'react'
import { Quaternion, Vector3, type Group } from 'three'
import { crashSound } from '../game/sound'
import { online, peers, sendHit, subscribe, type Vehicle } from '../net/online'
import { useWorld } from '../physics/PhysicsWorld'
import { KART } from '../physics/vehicle'
import { GROUP, materials } from '../physics/world'
import BikeModel from './BikeModel'
import KartModel from './KartModel'
import SkidMarks, { type MarkWheel } from './SkidMarks'
import Wheel from './Wheel'

const COLORS = ['#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#d81b60', '#6d4c41']
/** 플레이어별 카트 색 (미니맵 점도 같은 색) */
export const peerColor = (id: number) => COLORS[id % COLORS.length]
const FOLLOW = 12 // 받은 위치로 따라가는 속도 (1/s) — 초당 20번 오는 위치 사이를 부드럽게
const _p = new Vector3()
const _q = new Quaternion()
const _prev = new Vector3()
const _up = new Vector3()
const HIT_SHARE = 0.7 // 부딪힌 순간 다가가던 속도 중 상대에게 넘기는 비율
const HIT_COOLDOWN = 400 // ms — 붙어 있는 동안 매 스텝 보내지 않게

/**
 * 다른 사람의 카트 하나. 받은 위치를 따라 움직이는 키네마틱 충돌 상자를 내 물리 세계에 둔다 —
 * 내 카트는 부딪히면 튕기고, 상자는 밀리지 않는다 (상대 화면에서는 상대가 내 상자에 부딪혀 튕김)
 */
function RemoteKart({ id, name, vehicle }: { id: number; name: string; vehicle: Vehicle }) {
  const isBike = useRef(false)
  isBike.current = vehicle === 'bike'
  const ref = useRef<Group>(null)
  const steer = useRef(0)
  const wheels = useMemo(() => [0, 1, 2, 3].map(() => createRef<Group>()), [])
  const placed = useRef(false)
  const spin = useRef(0)

  // 바퀴 위치: 정지 시 바퀴 중심 = 무게중심 높이 (physics/vehicle.ts의 connectionY 설명 참고)
  const wheelPos: [number, number, number][] = [
    [KART.wheelX, 0, KART.frontZ],
    [-KART.wheelX, 0, KART.frontZ],
    [KART.wheelX, 0, KART.rearZ],
    [-KART.wheelX, 0, KART.rearZ],
  ]

  // 타이어 자국: 받은 skid 비트가 켜진 바퀴의 접지점(바퀴 바로 아래)을 월드 좌표로
  const marks = useMemo<MarkWheel[]>(
    () => wheelPos.map(() => ({ sliding: false, point: new Vector3(), normal: new Vector3(), slip: 4 })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const getMarks = useMemo(
    () => () => {
      const s = peers.get(id)
      const g = ref.current
      if (!s || !g) return null
      const up = _up.set(0, 1, 0).applyQuaternion(g.quaternion)
      marks.forEach((m, i) => {
        // 뒷바퀴(2·3)만. 바이크는 뒷바퀴 하나 → 두 비트 중 하나라도 켜지면 가운데 한 줄
        m.sliding = i < 2 ? false : isBike.current ? i === 2 && (s.skid & 0b1100) !== 0 : ((s.skid >> i) & 1) === 1
        if (!m.sliding) return
        const [wx, , z] = wheelPos[i]
        const x = isBike.current ? 0 : wx
        m.point.set(x, -KART.wheelRadius, z).applyMatrix4(g.matrixWorld)
        m.normal.copy(up)
      })
      return marks
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  )

  const world = useWorld()
  const body = useMemo(() => {
    const b = new Body({
      type: Body.KINEMATIC,
      material: materials.chassis,
      collisionFilterGroup: GROUP.PROP, // 바퀴 레이캐스트(STATIC만)에는 안 맞게 — 상대 카트 위를 노면으로 착각하지 않음
      collisionFilterMask: GROUP.KART | GROUP.PROP,
    })
    b.addShape(new Box(new Vec3(...KART.chassisHalf)))
    // 내 카트가 이 상자에 부딪히면, 다가가던 속도만큼 상대에게 '밀려라' 신호를 보낸다
    let last = 0
    b.addEventListener('collide', (e: { body: Body }) => {
      const now = performance.now()
      if (now - last < HIT_COOLDOWN) return
      const dx = b.position.x - e.body.position.x
      const dz = b.position.z - e.body.position.z
      const len = Math.hypot(dx, dz)
      if (len < 1e-3) return
      const closing = ((e.body.velocity.x - b.velocity.x) * dx + (e.body.velocity.z - b.velocity.z) * dz) / len
      if (closing < 1) return // 살짝 닿은 정도는 무시
      last = now
      const push = closing * HIT_SHARE
      sendHit(id, (dx / len) * push, (dz / len) * push)
      crashSound(closing)
    })
    return b
  }, [id])
  useEffect(() => {
    world.addBody(body)
    return () => world.removeBody(body)
  }, [world, body])

  useFrame((_, dt) => {
    const s = peers.get(id)
    const g = ref.current
    if (!s || !g) return
    _p.set(s.x, s.y, s.z)
    _q.set(s.qx, s.qy, s.qz, s.qw)
    _prev.copy(g.position)
    if (!placed.current) {
      g.position.copy(_p)
      g.quaternion.copy(_q)
      _prev.copy(_p)
      placed.current = true
    } else {
      const k = 1 - Math.exp(-FOLLOW * dt)
      g.position.lerp(_p, k)
      g.quaternion.slerp(_q, k)
    }
    // 충돌 상자: 보이는 위치에 두고, 이번 프레임 이동량을 속도로 줘야 부딪힐 때 상대 속도가 반영된다
    body.position.set(g.position.x, g.position.y, g.position.z)
    body.quaternion.set(g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w)
    if (dt > 0)
      body.velocity.set((g.position.x - _prev.x) / dt, (g.position.y - _prev.y) / dt, (g.position.z - _prev.z) / dt)
    // 조향: 핸들·운전자 기울기(KartModel)와 앞바퀴 방향
    steer.current += (s.steer - steer.current) * (1 - Math.exp(-FOLLOW * dt))
    spin.current += (s.speed / 3.6 / KART.wheelRadius) * dt
    wheels.forEach((w, i) => w.current?.rotation.set(spin.current % (Math.PI * 2), i < 2 ? steer.current : 0, 0, 'YXZ'))
  })

  return (
    <>
      <SkidMarks wheels={getMarks} />
      <group ref={ref}>
        {/* Kart.tsx의 MODEL_OFFSET_Y와 같은 값 */}
        <group position={[0, 0.09, 0]}>
          {vehicle === 'bike' ? (
            <BikeModel steer={steer} spin={spin} color={peerColor(id)} number={id % 100} />
          ) : (
            <KartModel steer={steer} color={peerColor(id)} number={id % 100} />
          )}
        </group>
        {/* 머리 위 이름표 (화면을 향하는 HTML 글자 — 한글 그대로) */}
        <Html position={[0, 1.55, -0.35]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <span className="name-tag" style={{ borderColor: peerColor(id) }}>
            {name}
          </span>
        </Html>
        {wheelPos.map((p, i) => (
          <group key={i} position={p} visible={vehicle === 'kart'}>
            <Wheel ref={wheels[i]} radius={KART.wheelRadius} width={0.25} left={i % 2 === 1} />
          </group>
        ))}
      </group>
    </>
  )
}

/** 같은 방에 접속한 다른 사람들의 카트 */
export default function RemoteKarts() {
  const [list, setList] = useState<{ id: number; name: string; vehicle: Vehicle }[]>([])
  useEffect(() => {
    // 3D 장면이 로딩되는 동안 이미 들어와 있던 사람도 보이도록, 구독할 때 한 번 현재 목록을 읽는다
    const sync = () => {
      const members = new Map(online.room?.members.map((m) => [m.id, m]))
      setList(
        [...peers.keys()].map((id) => ({
          id,
          name: members.get(id)?.name ?? '',
          vehicle: members.get(id)?.vehicle ?? 'kart',
        })),
      )
    }
    sync()
    return subscribe(sync)
  }, [])
  return (
    <>
      {list.map(({ id, name, vehicle }) => (
        <RemoteKart key={id} id={id} name={name} vehicle={vehicle} />
      ))}
    </>
  )
}

import { Canvas, useFrame } from '@react-three/fiber'
import { useRef, type ReactNode } from 'react'
import type { Group } from 'three'
import BikeModel from '../components/BikeModel'
import KartModel from '../components/KartModel'
import Wheel from '../components/Wheel'
import { setVehicle, type Vehicle } from '../net/online'
import { KART } from '../physics/vehicle'
import { useOnline, useRace } from './hooks'

const OPTIONS: { value: Vehicle; label: string }[] = [
  { value: 'kart', label: '카트' },
  { value: 'bike', label: '바이크' },
]

const still = { current: 0 } // 미리보기는 조향·바퀴 회전 없이

/** 천천히 도는 받침 */
function Turntable({ children }: { children: ReactNode }) {
  const ref = useRef<Group>(null)
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.6
  })
  return <group ref={ref}>{children}</group>
}

/** 차량 모델 미리보기 (작은 3D 화면) — 게임과 같은 모델을 그대로 쓴다 */
function Preview({ vehicle }: { vehicle: Vehicle }) {
  return (
    <Canvas
      className="vehicle-preview"
      dpr={[1, 2]}
      // 돌아가는 동안 가장 긴 쪽(카트 앞날개~뒷날개 약 2.6m)이 화면 옆을 향해도 잘리지 않는 거리
      camera={{ position: [3.2, 1.7, 3.2], fov: 30 }}
      onCreated={({ camera }) => camera.lookAt(0, 0.2, 0)}
    >
      <ambientLight intensity={0.8} />
      <directionalLight position={[3, 5, 2]} intensity={2.2} />
      <Turntable>
        {/* Kart.tsx와 같은 배치: 모델은 무게중심보다 0.09m 위, 바퀴 중심 = 무게중심 높이 */}
        <group position={[0, 0.09, 0]}>
          {vehicle === 'bike' ? <BikeModel steer={still} spin={still} /> : <KartModel steer={still} />}
        </group>
        {vehicle === 'kart' &&
          [
            [KART.wheelX, KART.frontZ],
            [-KART.wheelX, KART.frontZ],
            [KART.wheelX, KART.rearZ],
            [-KART.wheelX, KART.rearZ],
          ].map(([x, z], i) => (
            <group key={i} position={[x, 0, z]}>
              <Wheel radius={KART.wheelRadius} width={0.25} left={i % 2 === 1} />
            </group>
          ))}
      </Turntable>
    </Canvas>
  )
}

/**
 * 화면 오른쪽 아래 차량 고르기. 대기실에서, 방에서는 ready 전(방장은 출발 전)까지만 보인다
 * (서버도 같은 규칙으로 막는다). 고르면 배경의 내 차가 바로 바뀐다.
 */
export default function VehiclePicker() {
  const o = useOnline()
  const r = useRace()
  const room = o.room
  const me = room?.members.find((m) => m.id === o.myId)
  const canPick = !room || (r.phase === 'waiting' && (room.hostId === o.myId || !me?.ready))
  if (!o.name || !canPick) return null

  return (
    <fieldset className="vehicle-pick">
      <legend className="vehicle-pick-title">차량</legend>
      {OPTIONS.map(({ value, label }) => (
        <label key={value} className={`vehicle-card ${o.vehicle === value ? 'is-on' : ''}`}>
          <input type="radio" name="vehicle" value={value} checked={o.vehicle === value} onChange={() => setVehicle(value)} />
          <Preview vehicle={value} />
          <span className="vehicle-name">{label}</span>
        </label>
      ))}
    </fieldset>
  )
}

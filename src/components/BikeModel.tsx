import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type MutableRefObject } from 'react'
import { DoubleSide, type Group } from 'three'
import { KART, steerLimit } from '../physics/vehicle'
import { Helmet, Limb } from './Driver'
import { numberTexture, sideProfile } from './KartModel'
import Wheel from './Wheel'

type BikeModelProps = {
  /** 보이는 조향각 (rad, KartPhysics.steerVisual) — 앞바퀴·핸들 방향과 차체 기울기 */
  steer: MutableRefObject<number>
  /** 바퀴 회전각 (rad) */
  spin: MutableRefObject<number>
  color?: string
  accent?: string
  number?: number
}

type V3 = [number, number, number]

// 좌표: KartModel과 같음 (+Z 앞, +Y 위). 이 모델은 Kart.tsx에서 무게중심보다 0.09m 위에 놓인다
const WHEEL_Y = -0.09 // 바퀴 중심 = 무게중심 높이
const GROUND_Y = WHEEL_Y - KART.wheelRadius // 기울기의 회전축 (지면)
const FRONT_Z = KART.frontZ
const REAR_Z = KART.rearZ
const LEAN = 1.1 // 조향각 → 차체 기울기 배율 (코너 안쪽으로)
/**
 * 고속 기울기 보정: 고속에선 조향각 자체가 작으므로 배율을 1 + SPEED_LEAN × (속도비)³ 로 —
 * 저속은 거의 그대로, 최고속도에서 2.5배. 보이는 기울기만 바뀌고 조향은 그대로
 */
const SPEED_LEAN = 1.5
const MAX_LEAN = 0.7 // 기울기 상한 (rad, 약 40도)
const FORK_STEER = 0.8 // 조향각 → 앞바퀴·핸들 방향 배율

// 차체 치수 — 라이더는 이 면들 '바깥'에 놓는다 (시트 위, 탱크 위, 탱크 옆)
const SEAT_TOP = 0.36
const TANK = { y: 0.36, z: 0.14, half: [0.23, 0.16, 0.34] as V3 } // 타원체 중심·반지름
const TANK_TOP = TANK.y + TANK.half[1]
const BAR: V3 = [0, 0.58, -0.14] // 핸들바 (앞포크 그룹 기준)

/**
 * 바이크 시각 모델 (주행 물리는 카트와 같음). 레이서 스타일: 풀 카울 · 듀얼 헤드라이트 · 측면 번호판 ·
 * 디스크 브레이크 · 체인 · 사이드 머플러. 코너에서 지면을 축으로 안쪽으로 기울고 앞바퀴·핸들이 조향을 따라 돈다.
 */
export default function BikeModel({ steer, spin, color = '#d62f2f', accent = '#f5f5f5', number = 7 }: BikeModelProps) {
  const leanRef = useRef<Group>(null)
  const forkRef = useRef<Group>(null)
  const frontWheel = useRef<Group>(null)
  const rearWheel = useRef<Group>(null)
  const discs = useRef<Group>(null)

  // 속도: 바퀴가 도는 빠르기로 계산 (내 바이크·다른 사람 바이크 모두 spin만 넘겨준다)
  const lastSpin = useRef(0)
  const speed = useRef(0)

  useFrame((_, dt) => {
    const k = 1 - Math.exp(-8 * dt)
    if (dt > 0) {
      const v = (Math.abs(spin.current - lastSpin.current) / dt) * KART.wheelRadius
      speed.current += (v - speed.current) * k
    }
    lastSpin.current = spin.current
    const speedRatio = Math.min(speed.current / KART.maxSpeed, 1)
    // 기울기는 실제 조향각 기준 (보이는 각 ÷ 저속 최대 각 × 이 속도의 조향 한계)
    const physSteer = (steer.current / KART.maxSteer) * steerLimit(speed.current)
    const lean = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, -physSteer * LEAN * (1 + SPEED_LEAN * speedRatio ** 3)))
    if (leanRef.current) leanRef.current.rotation.z += (lean - leanRef.current.rotation.z) * k
    if (forkRef.current) forkRef.current.rotation.y = steer.current * FORK_STEER
    const a = spin.current % (Math.PI * 2)
    frontWheel.current?.rotation.set(a, 0, 0)
    rearWheel.current?.rotation.set(a, 0, 0)
    discs.current?.rotation.set(a, 0, 0)
  })

  const geo = useMemo(
    () => ({
      // 앞 카울: 뾰족한 노즈 → 윈드스크린 받침 → 탱크 앞에서 아래로. 앞바퀴 위는 비워 둔다
      fairing: sideProfile(
        (s) => {
          s.moveTo(0.9, 0.4)
          s.quadraticCurveTo(0.84, 0.6, 0.6, 0.64)
          s.lineTo(0.34, 0.56)
          s.lineTo(0.2, 0.1)
          s.quadraticCurveTo(0.2, -0.1, 0.38, -0.1)
          s.lineTo(0.44, 0.24)
          s.quadraticCurveTo(0.72, 0.3, 0.9, 0.4)
        },
        0.3,
        0.04,
      ),
      // 테일 카울: 시트 뒤에서 위로 치켜 올라간 꼬리
      tail: sideProfile(
        (s) => {
          s.moveTo(-0.18, 0.36)
          s.lineTo(-0.7, 0.5)
          s.quadraticCurveTo(-0.8, 0.5, -0.78, 0.42)
          s.quadraticCurveTo(-0.5, 0.24, -0.18, 0.22)
          s.closePath()
        },
        0.2,
        0.04,
      ),
      // 언더카울 (엔진 아래)
      belly: sideProfile(
        (s) => {
          s.moveTo(0.36, -0.06)
          s.quadraticCurveTo(0.1, -0.24, -0.18, -0.14)
          s.lineTo(-0.16, -0.08)
          s.quadraticCurveTo(0.1, -0.16, 0.36, -0.02)
          s.closePath()
        },
        0.28,
        0.02,
      ),
    }),
    [],
  )
  const numberTex = useMemo(() => numberTexture(number), [number])

  const body = <meshPhysicalMaterial color={color} metalness={0.4} roughness={0.25} clearcoat={1} clearcoatRoughness={0.15} />
  const trim = <meshStandardMaterial color={accent} metalness={0.2} roughness={0.35} />
  const carbon = <meshStandardMaterial color="#17191c" metalness={0.5} roughness={0.45} />
  const metal = <meshStandardMaterial color="#9ea3a8" metalness={0.9} roughness={0.25} />
  const chrome = <meshStandardMaterial color="#e6e8ea" metalness={1} roughness={0.12} />
  const disc = <meshStandardMaterial color="#c9ccd0" metalness={0.95} roughness={0.2} />
  const gold = <meshStandardMaterial color="#d4a017" metalness={0.8} roughness={0.3} />
  const suit = <meshStandardMaterial color="#1565c0" roughness={0.65} />
  const suitDark = <meshStandardMaterial color="#0d2a52" roughness={0.7} />
  const boot = <meshStandardMaterial color="#1a1a1a" roughness={0.6} />

  // ---- 라이더 관절: 시트 위에 앉아 탱크 위로 몸을 숙이고, 무릎으로 탱크 옆을 감싼다 ----
  const hip: V3 = [0, SEAT_TOP + 0.11, -0.3]
  const chest: V3 = [0, TANK_TOP + 0.24, 0.0]

  return (
    <group position={[0, GROUND_Y, 0]}>
      <group ref={leanRef}>
        <group position={[0, -GROUND_Y, 0]}>
          {/* ================= 바퀴 · 브레이크 · 체인 ================= */}
          <group position={[0, WHEEL_Y, REAR_Z]}>
            <Wheel ref={rearWheel} radius={KART.wheelRadius} width={0.16} />
          </group>
          {/* 뒷바퀴 디스크(왼쪽) + 스프로킷(오른쪽) — 바퀴와 함께 돈다 */}
          <group ref={discs} position={[0, WHEEL_Y, REAR_Z]}>
            <mesh position={[-0.095, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.13, 0.13, 0.01, 24]} />
              {disc}
            </mesh>
            <mesh position={[0.095, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
              <torusGeometry args={[0.12, 0.018, 6, 24]} />
              {gold}
            </mesh>
          </group>
          {/* 체인: 엔진 앞 스프로킷 → 뒷바퀴 스프로킷 (위·아래 두 줄) */}
          {[0.1, -0.1].map((dy) => (
            <Limb key={dy} from={[0.1, -0.04 + dy * 0.4, 0.02]} to={[0.1, WHEEL_Y + dy * 1.2, REAR_Z]} radius={0.012}>
              {carbon}
            </Limb>
          ))}
          <mesh position={[0.11, -0.04, 0.02]} rotation={[0, Math.PI / 2, 0]}>
            <torusGeometry args={[0.05, 0.015, 6, 16]} />
            {gold}
          </mesh>
          {/* 스윙암 (양쪽) */}
          {[-1, 1].map((s) => (
            <Limb key={s} from={[s * 0.1, 0.0, -0.1]} to={[s * 0.1, WHEEL_Y, REAR_Z]} radius={0.032}>
              {metal}
            </Limb>
          ))}
          {/* 리어 쇼크 업소버 (노란 스프링) */}
          <Limb from={[0, 0.06, -0.38]} to={[0, 0.3, -0.18]} radius={0.03}>
            <meshStandardMaterial color="#ffc400" metalness={0.3} roughness={0.4} />
          </Limb>

          {/* 앞바퀴 + 포크 + 핸들 + 계기판: 조향에 따라 함께 돈다 */}
          <group ref={forkRef} position={[0, 0, FRONT_Z]}>
            <group position={[0, WHEEL_Y, 0]}>
              <Wheel ref={frontWheel} radius={KART.wheelRadius} width={0.14} />
              {/* 더블 디스크 + 금색 캘리퍼 */}
              {[-1, 1].map((s) => (
                <group key={s}>
                  <mesh position={[s * 0.085, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                    <cylinderGeometry args={[0.16, 0.16, 0.01, 24]} />
                    {disc}
                  </mesh>
                  <mesh position={[s * 0.1, 0.1, -0.1]} rotation={[0.8, 0, 0]}>
                    <boxGeometry args={[0.03, 0.09, 0.05]} />
                    {gold}
                  </mesh>
                </group>
              ))}
            </group>
            {/* 도립식 포크: 아래 금색 외통 + 위 크롬 */}
            {[-1, 1].map((s) => (
              <group key={s}>
                <Limb from={[s * 0.1, 0.28, -0.08]} to={[s * 0.1, WHEEL_Y, 0]} radius={0.028}>
                  {gold}
                </Limb>
                <Limb from={[s * 0.1, BAR[1], BAR[2]]} to={[s * 0.1, 0.28, -0.08]} radius={0.034}>
                  {chrome}
                </Limb>
              </group>
            ))}
            {/* 앞 흙받이 */}
            <mesh position={[0, WHEEL_Y + 0.04, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
              <torusGeometry args={[KART.wheelRadius + 0.04, 0.045, 6, 18, Math.PI * 0.55]} />
              {body}
            </mesh>
            {/* 클립온 핸들 + 그립 + 브레이크 레버 */}
            {[-1, 1].map((s) => (
              <group key={s}>
                <Limb from={[s * 0.1, BAR[1], BAR[2]]} to={[s * 0.28, BAR[1] - 0.03, BAR[2] - 0.04]} radius={0.016}>
                  {carbon}
                </Limb>
                <mesh position={[s * 0.31, BAR[1] - 0.035, BAR[2] - 0.045]} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.028, 0.028, 0.1, 10]} />
                  {boot}
                </mesh>
                <mesh position={[s * 0.27, BAR[1] - 0.02, BAR[2] + 0.04]} rotation={[0, s * 0.3, 0]}>
                  <boxGeometry args={[0.13, 0.01, 0.015]} />
                  {metal}
                </mesh>
              </group>
            ))}
          </group>

          {/* ================= 차체 ================= */}
          {/* 엔진: 크랭크케이스 + 실린더 블록 + 냉각핀 */}
          <mesh position={[0, -0.04, 0.06]} castShadow>
            <boxGeometry args={[0.32, 0.22, 0.42]} />
            {metal}
          </mesh>
          <mesh position={[0, 0.14, 0.14]} rotation={[0.35, 0, 0]} castShadow>
            <boxGeometry args={[0.26, 0.2, 0.2]} />
            {carbon}
          </mesh>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} position={[0, 0.07 + i * 0.04, 0.14]} rotation={[0.35, 0, 0]}>
              <boxGeometry args={[0.3, 0.012, 0.22]} />
              {metal}
            </mesh>
          ))}
          {/* 라디에이터 (카울 안쪽, 엔진 앞) */}
          <mesh position={[0, 0.2, 0.36]} rotation={[-0.25, 0, 0]}>
            <boxGeometry args={[0.3, 0.26, 0.04]} />
            <meshStandardMaterial color="#2a2d31" metalness={0.6} roughness={0.5} />
          </mesh>
          {/* 트윈 스파 프레임 (알루미늄): 헤드 → 피벗 */}
          {[-1, 1].map((s) => (
            <Limb key={s} from={[s * 0.12, 0.5, 0.52]} to={[s * 0.14, 0.12, -0.12]} radius={0.04}>
              {metal}
            </Limb>
          ))}
          {/* 연료 탱크 + 가운데 줄무늬 + 주유구 */}
          <mesh position={[0, TANK.y, TANK.z]} scale={TANK.half} castShadow>
            <sphereGeometry args={[1, 28, 18]} />
            {body}
          </mesh>
          <mesh position={[0, TANK_TOP - 0.005, TANK.z]} scale={[0.05, 0.012, 0.3]}>
            <sphereGeometry args={[1, 12, 8]} />
            {trim}
          </mesh>
          <mesh position={[0, TANK_TOP, TANK.z + 0.12]}>
            <cylinderGeometry args={[0.04, 0.04, 0.01, 16]} />
            {chrome}
          </mesh>
          {/* 앞 카울 + 측면 줄무늬 + 번호판 */}
          <mesh geometry={geo.fairing} castShadow>
            {body}
          </mesh>
          {[-1, 1].map((s) => (
            <group key={s}>
              <mesh position={[s * 0.195, 0.2, 0.42]} rotation={[0, 0, 0]}>
                <boxGeometry args={[0.01, 0.03, 0.42]} />
                {trim}
              </mesh>
              <mesh position={[s * 0.196, 0.36, 0.5]} rotation={[0, (s * Math.PI) / 2, 0]}>
                <circleGeometry args={[0.09, 24]} />
                <meshStandardMaterial map={numberTex} transparent />
              </mesh>
              {/* 사이드 미러 */}
              <mesh position={[s * 0.24, 0.6, 0.56]} rotation={[0, 0, s * -0.2]}>
                <boxGeometry args={[0.09, 0.05, 0.03]} />
                {body}
              </mesh>
              <mesh position={[s * 0.19, 0.58, 0.57]} rotation={[0, 0, s * 0.6]}>
                <cylinderGeometry args={[0.008, 0.008, 0.07, 6]} />
                {carbon}
              </mesh>
            </group>
          ))}
          {/* 듀얼 헤드라이트 + 가운데 램에어 흡기구 */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.07, 0.43, 0.925]} rotation={[Math.PI / 2 - 0.35, s * 0.3, 0]}>
              <cylinderGeometry args={[0.05, 0.05, 0.02, 16]} />
              <meshStandardMaterial color="#fff6d5" emissive="#ffe9a8" emissiveIntensity={1.4} />
            </mesh>
          ))}
          <mesh position={[0, 0.34, 0.93]}>
            <boxGeometry args={[0.08, 0.05, 0.03]} />
            <meshStandardMaterial color="#050607" roughness={1} />
          </mesh>
          {/* 윈드스크린 (반투명 스모크) + 계기판 */}
          <mesh position={[0, 0.66, 0.6]} rotation={[-0.75, 0, 0]} scale={[0.17, 0.2, 0.05]}>
            <sphereGeometry args={[1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshPhysicalMaterial color="#4a5a6a" transparent opacity={0.55} roughness={0.05} metalness={0.2} side={DoubleSide} />
          </mesh>
          <mesh position={[0, 0.6, 0.5]} rotation={[-0.6, 0, 0]}>
            <boxGeometry args={[0.16, 0.08, 0.03]} />
            {carbon}
          </mesh>
          <mesh position={[0, 0.612, 0.488]} rotation={[-0.6, 0, 0]}>
            <planeGeometry args={[0.12, 0.05]} />
            <meshStandardMaterial color="#0b1a2a" emissive="#38c6f4" emissiveIntensity={0.6} />
          </mesh>
          {/* 언더카울 */}
          <mesh geometry={geo.belly} castShadow>
            {body}
          </mesh>
          {/* 시트 (라이더 엉덩이 아래) */}
          <mesh position={[0, SEAT_TOP - 0.045, -0.3]} scale={[0.15, 0.045, 0.18]} castShadow>
            <sphereGeometry args={[1, 16, 10]} />
            {carbon}
          </mesh>
          {/* 테일 카울 + 미등 + 번호판 홀더 */}
          <mesh geometry={geo.tail} castShadow>
            {body}
          </mesh>
          <mesh position={[0, 0.45, -0.835]} rotation={[0.3, 0, 0]}>
            <boxGeometry args={[0.16, 0.025, 0.03]} />
            <meshStandardMaterial color="#b71c1c" emissive="#ff1f1f" emissiveIntensity={1.4} />
          </mesh>
          <Limb from={[0, 0.36, -0.72]} to={[0, 0.2, -0.86]} radius={0.012}>
            {carbon}
          </Limb>
          <mesh position={[0, 0.17, -0.88]} rotation={[0.4, 0, 0]}>
            <boxGeometry args={[0.16, 0.1, 0.01]} />
            {trim}
          </mesh>
          {/* 발판 (라이더 부츠 아래) */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.19, 0.06, -0.24]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.015, 0.015, 0.08, 8]} />
              {metal}
            </mesh>
          ))}
          {/* 배기: 엔진 아래 → 오른쪽 사이드 머플러 (끝이 부스터 화염 위치 z -1.22 근처) */}
          <Limb from={[0.1, -0.16, 0.12]} to={[0.18, -0.06, -0.62]} radius={0.035}>
            {chrome}
          </Limb>
          <Limb from={[0.19, -0.05, -0.66]} to={[0.22, 0.04, -1.08]} radius={0.07}>
            {carbon}
          </Limb>
          <mesh position={[0.225, 0.045, -1.13]} rotation={[Math.PI / 2 - 0.2, 0, 0]}>
            <cylinderGeometry args={[0.05, 0.06, 0.08, 14, 1, true]} />
            <meshStandardMaterial color="#e6e8ea" metalness={1} roughness={0.12} side={DoubleSide} />
          </mesh>

          {/* ================= 라이더 ================= */}
          {/* 몸통: 시트 위 엉덩이 → 탱크 위 가슴 (탱크보다 위로) */}
          <Limb from={hip} to={chest} radius={0.14}>
            {suit}
          </Limb>
          {/* 등 위 혹(에어로 험프) — 슈트 디자인 */}
          <mesh position={[0, chest[1] + 0.08, chest[2] - 0.12]} scale={[0.09, 0.07, 0.12]}>
            <sphereGeometry args={[1, 12, 8]} />
            <meshStandardMaterial color={color} roughness={0.4} />
          </mesh>
          <mesh position={[0, hip[1], hip[2]]} scale={[1.05, 0.8, 1]}>
            <sphereGeometry args={[0.145, 16, 10]} />
            {suitDark}
          </mesh>
          {[-1, 1].map((s) => {
            const shoulder: V3 = [s * 0.17, chest[1] + 0.05, chest[2] + 0.02]
            const grip: V3 = [s * 0.3, BAR[1] - 0.035, FRONT_Z + BAR[2] - 0.05]
            const elbow: V3 = [s * 0.3, (shoulder[1] + grip[1]) / 2 + 0.02, (shoulder[2] + grip[2]) / 2 - 0.04]
            const hipSide: V3 = [s * 0.1, hip[1], hip[2] + 0.04]
            // 무릎: 탱크 옆면(반폭 0.23) 바깥, 탱크 뒤쪽 높이
            const knee: V3 = [s * (TANK.half[0] + 0.08), TANK.y + 0.04, TANK.z - 0.12]
            const ankle: V3 = [s * 0.19, 0.1, -0.22]
            return (
              <group key={s}>
                <mesh position={shoulder}>
                  <sphereGeometry args={[0.065, 12, 10]} />
                  {suit}
                </mesh>
                <Limb from={shoulder} to={elbow} radius={0.05}>
                  {suit}
                </Limb>
                <Limb from={elbow} to={grip} radius={0.045}>
                  {suit}
                </Limb>
                <mesh position={grip} scale={[1, 0.85, 1.25]}>
                  <sphereGeometry args={[0.05, 12, 10]} />
                  {boot}
                </mesh>
                <Limb from={hipSide} to={knee} radius={0.075}>
                  {suit}
                </Limb>
                {/* 무릎 슬라이더 */}
                <mesh position={[knee[0] + s * 0.06, knee[1] - 0.01, knee[2]]} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.045, 0.045, 0.03, 12]} />
                  {trim}
                </mesh>
                <Limb from={knee} to={ankle} radius={0.06}>
                  {suit}
                </Limb>
                <mesh position={[ankle[0], ankle[1] - 0.04, ankle[2] + 0.05]} castShadow>
                  <boxGeometry args={[0.09, 0.09, 0.2]} />
                  {boot}
                </mesh>
              </group>
            )
          })}
          {/* 헬멧: 가슴 앞, 윈드스크린 바로 뒤로 고개를 숙임 */}
          <group position={[0, chest[1] + 0.16, chest[2] + 0.18]} rotation={[0.35, 0, 0]}>
            <Helmet position={[0, 0, 0]} color={color} accent={accent} number={number} />
          </group>
        </group>
      </group>
    </group>
  )
}

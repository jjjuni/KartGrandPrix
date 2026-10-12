import { forwardRef } from 'react'
import type { Group } from 'three'

type WheelProps = {
  radius: number
  width: number
  /** true면 휠 디스크가 -X 쪽을 보도록 뒤집음 (차체 -X 쪽 바퀴에 사용 — 림이 항상 바깥을 향하게) */
  left?: boolean
}

/**
 * 바퀴의 시각 모델. 물리 body는 없고(접지·서스펜션은 physics/vehicle.ts의 레이캐스트가 계산),
 * Kart가 매 프레임 서스펜션 길이·조향·회전값으로 위치와 회전을 넣어 준다.
 */
const Wheel = forwardRef<Group, WheelProps>(({ radius, width, left = false }, ref) => {
  const side = left ? -1 : 1
  const rimRadius = radius * 0.62

  return (
    <group ref={ref}>
      {/* 실린더 축을 X축(차축 방향)으로 */}
      <group rotation={[0, 0, -Math.PI / 2]}>
        {/* 타이어 */}
        <mesh castShadow>
          <cylinderGeometry args={[radius, radius, width, 28]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.95} />
        </mesh>
        {/* 타이어 숄더 (둥근 느낌) */}
        {[1, -1].map((s) => (
          <mesh key={s} position={[0, (s * width) / 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[radius - 0.035, 0.035, 8, 28]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.95} />
          </mesh>
        ))}
        {/* 휠 림 (바깥쪽) */}
        <group position={[0, (side * width) / 2 + side * 0.005, 0]}>
          <mesh>
            <cylinderGeometry args={[rimRadius, rimRadius, 0.02, 24]} />
            <meshStandardMaterial color="#c9ccd0" metalness={0.9} roughness={0.2} />
          </mesh>
          {/* 스포크: 회전이 눈에 보이도록 */}
          {[0, 1, 2, 3, 4].map((i) => (
            <mesh key={i} rotation={[0, (i / 5) * Math.PI * 2, 0]} position={[0, side * 0.012, 0]}>
              <boxGeometry args={[0.04, 0.012, rimRadius * 1.7]} />
              <meshStandardMaterial color="#6d7175" metalness={0.8} roughness={0.3} />
            </mesh>
          ))}
          <mesh position={[0, side * 0.02, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 0.03, 12]} />
            <meshStandardMaterial color="#ffc400" />
          </mesh>
        </group>
      </group>
    </group>
  )
})

Wheel.displayName = 'Wheel'
export default Wheel

import { useMemo, type Ref } from 'react'
import { Quaternion, Vector3, type Group } from 'three'
import { makeCanvasTexture } from '../utils/canvasTexture'

type V3 = [number, number, number]

const _up = new Vector3(0, 1, 0)

/** from → to를 잇는 캡슐 (팔·다리 마디) — 바이크 라이더도 쓴다 */
export function Limb({ from, to, radius, children }: { from: V3; to: V3; radius: number; children: React.ReactNode }) {
  const { position, quaternion, length } = useMemo(() => {
    const a = new Vector3(...from)
    const b = new Vector3(...to)
    const dir = b.clone().sub(a)
    const length = dir.length()
    return {
      position: a.add(b).multiplyScalar(0.5),
      quaternion: new Quaternion().setFromUnitVectors(_up, dir.normalize()),
      length,
    }
  }, [from, to])
  return (
    <mesh position={position} quaternion={quaternion} castShadow>
      <capsuleGeometry args={[radius, Math.max(0.001, length - radius), 4, 10]} />
      {children}
    </mesh>
  )
}

type DriverProps = {
  /** 상체(코너에서 기울어지는 부분) — KartModel이 조향값으로 회전시킨다 */
  upperBodyRef: Ref<Group>
  color: string
  accent: string
  number: number
}

// 좌표: 운전자 그룹 기준 (KartModel에서 [0, 0.05, -0.33]에 놓임). 핸들 중심 ≈ (0, 0.23, 0.57)
const SHOULDER_Y = 0.42
const HAND: V3 = [0.115, 0.27, 0.5]
const ELBOW: V3 = [0.22, 0.27, 0.22]
const SHOULDER: V3 = [0.16, SHOULDER_Y, -0.04]

/** 풀페이스 헬멧 (차체 색 줄무늬 · 미러 바이저 · 옆면 번호) — 카트 운전자와 바이크 라이더가 같이 쓴다 */
export function Helmet({
  position,
  color,
  accent,
  number,
}: {
  position: V3
  color: string
  accent: string
  number: number
}) {
  const stripe = <meshStandardMaterial color={accent} roughness={0.5} />
  // 헬멧 옆면 번호 (투명 배경)
  const helmetTex = useMemo(
    () =>
      makeCanvasTexture(128, 64, (ctx, w, h) => {
        ctx.fillStyle = '#111'
        ctx.font = 'italic bold 52px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(number), w / 2, h / 2 + 3)
      }),
    [number],
  )

  return (
    <group position={position}>
      {/* 셸: 앞뒤로 살짝 긴 달걀형 */}
      <mesh scale={[1, 1, 1.1]} castShadow>
        <sphereGeometry args={[0.18, 28, 20]} />
        <meshPhysicalMaterial color="#fafafa" metalness={0.15} roughness={0.2} clearcoat={1} />
      </mesh>
      {/* 턱 부분 */}
      <mesh position={[0, -0.09, 0.07]} scale={[0.92, 0.6, 1]} castShadow>
        <sphereGeometry args={[0.16, 20, 14]} />
        <meshPhysicalMaterial color="#fafafa" metalness={0.15} roughness={0.2} clearcoat={1} />
      </mesh>
      {/* 정수리 → 뒤통수 줄무늬 (차체 색) */}
      <mesh rotation={[0, Math.PI / 2, 0]} scale={[1.1, 1, 1]}>
        <torusGeometry args={[0.181, 0.032, 8, 32, Math.PI]} />
        <meshStandardMaterial color={color} roughness={0.3} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.06, 0, 0]} rotation={[0, Math.PI / 2, 0]} scale={[1.1, 1, 1]}>
          <torusGeometry args={[0.176, 0.008, 6, 32, Math.PI]} />
          {stripe}
        </mesh>
      ))}
      {/* 바이저 (미러 코팅) */}
      <mesh position={[0, 0.0, 0.035]} rotation={[0.05, 0, 0]} scale={[1, 1, 1.1]}>
        <sphereGeometry args={[0.172, 28, 12, Math.PI * 0.18, Math.PI * 0.64, Math.PI * 0.4, Math.PI * 0.2]} />
        <meshPhysicalMaterial color="#2a1d4a" metalness={1} roughness={0.05} iridescence={1} iridescenceIOR={1.6} />
      </mesh>
      {/* 바이저 고정 나사 */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.168, 0.0, 0.05]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.022, 0.022, 0.02, 12]} />
          <meshStandardMaterial color="#333" metalness={0.6} roughness={0.3} />
        </mesh>
      ))}
      {/* 헬멧 뒤 스포일러 */}
      <mesh position={[0, 0.07, -0.19]} rotation={[0.5, 0, 0]} castShadow>
        <boxGeometry args={[0.16, 0.025, 0.06]} />
        <meshStandardMaterial color={color} roughness={0.3} />
      </mesh>
      {/* 옆면 번호 */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.183, 0.05, -0.06]} rotation={[0, (s * Math.PI) / 2, 0]}>
          <planeGeometry args={[0.12, 0.06]} />
          <meshStandardMaterial map={helmetTex} transparent depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

/** 레이싱 슈트 + 장갑 + 풀페이스 헬멧을 쓴 운전자 */
export default function Driver({ upperBodyRef, color, accent, number }: DriverProps) {
  const suit = <meshStandardMaterial color="#1565c0" roughness={0.65} />
  const suitDark = <meshStandardMaterial color="#0d2a52" roughness={0.7} />
  const glove = <meshStandardMaterial color="#1a1a1a" roughness={0.6} />
  const stripe = <meshStandardMaterial color={accent} roughness={0.5} />

  return (
    <group position={[0, 0.05, -0.33]}>
      {/* 다리 (앞쪽으로 뻗음) + 부츠 */}
      {[-0.11, 0.11].map((x) => (
        <group key={x}>
          <Limb from={[x, 0.08, 0.05]} to={[x, 0.12, 0.42]} radius={0.075}>
            {suit}
          </Limb>
          <Limb from={[x, 0.12, 0.42]} to={[x, 0.04, 0.7]} radius={0.06}>
            {suit}
          </Limb>
          <mesh position={[x, 0.07, 0.76]} rotation={[0.4, 0, 0]} castShadow>
            <boxGeometry args={[0.1, 0.14, 0.12]} />
            {glove}
          </mesh>
        </group>
      ))}

      <group ref={upperBodyRef}>
        {/* 몸통: 가슴이 넓고 허리가 좁은 형태 */}
        <mesh position={[0, 0.27, -0.03]} rotation={[-0.2, 0, 0]} scale={[1.12, 1, 0.85]} castShadow>
          <capsuleGeometry args={[0.15, 0.22, 6, 16]} />
          {suit}
        </mesh>
        {/* 옆구리 줄무늬 */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.163, 0.26, -0.03]} rotation={[-0.2, 0, 0]}>
            <boxGeometry args={[0.015, 0.3, 0.07]} />
            {stripe}
          </mesh>
        ))}
        {/* 가슴 패널 + 안전벨트 */}
        <mesh position={[0, 0.3, 0.095]} rotation={[-0.2, 0, 0]}>
          <boxGeometry args={[0.16, 0.1, 0.01]} />
          <meshStandardMaterial color={color} roughness={0.5} />
        </mesh>
        {[-0.07, 0.07].map((x) => (
          <mesh key={x} position={[x, 0.3, 0.1]} rotation={[-0.2, 0, x > 0 ? -0.12 : 0.12]}>
            <boxGeometry args={[0.035, 0.32, 0.012]} />
            <meshStandardMaterial color="#c62828" roughness={0.6} />
          </mesh>
        ))}
        <mesh position={[0, 0.17, 0.12]} rotation={[-0.2, 0, 0]}>
          <boxGeometry args={[0.07, 0.07, 0.02]} />
          <meshStandardMaterial color="#b0b4b8" metalness={0.9} roughness={0.25} />
        </mesh>
        {/* 허리 */}
        <mesh position={[0, 0.1, -0.03]} scale={[1, 0.6, 0.85]}>
          <sphereGeometry args={[0.15, 16, 10]} />
          {suitDark}
        </mesh>

        {/* 어깨 → 팔꿈치 → 핸들 위 장갑 */}
        {[-1, 1].map((s) => {
          const sh: V3 = [SHOULDER[0] * s, SHOULDER[1], SHOULDER[2]]
          const el: V3 = [ELBOW[0] * s, ELBOW[1], ELBOW[2]]
          const hd: V3 = [HAND[0] * s, HAND[1], HAND[2]]
          return (
            <group key={s}>
              <mesh position={sh} castShadow>
                <sphereGeometry args={[0.07, 12, 10]} />
                {suit}
              </mesh>
              <Limb from={sh} to={el} radius={0.052}>
                {suit}
              </Limb>
              <Limb from={el} to={hd} radius={0.045}>
                {suit}
              </Limb>
              {/* 장갑 커프 */}
              <mesh position={[hd[0] - s * 0.01, hd[1], hd[2] - 0.06]} rotation={[Math.PI / 2 - 0.1, 0, 0]}>
                <cylinderGeometry args={[0.05, 0.048, 0.06, 10]} />
                {stripe}
              </mesh>
              <mesh position={hd} scale={[1, 0.85, 1.25]} castShadow>
                <sphereGeometry args={[0.052, 12, 10]} />
                {glove}
              </mesh>
            </group>
          )
        })}

        {/* 목 + 넥 서포트 */}
        <mesh position={[0, 0.48, -0.04]}>
          <cylinderGeometry args={[0.06, 0.07, 0.1, 12]} />
          {suitDark}
        </mesh>
        <mesh position={[0, 0.46, -0.06]} rotation={[Math.PI / 2 + 0.15, 0, 0]}>
          <torusGeometry args={[0.13, 0.035, 8, 20, Math.PI * 1.25]} />
          <meshStandardMaterial color="#222" roughness={0.5} />
        </mesh>

        <Helmet position={[0, 0.65, -0.04]} color={color} accent={accent} number={number} />
      </group>
    </group>
  )
}

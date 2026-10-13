import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type MutableRefObject } from 'react'
import { ExtrudeGeometry, LatheGeometry, Shape, Vector2, type Group } from 'three'
import { makeCanvasTexture } from '../utils/canvasTexture'
import Driver from './Driver'

type KartModelProps = {
  /** 현재 조향값 (rad). 핸들과 운전자 팔을 돌리는 데 사용 */
  steer: MutableRefObject<number>
  color?: string
  accent?: string
  number?: number
}

/**
 * 옆에서 본 단면(z, y)을 그려 X축 방향으로 width만큼 밀어낸 형상 (모서리는 bevel로 둥글게).
 * draw는 Shape 좌표의 x = 모델 z(앞), y = 모델 y(위)로 그린다. 결과는 x 방향 가운데 정렬.
 */
export function sideProfile(draw: (s: Shape) => void, width: number, bevel: number) {
  const shape = new Shape()
  draw(shape)
  const g = new ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 16,
  })
  g.translate(0, 0, -width / 2)
  g.rotateY(-Math.PI / 2) // shape x → 모델 +z
  return g
}

/** 날개 단면 (앞이 둥글고 뒤가 얇은 에어포일). chord: 시위 길이 */
function airfoil(chord: number, thickness: number) {
  return (s: Shape) => {
    const t = thickness
    s.moveTo(chord / 2, 0)
    s.bezierCurveTo(chord / 2, t, chord / 4, t * 1.1, 0, t * 0.8)
    s.lineTo(-chord / 2, t * 0.15)
    s.lineTo(-chord / 2, -t * 0.1)
    s.bezierCurveTo(0, -t * 0.3, chord / 2, -t * 0.6, chord / 2, 0)
  }
}

/** 흰 원 안의 레이스 번호 (차체 옆면 데칼) — 바이크도 쓴다 */
export function numberTexture(number: number) {
  return makeCanvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = 8
    ctx.strokeStyle = '#111'
    ctx.stroke()
    ctx.fillStyle = '#111'
    ctx.font = 'bold 84px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(number), w / 2, h / 2 + 6)
  })
}

/**
 * 카트의 시각 모델. 물리 body(차체 박스)와 분리되어 있어서
 * 나중에 GLB 모델로 교체할 때 이 컴포넌트만 바꾸면 된다.
 * 좌표: +Z 앞, +Y 위, 원점 = 물리 차체 박스 중심 (바퀴 중심: x ±0.6, z 0.72 / -0.62, y 약 -0.09, 반지름 0.3)
 */
export default function KartModel({ steer, color = '#d62f2f', accent = '#f5f5f5', number = 7 }: KartModelProps) {
  const wheelRef = useRef<Group>(null)
  const upperBodyRef = useRef<Group>(null)

  const numberTex = useMemo(() => numberTexture(number), [number])

  const geo = useMemo(() => {
    // 노즈콘: 회전체를 앞으로 눕히고 위아래로 납작하게 (끝이 둥근 탄환형)
    const NOSE_LEN = 0.64
    const nosePts: Vector2[] = []
    for (let i = 0; i <= 16; i++) {
      const t = i / 16
      nosePts.push(new Vector2(0.25 * Math.pow(1 - Math.pow(t, 2.2), 0.55) + 0.001, t * NOSE_LEN))
    }
    const nose = new LatheGeometry(nosePts, 28)
    nose.rotateX(Math.PI / 2) // 회전축 +Y → +Z
    nose.scale(1, 0.42, 1)

    // 모노코크: 뒤 → 운전석 → 앞 카울로 올라갔다 노즈 높이로 내려감
    const tub = sideProfile(
      (s) => {
        s.moveTo(0.52, -0.14)
        s.lineTo(-0.78, -0.14)
        s.lineTo(-0.78, 0.0)
        s.quadraticCurveTo(-0.62, 0.06, -0.5, 0.04)
        s.lineTo(-0.05, 0.04) // 운전석 개구부
        s.quadraticCurveTo(0.12, 0.17, 0.3, 0.13) // 앞 카울
        s.quadraticCurveTo(0.45, 0.1, 0.52, 0.06)
        s.closePath()
      },
      0.44,
      0.04,
    )

    // 사이드 포드: 앞은 둥글게 들어 올리고 뒤로 갈수록 낮아짐
    const pod = sideProfile(
      (s) => {
        s.moveTo(0.3, -0.12)
        s.lineTo(-0.22, -0.12)
        s.quadraticCurveTo(-0.28, -0.06, -0.24, 0.0)
        s.quadraticCurveTo(-0.05, 0.06, 0.18, 0.08)
        s.quadraticCurveTo(0.32, 0.06, 0.3, -0.12)
      },
      0.12,
      0.04,
    )

    // 엔진 커버(샤크핀): 롤바 뒤에서 뒤로 낮아짐
    const cover = sideProfile(
      (s) => {
        s.moveTo(-0.52, 0.02)
        s.lineTo(-0.52, 0.42)
        s.quadraticCurveTo(-0.6, 0.44, -0.95, 0.12)
        s.lineTo(-0.95, 0.02)
        s.closePath()
      },
      0.06,
      0.03,
    )

    return {
      nose,
      tub,
      pod,
      cover,
      frontWing: sideProfile(airfoil(0.24, 0.035), 1.3, 0.008),
      frontFlap: sideProfile(airfoil(0.14, 0.025), 1.2, 0.006),
      rearWing: sideProfile(airfoil(0.3, 0.045), 1.08, 0.01),
      rearFlap: sideProfile(airfoil(0.16, 0.03), 1.08, 0.008),
    }
  }, [])

  useFrame(() => {
    // 핸들은 바퀴 조향각보다 크게 돌아가야 자연스럽다
    if (wheelRef.current) wheelRef.current.rotation.z = -steer.current * 2.2
    // 코너에서 운전자가 살짝 몸을 기울임
    if (upperBodyRef.current) upperBodyRef.current.rotation.z = -steer.current * 0.25
  })

  const body = (
    <meshPhysicalMaterial color={color} metalness={0.4} roughness={0.25} clearcoat={1} clearcoatRoughness={0.15} />
  )
  const trim = <meshStandardMaterial color={accent} metalness={0.2} roughness={0.35} />
  const carbon = <meshStandardMaterial color="#17191c" metalness={0.5} roughness={0.45} />
  const dark = <meshStandardMaterial color="#1c1c1c" roughness={0.8} />
  const metal = <meshStandardMaterial color="#b0b4b8" metalness={0.9} roughness={0.25} />
  const chrome = <meshStandardMaterial color="#e6e8ea" metalness={1} roughness={0.12} />

  return (
    <group>
      {/* ---------- 플로어 / 디퓨저 ---------- */}
      <mesh position={[0, -0.17, 0.02]} castShadow receiveShadow>
        <boxGeometry args={[0.92, 0.03, 1.86]} />
        {carbon}
      </mesh>
      {[-0.3, -0.1, 0.1, 0.3].map((x) => (
        <mesh key={x} position={[x, -0.12, -0.98]} rotation={[0.35, 0, 0]} castShadow>
          <boxGeometry args={[0.015, 0.1, 0.22]} />
          {carbon}
        </mesh>
      ))}

      {/* ---------- 모노코크 + 노즈 ---------- */}
      <mesh geometry={geo.tub} castShadow>
        {body}
      </mesh>
      <mesh geometry={geo.nose} position={[0, -0.04, 0.52]} castShadow>
        {body}
      </mesh>
      {/* 노즈 위 흰 줄무늬 */}
      {[-0.07, 0.07].map((x) => (
        <mesh key={x} position={[x, 0.058, 0.64]} rotation={[0.06, 0, 0]}>
          <boxGeometry args={[0.035, 0.01, 0.36]} />
          {trim}
        </mesh>
      ))}
      {/* 운전석 테두리 */}
      <mesh position={[0, 0.06, -0.27]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1.5, 1]}>
        <torusGeometry args={[0.2, 0.025, 8, 28]} />
        {carbon}
      </mesh>

      {/* ---------- 사이드 포드 ---------- */}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.4, 0, 0]}>
          <mesh geometry={geo.pod} castShadow>
            {body}
          </mesh>
          {/* 공기 흡입구 */}
          <mesh position={[side * -0.01, -0.02, 0.345]}>
            <boxGeometry args={[0.13, 0.1, 0.02]} />
            <meshStandardMaterial color="#050607" roughness={1} />
          </mesh>
          {/* 흰 띠 + 번호 */}
          <mesh position={[side * 0.105, -0.085, 0.02]}>
            <boxGeometry args={[0.012, 0.035, 0.6]} />
            {trim}
          </mesh>
          <mesh position={[side * 0.11, 0, -0.02]} rotation={[0, (side * Math.PI) / 2, 0]}>
            <circleGeometry args={[0.065, 24]} />
            <meshStandardMaterial map={numberTex} transparent />
          </mesh>
          {/* 사이드 미러 */}
          <mesh position={[side * -0.12, 0.17, 0.2]} rotation={[0, 0, side * -0.6]}>
            <cylinderGeometry args={[0.008, 0.008, 0.12, 6]} />
            {carbon}
          </mesh>
          <mesh position={[side * -0.08, 0.22, 0.2]}>
            <boxGeometry args={[0.07, 0.04, 0.025]} />
            {body}
          </mesh>
        </group>
      ))}

      {/* ---------- 프런트 윙 ---------- */}
      <mesh geometry={geo.frontWing} position={[0, -0.16, 1.25]} rotation={[-0.05, 0, 0]} castShadow>
        {carbon}
      </mesh>
      <mesh geometry={geo.frontFlap} position={[0, -0.1, 1.14]} rotation={[-0.3, 0, 0]} castShadow>
        {body}
      </mesh>
      {[-0.66, 0.66].map((x) => (
        <mesh key={x} position={[x, -0.12, 1.21]} castShadow>
          <boxGeometry args={[0.02, 0.13, 0.32]} />
          {trim}
        </mesh>
      ))}
      {[-0.1, 0.1].map((x) => (
        <mesh key={x} position={[x, -0.09, 1.13]} rotation={[0.5, 0, 0]}>
          <boxGeometry args={[0.015, 0.1, 0.06]} />
          {carbon}
        </mesh>
      ))}

      {/* ---------- 롤바 + 엔진 커버 ---------- */}
      <mesh position={[0, 0.28, -0.52]}>
        <torusGeometry args={[0.2, 0.025, 8, 24, Math.PI]} />
        {chrome}
      </mesh>
      {[-0.2, 0.2].map((x) => (
        <mesh key={x} position={[x, 0.16, -0.52]}>
          <cylinderGeometry args={[0.025, 0.025, 0.24, 8]} />
          {chrome}
        </mesh>
      ))}
      <mesh geometry={geo.cover} castShadow>
        {body}
      </mesh>

      {/* ---------- 리어 윙 ---------- */}
      <group position={[0, 0.5, -1.0]}>
        <mesh geometry={geo.rearWing} rotation={[0.12, 0, 0]} castShadow>
          {carbon}
        </mesh>
        <mesh geometry={geo.rearFlap} position={[0, 0.07, -0.16]} rotation={[0.5, 0, 0]} castShadow>
          {body}
        </mesh>
        {[-0.56, 0.56].map((x) => (
          <mesh key={x} position={[x, 0.0, -0.05]} castShadow>
            <boxGeometry args={[0.025, 0.24, 0.42]} />
            {body}
          </mesh>
        ))}
        {[-0.56, 0.56].map((x) => (
          <mesh key={x} position={[x * 1.025, 0.08, -0.05]}>
            <boxGeometry args={[0.004, 0.04, 0.42]} />
            {trim}
          </mesh>
        ))}
        {/* 지지대 */}
        {[-0.18, 0.18].map((x) => (
          <mesh key={x} position={[x, -0.22, 0.04]} rotation={[0.25, 0, 0]}>
            <boxGeometry args={[0.02, 0.4, 0.06]} />
            {carbon}
          </mesh>
        ))}
      </group>

      {/* ---------- 뒤 범퍼 ---------- */}
      <mesh position={[0, -0.06, -1.1]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <capsuleGeometry args={[0.045, 1.25, 4, 8]} />
        {carbon}
      </mesh>

      {/* ---------- 엔진 / 배기 ---------- */}
      <mesh position={[0.25, 0.02, -0.72]} castShadow>
        <boxGeometry args={[0.24, 0.24, 0.3]} />
        {metal}
      </mesh>
      {/* 냉각핀 */}
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[0.25, 0.15 + i * 0.025, -0.72]}>
          <boxGeometry args={[0.26, 0.01, 0.32]} />
          {dark}
        </mesh>
      ))}
      {/* 배기관: 엔진에서 뒤로 휘어 나와 끝이 넓어짐 (부스터 화염 위치와 맞춤) */}
      <mesh position={[0.22, 0.02, -0.98]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.045, 0.36, 12]} />
        {chrome}
      </mesh>
      <mesh position={[0.22, 0.02, -1.19]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.06, 0.08, 14, 1, true]} />
        <meshStandardMaterial color="#e6e8ea" metalness={1} roughness={0.12} side={2} />
      </mesh>
      <mesh position={[0.22, 0.02, -1.16]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.01, 12]} />
        <meshStandardMaterial color="#0b0b0b" />
      </mesh>

      {/* ---------- 시트 ---------- */}
      <mesh position={[0, 0.02, -0.35]} castShadow>
        <boxGeometry args={[0.36, 0.08, 0.36]} />
        {dark}
      </mesh>
      <mesh position={[0, 0.22, -0.5]} rotation={[-0.25, 0, 0]} castShadow>
        <boxGeometry args={[0.36, 0.36, 0.06]} />
        {dark}
      </mesh>

      {/* ---------- 스티어링 ---------- */}
      <mesh position={[0, 0.16, 0.34]} rotation={[-0.9, 0, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.24, 6]} />
        {metal}
      </mesh>
      <group position={[0, 0.28, 0.24]} rotation={[-0.9, 0, 0]}>
        <group ref={wheelRef}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.13, 0.022, 8, 24]} />
            {dark}
          </mesh>
          <mesh>
            <boxGeometry args={[0.24, 0.05, 0.03]} />
            {carbon}
          </mesh>
          <mesh position={[0, 0.13, 0]}>
            <boxGeometry args={[0.02, 0.025, 0.035]} />
            <meshStandardMaterial color={accent} />
          </mesh>
        </group>
      </group>

      {/* ---------- 운전자 ---------- */}
      <Driver upperBodyRef={upperBodyRef} color={color} accent={accent} number={number} />
    </group>
  )
}

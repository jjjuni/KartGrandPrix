import { useMemo } from 'react'
import { makeCanvasTexture } from '../utils/canvasTexture'
import { GRID_SLOTS, ROAD_WIDTH, WALL_OFFSET, gridOffset, startPose } from './trackData'

const GATE_HEIGHT = 6.4
const TOWER = 0.9 // 트러스 기둥 한 변

/** 사각 트러스 기둥: 모서리 파이프 4개 + 일정 간격 가로대·대각선 */
function TrussTower({ height }: { height: number }) {
  const h = TOWER / 2
  const steps = Math.floor(height / TOWER)
  const pipe = <meshStandardMaterial color="#cfd3d8" metalness={0.85} roughness={0.25} />
  const diag = Math.hypot(TOWER, TOWER)
  return (
    <group>
      {[
        [-h, -h],
        [h, -h],
        [-h, h],
        [h, h],
      ].map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[x, height / 2, z]} castShadow>
          <cylinderGeometry args={[0.05, 0.05, height, 8]} />
          {pipe}
        </mesh>
      ))}
      {Array.from({ length: steps }, (_, k) => (
        <group key={k} position={[0, (k + 0.5) * TOWER, 0]}>
          {/* 네 면의 대각선 (층마다 방향을 번갈아) */}
          {[0, 1, 2, 3].map((f) => (
            <group key={f} rotation={[0, (f * Math.PI) / 2, 0]}>
              <mesh position={[0, 0, h]} rotation={[0, 0, (k % 2 ? 1 : -1) * Math.PI * 0.25]}>
                <cylinderGeometry args={[0.025, 0.025, diag, 6]} />
                {pipe}
              </mesh>
            </group>
          ))}
        </group>
      ))}
      {/* 받침 */}
      <mesh position={[0, 0.15, 0]} receiveShadow>
        <boxGeometry args={[TOWER + 0.5, 0.3, TOWER + 0.5]} />
        <meshStandardMaterial color="#555" roughness={0.8} />
      </mesh>
    </group>
  )
}

/** 체크무늬 출발선 + 트러스 출발 게이트 + 신호등 + 그리드 */
export default function StartLine() {
  const checker = useMemo(
    () =>
      makeCanvasTexture(256, 32, (ctx, w, h) => {
        const cell = h / 2
        for (let x = 0; x < w / cell; x++) {
          for (let y = 0; y < 2; y++) {
            ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff'
            ctx.fillRect(x * cell, y * cell, cell, cell)
          }
        }
      }),
    [],
  )
  const banner = useMemo(
    () =>
      makeCanvasTexture(1024, 128, (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, 0, h)
        g.addColorStop(0, '#1a237e')
        g.addColorStop(1, '#0d1442')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
        // 양 끝 체크무늬
        const c = h / 4
        for (let y = 0; y < 4; y++)
          for (let x = 0; x < 4; x++) {
            ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff'
            ctx.fillRect(x * c, y * c, c, c)
            ctx.fillRect(w - 4 * c + x * c, y * c, c, c)
          }
        ctx.fillStyle = '#ffca28'
        ctx.fillRect(4 * c, h - 10, w - 8 * c, 6)
        ctx.fillRect(4 * c, 4, w - 8 * c, 6)
        ctx.fillStyle = '#fff'
        ctx.font = 'italic 900 72px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('START  /  FINISH', w / 2, h / 2 + 4)
      }),
    [],
  )
  // 출발 그리드 칸 (ㄷ자 흰 선)
  const gridSlot = useMemo(
    () =>
      makeCanvasTexture(128, 128, (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h)
        ctx.fillStyle = '#f2f2f2'
        ctx.fillRect(0, h - 12, w, 12) // 캔버스 아래 = 진행 방향 앞쪽
        ctx.fillRect(0, h * 0.55, 10, h * 0.45)
        ctx.fillRect(w - 10, h * 0.55, 10, h * 0.45)
      }),
    [],
  )

  const { position, yaw } = startPose
  const pillarX = WALL_OFFSET + 1.2
  const span = pillarX * 2

  return (
    <group position={[position.x, position.y, position.z]} rotation={[0, yaw, 0]}>
      {/* 바닥 체크 라인 */}
      <mesh position={[0, 0.07, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ROAD_WIDTH, 1.5]} />
        <meshStandardMaterial map={checker} />
      </mesh>
      {/* 출발 그리드: 좌우 엇갈림 */}
      {Array.from({ length: GRID_SLOTS }, (_, k) => (
        <mesh
          key={k}
          position={[gridOffset(k).side, 0.068, -gridOffset(k).back]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[2.6, 2.6]} />
          <meshStandardMaterial map={gridSlot} transparent depthWrite={false} />
        </mesh>
      ))}

      {/* 트러스 기둥 */}
      {[-pillarX, pillarX].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <TrussTower height={GATE_HEIGHT} />
        </group>
      ))}
      {/* 상단 가로 트러스 */}
      <group position={[0, GATE_HEIGHT + 0.6, 0]}>
        {[
          [-0.45, -0.45],
          [0.45, -0.45],
          [-0.45, 0.45],
          [0.45, 0.45],
        ].map(([y, z]) => (
          <mesh key={`${y},${z}`} position={[0, y, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.05, 0.05, span + TOWER, 8]} />
            <meshStandardMaterial color="#cfd3d8" metalness={0.85} roughness={0.25} />
          </mesh>
        ))}
        {/* 배너 (앞/뒤) */}
        <mesh castShadow>
          <boxGeometry args={[span - 1.2, 1.5, 0.3]} />
          <meshStandardMaterial color="#0d1442" />
        </mesh>
        {[0.16, -0.16].map((z) => (
          <mesh key={z} position={[0, 0, z]} rotation={[0, z < 0 ? Math.PI : 0, 0]}>
            <planeGeometry args={[span - 1.4, 1.35]} />
            <meshStandardMaterial map={banner} emissive="#ffffff" emissiveMap={banner} emissiveIntensity={0.25} />
          </mesh>
        ))}
      </group>

      {/* 출발 신호등 (5개, 다가오는 쪽을 향함) */}
      <group position={[0, GATE_HEIGHT - 0.55, -0.35]}>
        <mesh>
          <boxGeometry args={[3.4, 0.7, 0.3]} />
          <meshStandardMaterial color="#111" roughness={0.6} />
        </mesh>
        {[-2, -1, 0, 1, 2].map((k) => (
          <mesh key={k} position={[k * 0.65, 0, -0.16]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.22, 0.22, 0.05, 20]} />
            <meshStandardMaterial color="#2e7d32" emissive="#4cff6a" emissiveIntensity={1.6} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

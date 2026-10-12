import { useMemo } from 'react'
import { makeCanvasTexture } from '../utils/canvasTexture'
import { JUMP, JUMP_LIP, ROAD_WIDTH, WALL_OFFSET, centerPoints, frames, indexAtS } from './trackData'

/** 점프대 립의 노랑/검정 경고 띠 + 진입 전 안내 표지판 */
export default function JumpMarkers() {
  const stripes = useMemo(
    () =>
      makeCanvasTexture(256, 32, (ctx, w, h) => {
        const step = 32
        for (let x = -h; x < w + h; x += step) {
          ctx.fillStyle = (x / step) % 2 ? '#111' : '#ffcc00'
          ctx.beginPath()
          ctx.moveTo(x, h)
          ctx.lineTo(x + step / 2, h)
          ctx.lineTo(x + step / 2 + h, 0)
          ctx.lineTo(x + h, 0)
          ctx.fill()
        }
      }),
    [],
  )
  const sign = useMemo(
    () =>
      makeCanvasTexture(256, 160, (ctx, w, h) => {
        ctx.fillStyle = '#ffcc00'
        ctx.fillRect(0, 0, w, h)
        ctx.lineWidth = 10
        ctx.strokeStyle = '#111'
        ctx.strokeRect(5, 5, w - 10, h - 10)
        ctx.fillStyle = '#111'
        ctx.font = 'bold 64px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('JUMP', w / 2, h / 2 - 18)
        ctx.font = 'bold 30px system-ui, sans-serif'
        ctx.fillText('▲ FULL SPEED ▲', w / 2, h / 2 + 38)
      }),
    [],
  )

  // 립 바로 앞 (킥 램프 경사 위)
  const lip = useMemo(() => {
    const i = indexAtS(JUMP_LIP - 0.6)
    const a = centerPoints[i - 1]
    const b = centerPoints[i + 1]
    const p = centerPoints[i]
    const { tangent } = frames[i]
    const pitch = -Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z))
    return { p, yaw: Math.atan2(tangent.x, tangent.z), pitch }
  }, [])

  // 램프 25m 앞, 방벽 바깥 양쪽
  const signs = useMemo(() => {
    const i = indexAtS(JUMP.start - 25)
    const p = centerPoints[i]
    const { tangent, left } = frames[i]
    const yaw = Math.atan2(tangent.x, tangent.z) + Math.PI // 다가오는 카트를 향하도록
    return [1, -1].map((side) => ({
      x: p.x + left.x * (WALL_OFFSET + 1.2) * side,
      y: p.y,
      z: p.z + left.z * (WALL_OFFSET + 1.2) * side,
      yaw,
    }))
  }, [])

  return (
    <>
      <group position={[lip.p.x, lip.p.y + 0.08, lip.p.z]} rotation={[0, lip.yaw, 0]}>
        <mesh rotation={[-Math.PI / 2 + lip.pitch, 0, 0]}>
          <planeGeometry args={[ROAD_WIDTH, 1.2]} />
          <meshStandardMaterial map={stripes} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
        </mesh>
      </group>
      {signs.map((s, k) => (
        <group key={k} position={[s.x, s.y, s.z]} rotation={[0, s.yaw, 0]}>
          <mesh position={[0, 1.2, 0]} castShadow>
            <boxGeometry args={[0.12, 2.4, 0.12]} />
            <meshStandardMaterial color="#777" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0, 2.6, 0.08]} castShadow>
            <boxGeometry args={[2.4, 1.5, 0.06]} />
            <meshStandardMaterial color="#222" />
          </mesh>
          <mesh position={[0, 2.6, 0.115]}>
            <planeGeometry args={[2.3, 1.4]} />
            <meshStandardMaterial map={sign} />
          </mesh>
        </group>
      ))}
    </>
  )
}

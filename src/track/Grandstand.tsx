import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, Object3D, type InstancedMesh } from 'three'
import { makeCanvasTexture, seededRandom } from '../utils/canvasTexture'
import { WALL_OFFSET, centerPoints, frames, indexAtS } from './trackData'

/**
 * 출발 직선 바깥쪽 관중석. 로컬 좌표: +x = 트랙에서 멀어지는 방향(진행 방향 왼쪽), +z = 진행 방향
 */
const LENGTH = 40
const TIERS = 6
const TIER_DEPTH = 1.3
const TIER_RISE = 0.55
const DEPTH = 1 + TIERS * TIER_DEPTH + 0.6
const FRONT = WALL_OFFSET + 2.8 // 중심선에서 관중석 앞면까지

const anchorIndex = indexAtS(14)
const anchor = centerPoints[anchorIndex]
const { tangent, left } = frames[anchorIndex]
const origin = anchor.clone().addScaledVector(left, FRONT)
const yaw = Math.atan2(tangent.x, tangent.z)

/** 관중석이 차지하는 영역인지 (나무 배치에서 제외용) */
export function isInGrandstand(x: number, z: number) {
  const dx = x - origin.x
  const dz = z - origin.z
  const lx = dx * left.x + dz * left.z
  const lz = dx * tangent.x + dz * tangent.z
  return lx > -3 && lx < DEPTH + 5 && Math.abs(lz) < LENGTH / 2 + 5
}

const tierTop = (i: number) => 0.6 + i * TIER_RISE
const tierX = (i: number) => 1 + i * TIER_DEPTH + TIER_DEPTH / 2

const SHIRTS = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#fb8c00', '#8e24aa', '#ffffff', '#212121', '#00acc1', '#d81b60']
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac']

function Crowd() {
  const bodies = useRef<InstancedMesh>(null)
  const heads = useRef<InstancedMesh>(null)

  const people = useMemo(() => {
    const rand = seededRandom(2024)
    const list: { x: number; y: number; z: number; shirt: string; skin: string; phase: number; speed: number; rot: number }[] = []
    for (let t = 0; t < TIERS; t++) {
      for (let z = -LENGTH / 2 + 1; z < LENGTH / 2 - 1; z += 0.75) {
        if (rand() < 0.22) continue // 빈자리
        list.push({
          x: tierX(t) + (rand() - 0.5) * 0.2,
          y: tierTop(t),
          z: z + (rand() - 0.5) * 0.25,
          shirt: SHIRTS[Math.floor(rand() * SHIRTS.length)],
          skin: SKIN[Math.floor(rand() * SKIN.length)],
          phase: rand() * Math.PI * 2,
          speed: 4 + rand() * 6,
          rot: -Math.PI / 2 + (rand() - 0.5) * 0.6, // 트랙(-x)을 바라봄
        })
      }
    }
    return list
  }, [])

  useLayoutEffect(() => {
    const c = new Color()
    people.forEach((p, i) => {
      bodies.current!.setColorAt(i, c.set(p.shirt))
      heads.current!.setColorAt(i, c.set(p.skin))
    })
    bodies.current!.instanceColor!.needsUpdate = true
    heads.current!.instanceColor!.needsUpdate = true
  }, [people])

  // 관중이 들썩이며 응원 (매 프레임 인스턴스 행렬 갱신 — 수백 개라 비용은 작다)
  const dummy = useMemo(() => new Object3D(), [])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    people.forEach((p, i) => {
      const bob = Math.max(0, Math.sin(t * p.speed + p.phase)) * 0.12
      dummy.rotation.set(0, p.rot, 0)
      dummy.position.set(p.x, p.y + 0.38 + bob, p.z)
      dummy.updateMatrix()
      bodies.current!.setMatrixAt(i, dummy.matrix)
      dummy.position.set(p.x, p.y + 0.82 + bob, p.z)
      dummy.updateMatrix()
      heads.current!.setMatrixAt(i, dummy.matrix)
    })
    bodies.current!.instanceMatrix.needsUpdate = true
    heads.current!.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh ref={bodies} args={[undefined, undefined, people.length]} castShadow>
        <capsuleGeometry args={[0.17, 0.4, 3, 8]} />
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, people.length]}>
        <sphereGeometry args={[0.13, 10, 8]} />
        <meshStandardMaterial roughness={0.7} />
      </instancedMesh>
    </>
  )
}

export default function Grandstand() {
  const banner = useMemo(
    () =>
      makeCanvasTexture(2048, 48, (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, w, 0)
        g.addColorStop(0, '#b71c1c')
        g.addColorStop(0.5, '#e53935')
        g.addColorStop(1, '#b71c1c')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#fff'
        ctx.font = 'italic 900 34px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        for (let k = 0; k < 5; k++) ctx.fillText('KART GRAND PRIX', (w / 5) * (k + 0.5), h / 2 + 2)
        // 체크무늬 양 끝
        for (let y = 0; y < 3; y++)
          for (let x = 0; x < 3; x++) {
            ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff'
            ctx.fillRect(x * 16, y * 16, 16, 16)
            ctx.fillRect(w - 48 + x * 16, y * 16, 16, 16)
          }
      }),
    [],
  )

  const roofBack = tierTop(TIERS - 1) + 4.2
  const roofFront = roofBack - 0.9
  const roofPitch = Math.atan2(roofBack - roofFront, DEPTH + 1)

  return (
    <group position={[origin.x, origin.y, origin.z]} rotation={[0, yaw, 0]}>
      {/* 기초 (지형과의 틈을 가림) */}
      <mesh position={[DEPTH / 2, -1.5, 0]} receiveShadow>
        <boxGeometry args={[DEPTH + 1, 3.2, LENGTH + 1]} />
        <meshStandardMaterial color="#9e9e9e" roughness={0.9} />
      </mesh>
      {/* 앞 난간 벽 + 배너 */}
      <mesh position={[0.15, 0.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.3, 1.1, LENGTH]} />
        <meshStandardMaterial color="#eceff1" roughness={0.7} />
      </mesh>
      <mesh position={[-0.01, 0.6, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[LENGTH - 0.4, 0.8]} />
        <meshStandardMaterial map={banner} roughness={0.6} />
      </mesh>
      {/* 계단식 좌석 */}
      {Array.from({ length: TIERS }, (_, i) => (
        <group key={i}>
          <mesh position={[tierX(i), tierTop(i) / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[TIER_DEPTH, tierTop(i), LENGTH]} />
            <meshStandardMaterial color={i % 2 ? '#cfd8dc' : '#b0bec5'} roughness={0.85} />
          </mesh>
          <mesh position={[tierX(i) + 0.3, tierTop(i) + 0.12, 0]}>
            <boxGeometry args={[0.45, 0.24, LENGTH - 0.6]} />
            <meshStandardMaterial color={i % 2 ? '#1565c0' : '#1e88e5'} roughness={0.5} />
          </mesh>
        </group>
      ))}
      {/* 뒷벽 */}
      <mesh position={[DEPTH - 0.2, roofBack / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.4, roofBack, LENGTH]} />
        <meshStandardMaterial color="#eceff1" roughness={0.8} />
      </mesh>
      {/* 지붕 기둥 */}
      {Array.from({ length: 5 }, (_, k) => -LENGTH / 2 + 0.5 + (k * (LENGTH - 1)) / 4).map((z) => (
        <mesh key={z} position={[0.6, roofFront / 2, z]} castShadow>
          <cylinderGeometry args={[0.12, 0.14, roofFront, 10]} />
          <meshStandardMaterial color="#b0b4b8" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
      {/* 지붕 (트랙 쪽으로 살짝 낮아짐) + 빨간 테두리 */}
      <group position={[DEPTH / 2 - 0.3, (roofBack + roofFront) / 2, 0]} rotation={[0, 0, roofPitch]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[DEPTH + 1.6, 0.18, LENGTH + 1.2]} />
          <meshStandardMaterial color="#f5f5f5" roughness={0.5} />
        </mesh>
        <mesh position={[-(DEPTH + 1.6) / 2, 0, 0]}>
          <boxGeometry args={[0.1, 0.4, LENGTH + 1.2]} />
          <meshStandardMaterial color="#d32f2f" roughness={0.5} />
        </mesh>
      </group>
      {/* 지붕 위 깃발 */}
      {[-16, -8, 0, 8, 16].map((z, k) => (
        <group key={z} position={[DEPTH - 0.3, roofBack, z]}>
          <mesh position={[0, 1.2, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 2.4, 6]} />
            <meshStandardMaterial color="#cfd8dc" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0, 2.05, 0.45]} rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[0.9, 0.55]} />
            <meshStandardMaterial color={['#e53935', '#fdd835', '#1e88e5', '#43a047', '#fafafa'][k]} side={2} />
          </mesh>
        </group>
      ))}
      <Crowd />
    </group>
  )
}

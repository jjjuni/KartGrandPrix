import { useFrame } from '@react-three/fiber'
import { useMemo, type MutableRefObject } from 'react'
import { BufferAttribute, BufferGeometry, DoubleSide, Vector3 } from 'three'
import type { KartPhysics } from '../physics/vehicle'

const MAX_SEGMENTS = 3000 // 링 버퍼 크기 — 가득 차면 가장 오래된 자국부터 덮어쓴다
const MARK_WIDTH = 0.22 // 타이어 폭보다 약간 좁게
const MIN_SEGMENT = 0.25 // 이만큼 움직일 때마다 한 칸 추가 (m)
const LIFT = 0.075 // 도로 메시(지면 위 0.06m)보다 살짝 위에
const MIN_SLIP = 1.5 // 이 속도(m/s) 이상 미끄러질 때만 자국

type Trail = { active: boolean; last: Vector3; left: Vector3; right: Vector3 }

/**
 * 미끄러지는 바퀴가 지나간 자리에 남는 타이어 자국.
 * 하나의 BufferGeometry를 링 버퍼로 써서 수천 개의 사각형도 draw call 1번에 그린다.
 * 바퀴마다 이전 끝점(좌·우)을 이어 붙여 끊김 없는 띠가 되게 한다.
 */
export default function SkidMarks({ kartRef }: { kartRef: MutableRefObject<KartPhysics | null> }) {
  const { geometry, positions, colors } = useMemo(() => {
    const geo = new BufferGeometry()
    const positions = new Float32Array(MAX_SEGMENTS * 4 * 3)
    const colors = new Float32Array(MAX_SEGMENTS * 4 * 4) // RGBA — 알파로 진하기 표현
    const index = new Uint32Array(MAX_SEGMENTS * 6)
    for (let k = 0; k < MAX_SEGMENTS; k++) {
      const v = k * 4
      index.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], k * 6)
    }
    geo.setAttribute('position', new BufferAttribute(positions, 3))
    geo.setAttribute('color', new BufferAttribute(colors, 4))
    geo.setIndex(new BufferAttribute(index, 1))
    return { geometry: geo, positions, colors }
  }, [])

  const state = useMemo(
    () => ({
      next: 0,
      trails: Array.from({ length: 4 }, (): Trail => ({
        active: false,
        last: new Vector3(),
        left: new Vector3(),
        right: new Vector3(),
      })),
      p: new Vector3(),
      n: new Vector3(),
      dir: new Vector3(),
      side: new Vector3(),
      l: new Vector3(),
      r: new Vector3(),
    }),
    [],
  )

  useFrame(() => {
    const kart = kartRef.current
    if (!kart) return
    let changed = false
    kart.wheels.forEach((w, i) => {
      const trail = state.trails[i]
      const sliding = w.contact && w.load > 50 && w.slipSpeed > MIN_SLIP
      if (!sliding) {
        trail.active = false
        return
      }
      const { p, n, dir, side, l, r } = state
      n.set(w.hitNormal.x, w.hitNormal.y, w.hitNormal.z)
      p.set(w.hitPoint.x, w.hitPoint.y, w.hitPoint.z).addScaledVector(n, LIFT)
      if (!trail.active) {
        trail.active = true
        trail.last.copy(p)
        trail.left.copy(p)
        trail.right.copy(p)
        return
      }
      dir.subVectors(p, trail.last)
      if (dir.length() < MIN_SEGMENT) return
      side.crossVectors(dir, n).normalize().multiplyScalar(MARK_WIDTH / 2)
      l.copy(p).add(side)
      r.copy(p).sub(side)

      // 사각형 한 칸: 이전 끝점(좌·우) → 현재 끝점(좌·우)
      const k = state.next
      positions.set(
        [
          trail.left.x, trail.left.y, trail.left.z,
          trail.right.x, trail.right.y, trail.right.z,
          l.x, l.y, l.z,
          r.x, r.y, r.z,
        ],
        k * 12,
      )
      // 많이 미끄러질수록 진하게
      const alpha = Math.min(0.85, 0.4 + (w.slipSpeed - MIN_SLIP) * 0.08)
      for (let v = 0; v < 4; v++) colors.set([0.05, 0.05, 0.05, alpha], (k * 4 + v) * 4)
      state.next = (k + 1) % MAX_SEGMENTS

      trail.last.copy(p)
      trail.left.copy(l)
      trail.right.copy(r)
      changed = true
    })
    if (changed) {
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.color.needsUpdate = true
    }
  })

  return (
    // 자국이 트랙 전체에 흩어지므로 화면 밖 판정(경계 구)을 끈다
    <mesh geometry={geometry} frustumCulled={false} renderOrder={1}>
      <meshBasicMaterial
        vertexColors
        transparent
        depthWrite={false}
        side={DoubleSide}
        polygonOffset
        polygonOffsetFactor={-4}
        polygonOffsetUnits={-4}
      />
    </mesh>
  )
}

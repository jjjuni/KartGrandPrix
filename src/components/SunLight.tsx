import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Object3D, type DirectionalLight } from 'three'
import { kartState } from '../game/kartState'

const OFFSET = { x: 40, y: 60, z: 28 } // 카트 기준 태양 방향
const RANGE = 45 // 그림자 범위 (±m)

/**
 * 넓어진 트랙 전체에 그림자를 깔면 해상도가 떨어지므로
 * 그림자 카메라가 카트 주변만 따라다니게 한다.
 */
export default function SunLight() {
  const light = useRef<DirectionalLight>(null)
  const target = useMemo(() => new Object3D(), [])

  useFrame(() => {
    const l = light.current
    if (!l) return
    const p = kartState.position
    // 텍셀 단위로 스냅해서 이동 중 그림자 가장자리가 지글거리지 않게
    const texel = (RANGE * 2) / 2048
    const x = Math.round(p.x / texel) * texel
    const z = Math.round(p.z / texel) * texel
    target.position.set(x, p.y, z)
    l.position.set(x + OFFSET.x, p.y + OFFSET.y, z + OFFSET.z)
    target.updateMatrixWorld()
  })

  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={light}
        target={target}
        castShadow
        intensity={1.6}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-RANGE}
        shadow-camera-right={RANGE}
        shadow-camera-top={RANGE}
        shadow-camera-bottom={-RANGE}
        shadow-camera-near={1}
        shadow-camera-far={200}
        shadow-bias={-0.0004}
      />
    </>
  )
}

import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, ExtrudeGeometry, Object3D, Shape, type InstancedMesh } from 'three'
import { CURB_OFFSET, currentMap, offsetPoints } from './trackData'

const CURB_SEGMENT = 1.5

/** 연석 단면: 도로 쪽은 낮게 비스듬히, 바깥쪽은 둥글게 솟은 형태. side = 도로 반대쪽 방향(+1: +x) */
function curbGeometry(length: number, side: 1 | -1) {
  const s = new Shape()
  const w = 0.45
  s.moveTo(-w * side, 0)
  s.lineTo(w * side, 0)
  s.lineTo(w * side, 0.07)
  s.quadraticCurveTo(w * 0.6 * side, 0.13, 0.1 * side, 0.12)
  s.lineTo(-w * side, 0.025)
  s.closePath()
  const g = new ExtrudeGeometry(s, { depth: length, bevelEnabled: false, curveSegments: 4 })
  g.translate(0, 0, -length / 2)
  g.computeVertexNormals()
  return g
}

/** 도로 양쪽의 빨강/흰색 연석 (시각용, 충돌 없음) */
function CurbSide({ offset }: { offset: number }) {
  const ref = useRef<InstancedMesh>(null)
  const segments = useMemo(() => offsetPoints(offset, CURB_SEGMENT), [offset])
  // offsetPoints의 세그먼트는 진행 방향(+z)으로 놓이므로 로컬 +x = 진행 방향 왼쪽(frames.left). 왼쪽(+offset) 연석의 바깥은 +x
  const geometry = useMemo(
    () => curbGeometry(Math.max(...segments.map((s) => s.length)) + 0.02, offset > 0 ? 1 : -1),
    [segments, offset],
  )

  useLayoutEffect(() => {
    const mesh = ref.current!
    const dummy = new Object3D()
    const [colorA, colorB] = currentMap.theme.curbs.map((col) => new Color(col))
    segments.forEach((s, i) => {
      dummy.position.set(s.position.x, s.position.y + 0.035, s.position.z)
      dummy.rotation.set(...s.rotation)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, i % 2 ? colorA : colorB)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor!.needsUpdate = true
  }, [segments])

  return (
    <instancedMesh ref={ref} args={[geometry, undefined, segments.length]} receiveShadow>
      <meshStandardMaterial roughness={0.55} />
    </instancedMesh>
  )
}

export default function Curbs() {
  return (
    <>
      <CurbSide offset={CURB_OFFSET} />
      <CurbSide offset={-CURB_OFFSET} />
    </>
  )
}

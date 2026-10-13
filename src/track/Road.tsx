import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { makeCanvasTexture, seededRandom } from '../utils/canvasTexture'
import { BRANCH_WIDTH, ROAD_WIDTH, branchFrames, branchPoints, centerPoints, currentMap, frames } from './trackData'

const TEXTURE_LENGTH = 8 // 텍스처 한 장이 덮는 도로 길이 (m)
/** 맵별 도로 색조 (질감에 곱해진다) */
const ROAD_TINT = { grass: '#ffffff', sand: '#f2dfc4', snow: '#e4edf7', rock: '#d9cfc4' }
const LIFT = 0.06 // 지면(Heightfield 메시)과 겹쳐 깜빡이지 않도록 살짝 띄움

/** 아스팔트(골재 알갱이 + 보수 자국) + 타이어가 지나는 어두운 주행 라인 + 가장자리 흰 선 + 중앙 점선 */
function makeRoadTexture() {
  return makeCanvasTexture(
    512,
    Math.round((512 * TEXTURE_LENGTH) / ROAD_WIDTH),
    (ctx, w, h) => {
      ctx.fillStyle = '#3a3c41'
      ctx.fillRect(0, 0, w, h)
      const rand = seededRandom(7)
      // 보수한 아스팔트 패치 (약간 다른 톤의 사각형)
      for (let i = 0; i < 3; i++) {
        const v = 52 + rand() * 10
        ctx.fillStyle = `rgba(${v},${v},${v + 3},0.6)`
        ctx.fillRect(w * (0.1 + rand() * 0.7), rand() * h, w * (0.08 + rand() * 0.12), h * (0.05 + rand() * 0.12))
      }
      // 타이어 고무가 묻은 두 줄 주행 라인
      for (const cx of [0.3, 0.7]) {
        const g = ctx.createLinearGradient(w * (cx - 0.1), 0, w * (cx + 0.1), 0)
        g.addColorStop(0, 'rgba(20,20,22,0)')
        g.addColorStop(0.5, 'rgba(20,20,22,0.28)')
        g.addColorStop(1, 'rgba(20,20,22,0)')
        ctx.fillStyle = g
        ctx.fillRect(w * (cx - 0.1), 0, w * 0.2, h)
      }
      // 골재 알갱이 (밝은 점 + 어두운 점)
      for (let i = 0; i < 9000; i++) {
        const light = rand() > 0.45
        const v = light ? 85 + rand() * 50 : 25 + rand() * 20
        ctx.fillStyle = `rgba(${v},${v},${v + 4},${light ? 0.45 : 0.6})`
        const size = 0.8 + rand() * 1.6
        ctx.fillRect(rand() * w, rand() * h, size, size)
      }
      // 가는 균열
      ctx.strokeStyle = 'rgba(15,15,17,0.5)'
      ctx.lineWidth = 1
      for (let i = 0; i < 4; i++) {
        let x = rand() * w
        let y = rand() * h
        ctx.beginPath()
        ctx.moveTo(x, y)
        for (let k = 0; k < 6; k++) ctx.lineTo((x += (rand() - 0.5) * 30), (y += rand() * 20))
        ctx.stroke()
      }
      // 가장자리 실선 + 중앙 점선 (살짝 닳은 느낌)
      ctx.fillStyle = '#ececec'
      ctx.fillRect(w * 0.025, 0, w * 0.022, h)
      ctx.fillRect(w * 0.953, 0, w * 0.022, h)
      ctx.fillRect(w * 0.49, 0, w * 0.02, h * 0.5)
      ctx.globalCompositeOperation = 'multiply'
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = 'rgba(120,120,125,0.5)'
        const x = [0.025, 0.953, 0.49][i % 3] * w + rand() * w * 0.022
        ctx.fillRect(x, rand() * h, 1.5, 1.5)
      }
      ctx.globalCompositeOperation = 'source-over'
    },
    true,
  )
}

/** 흙길: 다져진 흙 바탕 + 자갈 + 바퀴 자국 두 줄 + 물웅덩이 얼룩 (차선 없음) */
function makeDirtTexture() {
  return makeCanvasTexture(
    512,
    Math.round((512 * TEXTURE_LENGTH) / ROAD_WIDTH),
    (ctx, w, h) => {
      ctx.fillStyle = '#8a6a48'
      ctx.fillRect(0, 0, w, h)
      const rand = seededRandom(13)
      // 색이 다른 흙 얼룩
      for (let i = 0; i < 26; i++) {
        const v = rand()
        ctx.fillStyle = v > 0.5 ? 'rgba(120,90,60,0.35)' : 'rgba(165,130,92,0.3)'
        ctx.beginPath()
        ctx.ellipse(rand() * w, rand() * h, 20 + rand() * 60, 8 + rand() * 25, rand() * Math.PI, 0, Math.PI * 2)
        ctx.fill()
      }
      // 바퀴가 다져 놓은 어두운 자국 두 줄 (가장자리는 흐리게)
      for (const cx of [0.32, 0.68]) {
        const g = ctx.createLinearGradient(w * (cx - 0.08), 0, w * (cx + 0.08), 0)
        g.addColorStop(0, 'rgba(70,50,32,0)')
        g.addColorStop(0.5, 'rgba(70,50,32,0.45)')
        g.addColorStop(1, 'rgba(70,50,32,0)')
        ctx.fillStyle = g
        ctx.fillRect(w * (cx - 0.08), 0, w * 0.16, h)
      }
      // 자갈
      for (let i = 0; i < 5000; i++) {
        const light = rand() > 0.4
        const v = light ? 170 + rand() * 60 : 60 + rand() * 30
        ctx.fillStyle = `rgba(${v},${v * 0.9},${v * 0.78},${light ? 0.55 : 0.6})`
        const size = 1 + rand() * 2.5
        ctx.fillRect(rand() * w, rand() * h, size, size)
      }
      // 가장자리는 풀과 섞이듯 어둡게
      for (const [x0, x1] of [[0, 0.06], [1, 0.94]]) {
        const g = ctx.createLinearGradient(w * x0, 0, w * x1, 0)
        g.addColorStop(0, 'rgba(90,100,55,0.75)')
        g.addColorStop(1, 'rgba(90,100,55,0)')
        ctx.fillStyle = g
        ctx.fillRect(Math.min(x0, x1) * w, 0, 0.06 * w, h)
      }
    },
    true,
  )
}

/** 중심선을 따라 폭 width인 리본 메시를 생성 (높낮이는 중심선 y를 그대로 따름). 지름길은 열린 길 */
function makeRoadGeometry(points = centerPoints, dirs = frames, width = ROAD_WIDTH, closed = true) {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const n = points.length
  const last = closed ? n : n - 1
  let dist = 0

  for (let i = 0; i <= last; i++) {
    const p = points[i % n]
    const { left } = dirs[i % n]
    if (i > 0) dist += points[i - 1].distanceTo(p)
    const l = p.clone().addScaledVector(left, width / 2)
    const r = p.clone().addScaledVector(left, -width / 2)
    // 지름길은 살짝 낮게 — 본 코스와 겹치는 갈림목에서 본 코스가 위에 그려지게
    const lift = closed ? LIFT : LIFT - 0.02
    positions.push(l.x, p.y + lift, l.z, r.x, p.y + lift, r.z)
    const v = dist / TEXTURE_LENGTH
    uvs.push(0, v, 1, v)
    if (i < last) {
      const a = i * 2
      // 위(+Y)를 향하는 면이 되도록 반시계 방향 순서
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

export default function Road() {
  const geometry = useMemo(() => makeRoadGeometry(), [])
  const branch = useMemo(() => (branchPoints.length ? makeRoadGeometry(branchPoints, branchFrames, BRANCH_WIDTH, false) : null), [])
  const dirt = currentMap.theme.road === 'dirt'
  const texture = useMemo(() => (dirt ? makeDirtTexture() : makeRoadTexture()), [dirt])
  const material = (
    <meshStandardMaterial
      map={texture}
      color={dirt ? '#ffffff' : ROAD_TINT[currentMap.theme.ground.style]}
      roughness={dirt ? 1 : 0.85}
      polygonOffset
      polygonOffsetFactor={-2}
      polygonOffsetUnits={-2}
    />
  )

  return (
    <>
      <mesh geometry={geometry} receiveShadow>
        {material}
      </mesh>
      {branch && (
        <mesh geometry={branch} receiveShadow>
          {material}
        </mesh>
      )}
    </>
  )
}

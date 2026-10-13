import { useEffect, useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { useWorld } from '../physics/PhysicsWorld'
import { createGroundBody } from '../physics/trackBodies'
import { getTerrain, gridX, gridZ } from '../track/terrain'
import { currentMap } from '../track/trackData'
import { makeCanvasTexture, seededRandom } from '../utils/canvasTexture'

const STRIPE = 8 // 잔디 줄무늬 폭 (m)

function makeTerrainGeometry() {
  const { heights: terrainHeights, n } = getTerrain()
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = gridX(i)
      const z = gridZ(j)
      positions.push(x, terrainHeights[i][j], z)
      uvs.push(x / (STRIPE * 2), z / (STRIPE * 2))
    }
  }
  const at = (i: number, j: number) => i * n + j
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      // 위(+Y)를 향하는 면이 되도록 감는 순서 지정
      indices.push(at(i, j), at(i + 1, j), at(i, j + 1))
      indices.push(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1))
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

export default function Ground() {
  // 물리: 같은 높이 데이터로 만든 Heightfield (physics/trackBodies.ts)
  const world = useWorld()
  useEffect(() => {
    const body = createGroundBody()
    world.addBody(body)
    return () => world.removeBody(body)
  }, [world])

  const geometry = useMemo(makeTerrainGeometry, [])

  // 잔디 깎은 자국처럼 보이는 2톤 줄무늬 + 노이즈 → 속도감 확보
  const texture = useMemo(
    () =>
      makeCanvasTexture(
        256,
        256,
        (ctx, w, h) => {
          const { style, a, b } = currentMap.theme.ground
          ctx.fillStyle = a
          ctx.fillRect(0, 0, w, h / 2)
          ctx.fillStyle = b
          ctx.fillRect(0, h / 2, w, h / 2)
          const rand = seededRandom(3)
          if (style === 'sand') {
            // 모래 물결 무늬 + 고운 알갱이
            ctx.fillStyle = a
            ctx.fillRect(0, 0, w, h)
            for (let y = 0; y < h; y += 9) {
              ctx.strokeStyle = 'rgba(150,105,55,0.28)'
              ctx.lineWidth = 2
              ctx.beginPath()
              for (let x = 0; x <= w; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.08 + y) * 2.5)
              ctx.stroke()
            }
            for (let i = 0; i < 4000; i++) {
              ctx.fillStyle = rand() > 0.5 ? 'rgba(255,240,205,0.35)' : 'rgba(160,110,60,0.3)'
              ctx.fillRect(rand() * w, rand() * h, 1, 1)
            }
            return
          }
          if (style === 'snow') {
            // 눈: 푸른 그늘 얼룩 + 반짝이는 알갱이
            for (let i = 0; i < 60; i++) {
              ctx.fillStyle = 'rgba(170,195,225,0.12)'
              ctx.beginPath()
              ctx.ellipse(rand() * w, rand() * h, 6 + rand() * 18, 3 + rand() * 8, rand() * Math.PI, 0, Math.PI * 2)
              ctx.fill()
            }
            for (let i = 0; i < 900; i++) {
              ctx.fillStyle = rand() > 0.3 ? 'rgba(255,255,255,0.9)' : 'rgba(180,215,255,0.8)'
              ctx.fillRect(rand() * w, rand() * h, 1, 1)
            }
            return
          }
          // 풀잎: 짧은 사선 획
          for (let i = 0; i < 5000; i++) {
            const r = rand()
            ctx.strokeStyle =
              r > 0.66 ? 'rgba(35,75,28,0.4)' : r > 0.33 ? 'rgba(125,180,90,0.35)' : 'rgba(90,140,60,0.35)'
            ctx.lineWidth = 1
            const x = rand() * w
            const y = rand() * h
            ctx.beginPath()
            ctx.moveTo(x, y)
            ctx.lineTo(x + (rand() - 0.5) * 2, y - 2 - rand() * 3)
            ctx.stroke()
          }
          // 작은 꽃 (노랑 · 흰색)
          for (let i = 0; i < 25; i++) {
            ctx.fillStyle = rand() > 0.5 ? 'rgba(255,235,90,0.9)' : 'rgba(250,250,250,0.9)'
            ctx.fillRect(rand() * w, rand() * h, 2, 2)
          }
        },
        true,
      ),
    [],
  )

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial map={texture} roughness={1} />
    </mesh>
  )
}

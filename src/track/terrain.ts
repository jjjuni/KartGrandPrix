import { TRACK_SCALE, WALL_OFFSET, centerPoints } from './trackData'

/**
 * 트랙 전체를 덮는 높이맵.
 * - 도로~방벽 구간: 도로 높이와 정확히 같음 (가로 방향으로는 평평)
 * - 그 바깥: 완만한 언덕 지형으로 자연스럽게 이어짐
 * 물리(Heightfield)와 화면(지면 메시)이 같은 데이터를 쓴다.
 */

export const TERRAIN_ELEMENT = 2 // 격자 간격 (m)
export const TERRAIN_SIZE = 500 * TRACK_SCALE // 한 변 길이 (m)
export const TERRAIN_CENTER = { x: 15 * TRACK_SCALE, z: 35 * TRACK_SCALE }
export const TERRAIN_SEGMENTS = TERRAIN_SIZE / TERRAIN_ELEMENT // 525
const N = TERRAIN_SEGMENTS + 1 // 한 변의 정점 수

export const TERRAIN_MIN_X = TERRAIN_CENTER.x - TERRAIN_SIZE / 2
export const TERRAIN_MAX_Z = TERRAIN_CENTER.z + TERRAIN_SIZE / 2

const ROAD_BAND = WALL_OFFSET + 1.5 // 이 거리까지는 도로 높이 그대로
const BLEND = 30 // 도로 높이 → 주변 지형으로 넘어가는 거리

/** 도로에서 먼 곳의 기본 지형 (낮은 구릉) */
function hills(x: number, z: number) {
  return (
    2.2 * Math.sin(x * 0.019 + 1.3) * Math.cos(z * 0.016 - 0.4) +
    1.1 * Math.sin((x + z) * 0.034) +
    0.6 * Math.cos((x - 2 * z) * 0.05) +
    1
  )
}

function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** 격자 좌표 → 월드 좌표. i: +X 방향, j: -Z 방향 (Heightfield를 -90도 눕힌 좌표계와 일치) */
export const gridX = (i: number) => TERRAIN_MIN_X + i * TERRAIN_ELEMENT
export const gridZ = (j: number) => TERRAIN_MAX_Z - j * TERRAIN_ELEMENT

function buildHeights() {
  // 가까운 중심선 샘플을 빨리 찾기 위한 공간 해시 (10m 칸)
  const CELL = 10
  const buckets = new Map<string, number[]>()
  centerPoints.forEach((p, idx) => {
    const key = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`
    const list = buckets.get(key)
    if (list) list.push(idx)
    else buckets.set(key, [idx])
  })
  const SEARCH = Math.ceil((ROAD_BAND + BLEND) / CELL)

  const heights: number[][] = []
  const locked: boolean[][] = [] // 도로 구간은 블러에서 제외
  for (let i = 0; i < N; i++) {
    heights.push(new Array(N))
    locked.push(new Array(N))
    const x = gridX(i)
    for (let j = 0; j < N; j++) {
      const z = gridZ(j)
      const cx = Math.floor(x / CELL)
      const cz = Math.floor(z / CELL)
      let best = Infinity
      let roadH = 0
      for (let a = -SEARCH; a <= SEARCH; a++) {
        for (let b = -SEARCH; b <= SEARCH; b++) {
          const list = buckets.get(`${cx + a},${cz + b}`)
          if (!list) continue
          for (const idx of list) {
            const p = centerPoints[idx]
            const d = (p.x - x) ** 2 + (p.z - z) ** 2
            if (d < best) {
              best = d
              roadH = p.y
            }
          }
        }
      }
      const dist = Math.sqrt(best)
      const w = smoothstep(ROAD_BAND, ROAD_BAND + BLEND, dist)
      heights[i][j] = roadH * (1 - w) + hills(x, z) * w
      locked[i][j] = dist < ROAD_BAND
    }
  }

  // 서로 높이가 다른 두 구간 사이에서 생기는 단차를 부드럽게 (도로 구간은 고정)
  for (let pass = 0; pass < 6; pass++) {
    const prev = heights.map((row) => row.slice())
    for (let i = 1; i < N - 1; i++) {
      for (let j = 1; j < N - 1; j++) {
        if (locked[i][j]) continue
        heights[i][j] =
          (prev[i][j] * 4 + prev[i - 1][j] + prev[i + 1][j] + prev[i][j - 1] + prev[i][j + 1]) / 8
      }
    }
  }
  return heights
}

/** heights[i][j] — cannon Heightfield의 data 형식과 같다 */
export const terrainHeights = buildHeights()

/** 임의 위치의 지면 높이 (격자 쌍선형 보간). 나무 배치·공중 판정에 사용 */
export function terrainHeightAt(x: number, z: number) {
  const fi = (x - TERRAIN_MIN_X) / TERRAIN_ELEMENT
  const fj = (TERRAIN_MAX_Z - z) / TERRAIN_ELEMENT
  const i = Math.min(N - 2, Math.max(0, Math.floor(fi)))
  const j = Math.min(N - 2, Math.max(0, Math.floor(fj)))
  const u = Math.min(1, Math.max(0, fi - i))
  const v = Math.min(1, Math.max(0, fj - j))
  const h = terrainHeights
  return (
    h[i][j] * (1 - u) * (1 - v) + h[i + 1][j] * u * (1 - v) + h[i][j + 1] * (1 - u) * v + h[i + 1][j + 1] * u * v
  )
}

import {
  SAMPLE_SPACING,
  TRACK_LENGTH,
  TUNNEL,
  WALL_OFFSET,
  centerPoints,
  currentMap,
  trackBounds,
  trackVersion,
} from './trackData'

/**
 * 트랙 전체를 덮는 높이맵.
 * - 도로~방벽 구간: 도로 높이와 정확히 같음 (가로 방향으로는 평평)
 * - 그 바깥: 맵에 맞는 기복(숲 구릉 · 사막 모래 언덕 · 극지 눈 둔덕)으로 자연스럽게 이어짐
 * 물리(Heightfield)와 화면(지면 메시)이 같은 데이터를 쓴다. 맵이 바뀌면(trackVersion) 다시 만든다.
 */

export const TERRAIN_ELEMENT = 2 // 격자 간격 (m)
const MARGIN = 220 // 코스 바깥으로 지형을 더 까는 거리 (m) — 장식 배치 범위 + 지평선
const ROAD_BAND = WALL_OFFSET + 1.5 // 이 거리까지는 도로 높이 그대로
const BLEND = 30 // 도로 높이 → 주변 지형으로 넘어가는 거리
const TUNNEL_BAND = 7 // 터널 구간에서 평평한 띠를 더 넓히는 폭 (m) — 터널 벽(Tunnel.tsx) 바깥까지
const TUNNEL_COVER = 13.5 // 터널 둘레 지형을 올리는 높이 (m) — Tunnel.tsx의 산 높이와 같게

export type Terrain = {
  heights: number[][] // heights[i][j] — cannon Heightfield의 data 형식과 같다
  n: number // 한 변의 정점 수
  minX: number
  maxZ: number
  size: number
}

/** 도로에서 먼 곳의 기본 지형. scale: 맵의 기복 배율, dunes: 바람 방향으로 길게 늘어선 모래 언덕 */
function hills(x: number, z: number, scale: number, dunes: boolean) {
  const base =
    2.2 * Math.sin(x * 0.019 + 1.3) * Math.cos(z * 0.016 - 0.4) +
    1.1 * Math.sin((x + z) * 0.034) +
    0.6 * Math.cos((x - 2 * z) * 0.05) +
    1
  const ridge = dunes ? 2.5 * Math.pow(Math.abs(Math.sin(x * 0.011 + z * 0.006)), 1.6) : 0
  return base * scale + ridge
}

function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

function buildTerrain(): Terrain {
  // 범위: 코스를 감싸는 정사각형 + 여유 (격자 간격의 배수)
  const b = trackBounds
  const cx = (b.minX + b.maxX) / 2
  const cz = (b.minZ + b.maxZ) / 2
  const size = Math.ceil((Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + MARGIN * 2) / TERRAIN_ELEMENT) * TERRAIN_ELEMENT
  const n = size / TERRAIN_ELEMENT + 1
  const minX = cx - size / 2
  const maxZ = cz + size / 2
  const scale = currentMap.theme.hills
  const dunes = currentMap.theme.ground.style === 'sand'

  // 도로 샘플. band = 도로 높이 그대로인 거리, cover = 터널 둔덕 비율 (0~1), s = 길 위 거리
  const samples: { x: number; z: number; y: number; band: number; cover: number; s: number }[] = []
  const cover = (d: number) =>
    TUNNEL ? smoothstep(TUNNEL[0], TUNNEL[0] + 25, d) * (1 - smoothstep(TUNNEL[1] - 25, TUNNEL[1], d)) : 0
  // 터널 구간은 띠를 넓혀 터널 벽 바깥까지 평평하게 — 경사가 터널 벽을 뚫고 안으로 보이지 않게 (위는 산 메시가 덮는다)
  const inTunnel = (d: number) => TUNNEL !== null && d > TUNNEL[0] - 8 && d < TUNNEL[1] + 8
  centerPoints.forEach((p, i) => {
    const d = i * SAMPLE_SPACING
    samples.push({ x: p.x, z: p.z, y: p.y, band: ROAD_BAND + (inTunnel(d) ? TUNNEL_BAND : 0), cover: cover(d), s: d })
  })
  // 길을 따라 이만큼 떨어진 두 샘플이 겹치면 서로 다른 길(입체 교차) — 같은 길의 오르막 앞뒤는 아님
  const apart = (a: number, b: number) => Math.min(Math.abs(a - b), TRACK_LENGTH - Math.abs(a - b)) > 100

  // 가까운 도로 샘플을 빨리 찾기 위한 공간 해시 (10m 칸)
  const CELL = 10
  const buckets = new Map<string, number[]>()
  samples.forEach((p, idx) => {
    const key = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`
    const list = buckets.get(key)
    if (list) list.push(idx)
    else buckets.set(key, [idx])
  })
  const SEARCH = Math.ceil((ROAD_BAND + TUNNEL_BAND + BLEND) / CELL)

  const heights: number[][] = []
  const locked: boolean[][] = [] // 도로 구간은 블러에서 제외
  for (let i = 0; i < n; i++) {
    heights.push(new Array(n))
    locked.push(new Array(n))
    const x = minX + i * TERRAIN_ELEMENT
    for (let j = 0; j < n; j++) {
      const z = maxZ - j * TERRAIN_ELEMENT
      const gx = Math.floor(x / CELL)
      const gz = Math.floor(z / CELL)
      // 도로 띠에서 벗어난 거리(eff)가 가장 작은 샘플을 따른다
      let best = Infinity
      let roadH = 0
      let mound = 0
      let bestS = 0
      const overlap: { y: number; s: number }[] = []
      for (let a = -SEARCH; a <= SEARCH; a++) {
        for (let c = -SEARCH; c <= SEARCH; c++) {
          const list = buckets.get(`${gx + a},${gz + c}`)
          if (!list) continue
          for (const idx of list) {
            const p = samples[idx]
            const eff = Math.sqrt((p.x - x) ** 2 + (p.z - z) ** 2) - p.band
            if (eff < best) {
              best = eff
              roadH = p.y
              mound = p.cover
              bestS = p.s
            }
            if (eff < 0) overlap.push(p)
          }
        }
      }
      // 입체 교차: 두 길의 띠가 겹치면 아래 길 높이로 (위 길은 다리 상판이 받친다 — Bridge.tsx)
      for (const p of overlap) if (p.y < roadH - 2 && apart(p.s, bestS)) roadH = p.y
      const w = smoothstep(0, BLEND, best)
      heights[i][j] = roadH * (1 - w) + Math.max(hills(x, z, scale, dunes), roadH + TUNNEL_COVER * mound) * w
      locked[i][j] = best < 0
    }
  }

  // 서로 높이가 다른 두 구간 사이에서 생기는 단차를 부드럽게 (도로 구간은 고정)
  for (let pass = 0; pass < 6; pass++) {
    const prev = heights.map((row) => row.slice())
    for (let i = 1; i < n - 1; i++) {
      for (let j = 1; j < n - 1; j++) {
        if (locked[i][j]) continue
        heights[i][j] = (prev[i][j] * 4 + prev[i - 1][j] + prev[i + 1][j] + prev[i][j - 1] + prev[i][j + 1]) / 8
      }
    }
  }
  return { heights, n, minX, maxZ, size }
}

let cache: { version: number; terrain: Terrain } | null = null

/** 지금 맵의 지형 (맵이 바뀐 뒤 처음 부를 때 한 번 계산) */
export function getTerrain() {
  if (!cache || cache.version !== trackVersion) cache = { version: trackVersion, terrain: buildTerrain() }
  return cache.terrain
}

/** 격자 좌표 → 월드 좌표. i: +X 방향, j: -Z 방향 (Heightfield를 -90도 눕힌 좌표계와 일치) */
export const gridX = (i: number) => getTerrain().minX + i * TERRAIN_ELEMENT
export const gridZ = (j: number) => getTerrain().maxZ - j * TERRAIN_ELEMENT

/** 임의 위치의 지면 높이 (격자 쌍선형 보간). 나무 배치·공중 판정에 사용 */
export function terrainHeightAt(x: number, z: number) {
  const { heights: h, n, minX, maxZ } = getTerrain()
  const fi = (x - minX) / TERRAIN_ELEMENT
  const fj = (maxZ - z) / TERRAIN_ELEMENT
  const i = Math.min(n - 2, Math.max(0, Math.floor(fi)))
  const j = Math.min(n - 2, Math.max(0, Math.floor(fj)))
  const u = Math.min(1, Math.max(0, fi - i))
  const v = Math.min(1, Math.max(0, fj - j))
  return h[i][j] * (1 - u) * (1 - v) + h[i + 1][j] * u * (1 - v) + h[i][j + 1] * (1 - u) * v + h[i + 1][j + 1] * u * v
}

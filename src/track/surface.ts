import { BRANCH_WIDTH, CURB_OFFSET, branchDistance, centerPoints, frames, isIceAt } from './trackData'

/** road: 도로 · grass: 코스 밖(맵에 따라 잔디·모래·눈) · ice: 빙판 구간의 도로 */
export type Surface = 'road' | 'grass' | 'ice'

/** 도로로 치는 범위: 중심선에서 연석 바깥 끝까지 (연석 폭 0.8m) */
export const ROAD_EDGE = CURB_OFFSET + 0.4

const WINDOW = 40 // 직전 위치 주변 ±40샘플(약 ±28m)만 찾는다
const LOST = 30 // 이보다 멀면(리셋 등) 전체를 다시 찾는다 (m)

/**
 * (x, z)가 도로인지 잔디인지 판정하는 함수를 만든다.
 * 매 물리 스텝 바퀴 4개마다 불리므로, 직전에 찾은 중심선 샘플 주변만 훑어서 빠르게 찾는다.
 */
export function createSurfaceTracker() {
  let last = 0
  return (x: number, z: number): Surface => {
    // 맵을 바꾸면 샘플 수가 달라진다 — 옛 카트가 사라지기 전 마지막 스텝에서도 범위 안에서 찾게
    const n = centerPoints.length
    last %= n
    let best = Infinity
    let bestIndex = last
    for (let k = -WINDOW; k <= WINDOW; k++) {
      const i = (last + k + n) % n
      const p = centerPoints[i]
      const d = (p.x - x) ** 2 + (p.z - z) ** 2
      if (d < best) {
        best = d
        bestIndex = i
      }
    }
    if (best > LOST * LOST) {
      for (let i = 0; i < n; i++) {
        const p = centerPoints[i]
        const d = (p.x - x) ** 2 + (p.z - z) ** 2
        if (d < best) {
          best = d
          bestIndex = i
        }
      }
    }
    last = bestIndex
    // 본 코스 밖이어도 지름길 위면 도로
    if (Math.sqrt(best) > ROAD_EDGE) return branchDistance(x, z) <= BRANCH_WIDTH / 2 + 0.4 ? 'road' : 'grass'
    const p = centerPoints[bestIndex]
    const { left } = frames[bestIndex]
    return isIceAt(bestIndex, (x - p.x) * left.x + (z - p.z) * left.z) ? 'ice' : 'road'
  }
}

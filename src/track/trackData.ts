import { CatmullRomCurve3, Euler, Quaternion, Vector3 } from 'three'

/** 트랙 전체 크기 배율 — 제어점과 주행 거리(s) 기준 위치에 곱한다. 지형·나무 범위도 따라감 */
export const TRACK_SCALE = 2.1
export const ROAD_WIDTH = 24
export const CURB_OFFSET = ROAD_WIDTH / 2 + 0.4 // 연석 중심선 (도로 가장자리 바로 바깥)
export const WALL_OFFSET = ROAD_WIDTH / 2 + 3.5 // 방벽 위치 (연석 밖으로 잔디 여유 공간)

// 서킷 형태를 결정하는 제어점 (x, z). 순서대로 이어지는 닫힌 곡선이 된다. 전체 길이 약 3,030m (TRACK_SCALE 적용 후)
// 출발 직선 → 90도 코너 → 시케인 → 낙타등 직선 → 언덕 위 동쪽 헤어핀 → 내리막 브레이킹
// → 골짜기 연속 S자 → 오르막 → 북서쪽 헤어핀 → 점프대 직선 → 복합 코너 → 결승선
const CONTROL_POINTS: [number, number][] = [
  [0, -140],
  [80, -142],
  [130, -132],
  [160, -108],
  [170, -75], // 1번 코너
  [158, -42], // 시케인
  [168, -8],
  [174, 30],
  [178, 70],
  [186, 108], // 동쪽 헤어핀 (언덕 정상)
  [170, 140],
  [140, 144],
  [122, 120],
  [116, 85],
  [108, 50],
  [86, 26],
  [54, 24],
  [22, 40], // 연속 S자
  [-12, 24],
  [-46, 40],
  [-82, 30],
  [-110, 58],
  [-118, 105],
  [-114, 156],
  [-128, 184], // 북서쪽 헤어핀
  [-156, 194],
  [-176, 168],
  [-176, 120],
  [-178, 40], // 점프대 직선
  [-168, -40],
  [-140, -100],
  [-90, -135],
  [-40, -142],
]
// 제어점을 바꿀 때 지킬 것
// - 최소 회전반경이 WALL_OFFSET보다 충분히 클 것 (배율 적용 후 약 27m, S자·헤어핀) — 작으면 안쪽 방벽이 꼬임
// - 서로 다른 구간끼리 2 * WALL_OFFSET + 여유 이상 떨어질 것 (배율 적용 후 최소 약 122m)
// - 지형 범위(terrain.ts) 안쪽에 BLEND 이상 여유를 둘 것

export const centerCurve = new CatmullRomCurve3(
  CONTROL_POINTS.map(([x, z]) => new Vector3(x * TRACK_SCALE, 0, z * TRACK_SCALE)),
  true, // closed
  'centripetal',
)

export const TRACK_LENGTH = centerCurve.getLength()
const SAMPLES = Math.round(TRACK_LENGTH / 0.7) // 약 0.7m 간격
export const SAMPLE_SPACING = TRACK_LENGTH / SAMPLES

// ---------------------------------------------------------------------------
// 높낮이: 출발선으로부터의 주행 거리 s(m)에 대한 함수
// ---------------------------------------------------------------------------

/** 기본 언덕 프로필 [s(m), 높이(m)] — 키 사이를 코사인 보간 */
const PROFILE_KEYS = (
  [
  [0, 0],
  [80, 0],
  [200, 5], // 1번 코너~시케인은 오르막
  [290, 6],
  [380, 6], // 낙타등 직선
  [440, 8], // 동쪽 헤어핀 (언덕 정상)
  [490, 8],
  [600, 1], // 내리막 브레이킹 → 왼쪽 코너
  [780, 1], // 골짜기 S자
  [900, 6],
  [1040, 4], // 북서쪽 헤어핀 → 고원 (점프대가 있는 직선)
  [1190, 4],
  [1300, 0],
  ] as [number, number][]
).map(([d, h]) => [d * TRACK_SCALE, h] as [number, number])

/**
 * 낙타등 언덕: 오르막 정상 부근 곡률 반경 약 51m → 약 80km/h 이상에서 정상에서 살짝 뜨고,
 * 내리막은 길고 완만해서(최대 경사 약 5도) 경사면에 부드럽게 착지한다
 */
export const CAMELBACK = { center: 330 * TRACK_SCALE, riseLength: 25, fallLength: 45, height: 2.5 }

/**
 * 테이블탑 점프대: 킥 램프 → 평평한 윗면 → 완만한 착지 경사.
 * 느리면 그냥 넘어가고, 빠르면 립에서 떠서 착지 경사에 내려앉는다.
 */
export const JUMP = {
  start: 1100 * TRACK_SCALE, // 킥 램프 시작 s
  kickLength: 16,
  /**
   * 킥 곡선 지수 — 클수록 립 직전이 가팔라진다. 립 각도 ≈ atan(height * kickPower / kickLength) ≈ 10도.
   * 너무 가파르게 휘면(곡률이 크면) 고속에서 이륙 직전 하중이 튀어 공중에서 돌아가고,
   * 각도가 크면 최고속도에서 너무 높이 떠 착지가 거칠어진다
   */
  kickPower: 1.3,
  topLength: 4,
  /** 착지 경사 길이 — 최고속도(100km/h)로 날아도 경사면 위에 내려앉도록 길게 */
  landingLength: 44,
  height: 2.2,
}
export const JUMP_LIP = JUMP.start + JUMP.kickLength

function wrapS(s: number) {
  return ((s % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH
}

function baseProfile(s: number) {
  const keys = PROFILE_KEYS
  for (let k = 0; k < keys.length; k++) {
    const [s0, h0] = keys[k]
    const [s1, h1] = k + 1 < keys.length ? keys[k + 1] : [TRACK_LENGTH, keys[0][1]]
    if (s >= s0 && s <= s1) {
      const t = (s - s0) / (s1 - s0)
      return h0 + (h1 - h0) * (1 - Math.cos(Math.PI * t)) * 0.5
    }
  }
  return keys[0][1]
}

function camelback(s: number) {
  const { center, riseLength, fallLength, height } = CAMELBACK
  const d = s - center
  const half = d < 0 ? riseLength : fallLength
  return Math.abs(d) < half ? height * (1 + Math.cos((Math.PI * d) / half)) * 0.5 : 0
}

function tabletop(s: number) {
  const { start, kickLength, kickPower, topLength, landingLength, height } = JUMP
  const t = s - start
  if (t < 0) return 0
  if (t < kickLength) return height * Math.pow(t / kickLength, kickPower) // 끝으로 갈수록 가팔라지는 킥
  if (t < kickLength + topLength) return height
  const u = (t - kickLength - topLength) / landingLength
  if (u < 1) return height * (1 + Math.cos(Math.PI * u)) * 0.5
  return 0
}

/** 주행 거리 s 위치의 도로 높이 */
export function roadHeightAt(s: number) {
  const w = wrapS(s)
  return baseProfile(w) + camelback(w) + tabletop(w)
}

// ---------------------------------------------------------------------------
// 중심선 샘플
// ---------------------------------------------------------------------------

/** 중심선을 일정 간격으로 샘플링한 점 (y = 도로 높이). 마지막 점 = 첫 점이 되지 않도록 SAMPLES개만 */
export const centerPoints = centerCurve
  .getSpacedPoints(SAMPLES)
  .slice(0, SAMPLES)
  .map((p, i) => p.setY(roadHeightAt(i * SAMPLE_SPACING)))

/** 각 샘플의 수평 진행 방향(접선)과 왼쪽 방향(법선) — 높낮이와 무관하게 XZ 평면 기준 */
export const frames = centerPoints.map((_, i) => {
  const next = centerPoints[(i + 1) % SAMPLES]
  const prev = centerPoints[(i - 1 + SAMPLES) % SAMPLES]
  const tangent = new Vector3(next.x - prev.x, 0, next.z - prev.z).normalize()
  // 진행 방향 기준 왼쪽 (+Y를 위로 두고 tangent를 반시계 90도 회전)
  const left = new Vector3(tangent.z, 0, -tangent.x)
  return { tangent, left }
})

/** 주행 거리 s에 해당하는 샘플 인덱스 */
export function indexAtS(s: number) {
  return Math.round(wrapS(s) / SAMPLE_SPACING) % SAMPLES
}

export type Segment = {
  position: Vector3
  yaw: number
  pitch: number
  length: number
  /** three/cannon 기본 회전 순서(XYZ)로 변환한 [x, y, z] — 박스를 진행 방향으로 눕히고 경사만큼 기울임 */
  rotation: [number, number, number]
}

const _q = new Quaternion()
const _qYaw = new Quaternion()
const _e = new Euler()
const _up = new Vector3(0, 1, 0)
const _right = new Vector3(1, 0, 0)

/** 중심선에서 offset만큼 떨어진 곡선 위의 점들을 같은 간격(spacing)으로 다시 샘플링 (높낮이 포함) */
export function offsetPoints(offset: number, spacing: number): Segment[] {
  const raw = centerPoints.map((p, i) => p.clone().addScaledVector(frames[i].left, offset))
  const lengths: number[] = [0]
  for (let i = 1; i <= raw.length; i++) {
    lengths.push(lengths[i - 1] + raw[i - 1].distanceTo(raw[i % raw.length]))
  }
  const total = lengths[lengths.length - 1]
  const count = Math.max(3, Math.round(total / spacing))
  const step = total / count

  const result: Segment[] = []
  let seg = 0
  for (let k = 0; k < count; k++) {
    const a = pointAt(k * step)
    const b = pointAt((k + 1) * step)
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dz = b.z - a.z
    const horizontal = Math.hypot(dx, dz)
    const yaw = Math.atan2(dx, dz)
    // +X축 기준 음의 회전이 박스 앞(+Z)을 들어 올린다
    const pitch = -Math.atan2(dy, horizontal)
    _qYaw.setFromAxisAngle(_up, yaw)
    _q.setFromAxisAngle(_right, pitch).premultiply(_qYaw)
    _e.setFromQuaternion(_q, 'XYZ')
    result.push({
      position: a.clone().add(b).multiplyScalar(0.5),
      yaw,
      pitch,
      length: Math.hypot(horizontal, dy),
      rotation: [_e.x, _e.y, _e.z],
    })
  }
  return result

  function pointAt(d: number) {
    d = d % total
    while (lengths[seg + 1] < d) seg = (seg + 1) % raw.length
    while (lengths[seg] > d) seg = 0
    const t = (d - lengths[seg]) / (lengths[seg + 1] - lengths[seg])
    return raw[seg].clone().lerp(raw[(seg + 1) % raw.length], t)
  }
}

/** (x, z)에 가장 가까운 중심선 샘플의 인덱스와 수평 거리 */
export function nearestSample(x: number, z: number) {
  let min = Infinity
  let index = 0
  for (let i = 0; i < centerPoints.length; i++) {
    const p = centerPoints[i]
    const d = (p.x - x) ** 2 + (p.z - z) ** 2
    if (d < min) {
      min = d
      index = i
    }
  }
  return { index, distance: Math.sqrt(min) }
}

/** 샘플 위치에 카트를 놓을 때의 위치·방향 (리셋용) */
export function poseAt(index: number) {
  const p = centerPoints[index]
  const { tangent } = frames[index]
  return {
    position: [p.x, p.y + 1, p.z] as [number, number, number],
    yaw: Math.atan2(tangent.x, tangent.z),
  }
}

/** 출발선 위치와 진행 방향 */
const startIndex = 0
export const startPose = {
  position: centerPoints[startIndex].clone(),
  yaw: Math.atan2(frames[startIndex].tangent.x, frames[startIndex].tangent.z),
  index: startIndex,
}

/** 출발 그리드 칸 수 (= 방 최대 인원, server/relay.js의 MAX_PER_ROOM과 같게) */
export const GRID_SLOTS = 8

/** 출발 그리드 k번 칸의 위치 (출발선 기준 로컬: side = 왼쪽(+)/오른쪽(-) m, back = 출발선 뒤로 m) — 좌우 엇갈리게 4m 간격 */
export const gridOffset = (k: number) => ({ side: (k % 2 ? -1 : 1) * 2.6, back: 4 + k * 4 })

/** 출발 그리드 k번 칸에 카트를 놓을 때의 위치·방향 (살짝 위에서 떨어뜨린다) */
export function gridPose(k: number) {
  const { side, back } = gridOffset(k)
  const p = startPose.position
  const { left, tangent } = frames[startIndex]
  return {
    position: [p.x + left.x * side - tangent.x * back, p.y + 1, p.z + left.z * side - tangent.z * back] as [number, number, number],
    yaw: startPose.yaw,
  }
}

/** 각 샘플의 부호 있는 곡률 방향 (+: 왼쪽으로 도는 코너, -: 오른쪽) 과 크기 */
export const curvature = frames.map((f, i) => {
  const next = frames[(i + 6) % frames.length].tangent
  const prev = frames[(i - 6 + frames.length) % frames.length].tangent
  // 접선이 왼쪽(left)으로 돌아가면 좌회전 코너
  return next.clone().sub(prev).dot(f.left)
})

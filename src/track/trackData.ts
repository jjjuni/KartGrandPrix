import { CatmullRomCurve3, Euler, Quaternion, Vector3 } from 'three'
import { MAPS, type MapDef, type MapId } from './maps'

/**
 * 지금 맵의 트랙 데이터. 맵을 바꿀 때 loadTrack()이 아래 값들을 모두 다시 계산한다.
 * 다른 파일은 이름으로 가져다 쓰면 된다 (ES 모듈의 export let은 바뀐 값이 그대로 보인다).
 * 트랙에서 파생되는 값을 따로 캐시하는 곳은 trackVersion이 바뀌었는지 보고 다시 계산한다.
 */
export let currentMap: MapDef = MAPS.forest
/** loadTrack을 부를 때마다 1씩 증가 */
export let trackVersion = 0

export const ROAD_WIDTH = 24
export const CURB_OFFSET = ROAD_WIDTH / 2 + 0.4 // 연석 중심선 (도로 가장자리 바로 바깥)
export const WALL_OFFSET = ROAD_WIDTH / 2 + 3.5 // 방벽 위치 (연석 밖으로 잔디 여유 공간)

export let TRACK_LENGTH = 0
let SAMPLES = 0
export let SAMPLE_SPACING = 0
/** 높이 프로필 [s(m), 높이(m)] — 키 사이를 코사인 보간 */
let profileKeys: [number, number][] = []

/**
 * 낙타등 언덕: 오르막 정상 부근 곡률 반경 약 51m → 약 80km/h 이상에서 정상에서 살짝 뜨고,
 * 내리막은 길고 완만해서(최대 경사 약 5도) 경사면에 부드럽게 착지한다. 없는 맵은 null
 */
export let CAMELBACK: { center: number; riseLength: number; fallLength: number; height: number } | null = null

/**
 * 테이블탑 점프대: 킥 램프 → 평평한 윗면 → 완만한 착지 경사.
 * 느리면 그냥 넘어가고, 빠르면 립에서 떠서 착지 경사에 내려앉는다.
 */
export const JUMP = {
  start: 0, // 킥 램프 시작 s (맵마다 loadTrack에서 정함)
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
export let JUMP_LIP = 0
/** 이 맵에 점프대가 있는지 */
export let HAS_JUMP = true

/** 울퉁불퉁한 구간 [시작 s, 끝 s] (m) 과 둔덕 높이 */
export let BUMP_RANGES: [number, number][] = []
let bumpHeight = 0

/** 빙판 구간 [시작 s, 끝 s] (m) — 이 구간의 도로는 미끄럽다 */
export let ICE_RANGES: [number, number, 1 | -1][] = []

/** 터널 구간 [시작 s, 끝 s] (m) — 없으면 null */
export let TUNNEL: [number, number] | null = null

/** 코스가 차지하는 범위 (중심선 기준, m) — 지형·장식 배치 범위를 정한다 */
export let trackBounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }

function wrapS(s: number) {
  return ((s % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH
}

function baseProfile(s: number) {
  const keys = profileKeys
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
  if (!CAMELBACK) return 0
  const { center, riseLength, fallLength, height } = CAMELBACK
  const d = s - center
  const half = d < 0 ? riseLength : fallLength
  return Math.abs(d) < half ? height * (1 + Math.cos((Math.PI * d) / half)) * 0.5 : 0
}

function tabletop(s: number) {
  if (!HAS_JUMP) return 0
  const { start, kickLength, kickPower, topLength, landingLength, height } = JUMP
  const t = s - start
  if (t < 0) return 0
  if (t < kickLength) return height * Math.pow(t / kickLength, kickPower) // 끝으로 갈수록 가팔라지는 킥
  if (t < kickLength + topLength) return height
  const u = (t - kickLength - topLength) / landingLength
  if (u < 1) return height * (1 + Math.cos(Math.PI * u)) * 0.5
  return 0
}

/**
 * 울퉁불퉁한 구간: 코스 밖 모래 언덕처럼 큰 둔덕이 높이를 바꿔 가며 이어진다 (빠르면 둔덕마다 살짝 뜬다).
 * 지형 격자(2m)가 따라 그릴 수 있게 파장은 10m 이상, 양 끝은 서서히 시작·끝
 */
const BUMP = { height: 0.9, wave: 26, wave2: 61, fade: 15 } // height는 맵에 bumpHeight가 있으면 그 값
function bumps(s: number) {
  for (const [a, b] of BUMP_RANGES) {
    if (s < a || s > b) continue
    const fade = Math.min(1, (s - a) / BUMP.fade, (b - s) / BUMP.fade)
    const wave = 0.5 - 0.5 * Math.cos((2 * Math.PI * (s - a)) / BUMP.wave)
    return bumpHeight * fade * wave * (0.6 + 0.4 * Math.sin((2 * Math.PI * (s - a)) / BUMP.wave2))
  }
  return 0
}

/** 주행 거리 s 위치의 도로 높이 */
export function roadHeightAt(s: number) {
  const w = wrapS(s)
  return baseProfile(w) + camelback(w) + tabletop(w) + bumps(w)
}

// ---------------------------------------------------------------------------
// 중심선 샘플
// ---------------------------------------------------------------------------

/** 중심선을 일정 간격으로 샘플링한 점 (y = 도로 높이). 마지막 점 = 첫 점이 되지 않도록 SAMPLES개만 */
export let centerPoints: Vector3[] = []

/** 각 샘플의 수평 진행 방향(접선)과 왼쪽 방향(법선) — 높낮이와 무관하게 XZ 평면 기준 */
export let frames: { tangent: Vector3; left: Vector3 }[] = []

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

/**
 * (x, z)에 가장 가까운 중심선 샘플의 인덱스와 수평 거리.
 * y를 주면 높이 차도 크게 쳐서, 입체 교차(위 · 아래 길이 겹치는 곳)에서 지금 달리는 쪽 길을 고른다
 */
export function nearestSample(x: number, z: number, y?: number) {
  let min = Infinity
  let index = 0
  for (let i = 0; i < centerPoints.length; i++) {
    const p = centerPoints[i]
    const d = (p.x - x) ** 2 + (p.z - z) ** 2 + (y === undefined ? 0 : 9 * (p.y - y) ** 2)
    if (d < min) {
      min = d
      index = i
    }
  }
  const p = centerPoints[index]
  return { index, distance: Math.hypot(p.x - x, p.z - z) }
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
export let startPose = { position: new Vector3(), yaw: 0, index: startIndex }

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
export let curvature: number[] = []

/** 샘플 index에서 중심선 왼쪽으로 lateral(m) 떨어진 도로가 빙판인지 */
export function isIceAt(index: number, lateral: number) {
  const d = index * SAMPLE_SPACING
  return ICE_RANGES.some(([a, b, side]) => d >= a && d <= b && lateral * side > 0)
}

// ---------------------------------------------------------------------------
// 맵 불러오기
// ---------------------------------------------------------------------------

/** 맵의 코스로 트랙 데이터를 모두 다시 계산한다 (같은 맵이면 아무것도 안 함) */
export function loadTrack(id: MapId) {
  const def = MAPS[id] ?? MAPS.forest
  if (def === currentMap && trackVersion > 0) return
  currentMap = def
  const k = def.scale
  const curve = new CatmullRomCurve3(
    def.controlPoints.map(([x, z]) => new Vector3(x * k, 0, z * k)),
    true, // closed
    'centripetal',
  )
  TRACK_LENGTH = curve.getLength()
  SAMPLES = Math.round(TRACK_LENGTH / 0.7) // 약 0.7m 간격
  SAMPLE_SPACING = TRACK_LENGTH / SAMPLES
  profileKeys = def.profile.map(([d, h]) => [d * k, h])
  CAMELBACK = def.camelback && { ...def.camelback, center: def.camelback.center * k }
  HAS_JUMP = def.jumpStart !== null
  JUMP.start = (def.jumpStart ?? 0) * k
  JUMP_LIP = JUMP.start + JUMP.kickLength
  BUMP_RANGES = def.bumps.map(([a, b]) => [a * k, b * k])
  bumpHeight = def.bumpHeight ?? BUMP.height
  ICE_RANGES = def.surface.ice.map(([a, b, side]) => [a * k, b * k, side])

  centerPoints = curve
    .getSpacedPoints(SAMPLES)
    .slice(0, SAMPLES)
    .map((p, i) => p.setY(roadHeightAt(i * SAMPLE_SPACING)))
  frames = centerPoints.map((_, i) => {
    const next = centerPoints[(i + 1) % SAMPLES]
    const prev = centerPoints[(i - 1 + SAMPLES) % SAMPLES]
    const tangent = new Vector3(next.x - prev.x, 0, next.z - prev.z).normalize()
    // 진행 방향 기준 왼쪽 (+Y를 위로 두고 tangent를 반시계 90도 회전)
    const left = new Vector3(tangent.z, 0, -tangent.x)
    return { tangent, left }
  })
  curvature = frames.map((f, i) => {
    const next = frames[(i + 6) % frames.length].tangent
    const prev = frames[(i - 6 + frames.length) % frames.length].tangent
    // 접선이 왼쪽(left)으로 돌아가면 좌회전 코너
    return next.clone().sub(prev).dot(f.left)
  })
  TUNNEL = def.tunnel ? [def.tunnel[0] * k, def.tunnel[1] * k] : null
  startPose = {
    position: centerPoints[startIndex].clone(),
    yaw: Math.atan2(frames[startIndex].tangent.x, frames[startIndex].tangent.z),
    index: startIndex,
  }
  const xs = centerPoints.map((p) => p.x)
  const zs = centerPoints.map((p) => p.z)
  trackBounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
  trackVersion++
}

loadTrack('lobby')

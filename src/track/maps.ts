/**
 * 맵 정의: 코스 모양(제어점) · 높낮이 · 점프대 · 노면 특성 · 테마(하늘·조명·땅·장식·날씨).
 * 거리 값(s)과 제어점은 '기본 단위'로 적고 scale을 곱해 쓴다 (trackData.ts의 loadTrack).
 *
 * 새 코스를 만들 때 지킬 것 (배율 적용 후)
 * - 최소 회전반경이 WALL_OFFSET(약 15.5m)보다 충분히 클 것 — 작으면 안쪽 방벽이 꼬인다
 * - 서로 다른 구간끼리 2 × WALL_OFFSET + 여유 이상 떨어질 것
 * - 점프대·낙타등 구간은 높이 프로필이 평평한 직선 위에 둘 것
 */

export type MapId = 'forest' | 'desert' | 'polar'

/** 흩어 놓는 장식 종류 (Trees.tsx) */
export type ScatterKind = 'pine' | 'broadleaf' | 'bush' | 'rock' | 'cactus' | 'redRock' | 'dryBush' | 'snowPine' | 'iceBlock' | 'snowRock' | 'penguin' | 'igloo'

export type MapDef = {
  id: MapId
  /** 대기실·방에 보이는 이름 */
  name: string
  scale: number
  controlPoints: [number, number][]
  /** 높이 프로필 [s, 높이(m)] — 키 사이를 코사인 보간 */
  profile: [number, number][]
  /** 낙타등 언덕 (없으면 null) — center는 기본 단위 s */
  camelback: { center: number; riseLength: number; fallLength: number; height: number } | null
  /** 점프대 킥 램프 시작 s (기본 단위) */
  jumpStart: number
  /** 노면: 코스 밖(잔디 · 모래 · 눈)의 접지력·저항, 도로 위 빙판 구간 [시작 s, 끝 s] (기본 단위) */
  surface: { offGrip: number; offDrag: number; offRolling: number; iceGrip: number; ice: [number, number, 1 | -1][] }
  theme: {
    sky: { sun: [number, number, number]; turbidity: number; rayleigh: number }
    /** 배경 · 안개 색, 안개가 시작·끝나는 거리 (m) */
    fog: { color: string; near: number; far: number }
    hemisphere: { sky: string; ground: string; intensity: number }
    sun: { color: string; intensity: number }
    /** 땅 질감 */
    ground: { style: 'grass' | 'sand' | 'snow'; a: string; b: string }
    /** 코스 밖 지형 기복 배율 (모래 언덕은 크게) */
    hills: number
    walls: [string, string]
    curbs: [string, string]
    scatter: { kind: ScatterKind; count: number }[]
    weather: 'none' | 'dust' | 'snow'
    /** 멀리 보이는 큰 지형지물 */
    landmark: 'none' | 'pyramids' | 'icebergs'
  }
}

export const MAPS: Record<MapId, MapDef> = {
  // ---- 숲 서킷: 지금까지의 코스 (시케인 · 언덕 위 헤어핀 · 골짜기 S자 · 점프대) ----
  forest: {
    id: 'forest',
    name: '숲',
    scale: 2.1,
    controlPoints: [
      [0, -140], [80, -142], [130, -132], [160, -108], [170, -75], [158, -42], [168, -8], [174, 30], [178, 70],
      [186, 108], [170, 140], [140, 144], [122, 120], [116, 85], [108, 50], [86, 26], [54, 24], [22, 40], [-12, 24],
      [-46, 40], [-82, 30], [-110, 58], [-118, 105], [-114, 156], [-128, 184], [-156, 194], [-176, 168], [-176, 120],
      [-178, 40], [-168, -40], [-140, -100], [-90, -135], [-40, -142],
    ],
    profile: [
      [0, 0], [80, 0], [200, 5], [290, 6], [380, 6], [440, 8], [490, 8], [600, 1], [780, 1], [900, 6], [1040, 4],
      [1190, 4], [1300, 0],
    ],
    camelback: { center: 330, riseLength: 25, fallLength: 45, height: 2.5 },
    jumpStart: 1100,
    surface: { offGrip: 0.7, offDrag: 95, offRolling: 0.06, iceGrip: 1, ice: [] },
    theme: {
      sky: { sun: [100, 40, 100], turbidity: 6, rayleigh: 1.5 },
      fog: { color: '#bcd6ec', near: 120, far: 450 },
      hemisphere: { sky: '#dfefff', ground: '#4a6b3a', intensity: 0.6 },
      sun: { color: '#ffffff', intensity: 1.6 },
      ground: { style: 'grass', a: '#5b9a4a', b: '#4f8c40' },
      hills: 1,
      walls: ['#c62828', '#eeeeee'],
      curbs: ['#d32f2f', '#f4f4f4'],
      scatter: [
        { kind: 'pine', count: 260 },
        { kind: 'broadleaf', count: 150 },
        { kind: 'bush', count: 220 },
        { kind: 'rock', count: 90 },
      ],
      weather: 'none',
      landmark: 'none',
    },
  },

  // ---- 사막 캐년: 긴 직선과 큰 곡선의 고속 코스 · 모래 언덕을 넘는 오르내림 · 코스 밖 모래는 크게 느려짐 ----
  desert: {
    id: 'desert',
    name: '사막',
    scale: 2.1,
    controlPoints: [
      [0, -140], [100, -140], [170, -120], [205, -70], [200, 0], [170, 50], [185, 110], [150, 165], [80, 180],
      [20, 150], [-20, 100], [-75, 90], [-125, 125], [-175, 100], [-190, 40], [-175, -40], [-135, -110], [-70, -138],
    ],
    profile: [
      [0, 0], [100, 0], [180, 6], [240, 10], [310, 4], [380, 4], [440, 11], [500, 13], [570, 6], [640, 2], [700, 2],
      [770, 8], [830, 8], [900, 2], [950, 0], [1110, 0],
    ],
    camelback: { center: 1180, riseLength: 25, fallLength: 45, height: 3 },
    jumpStart: 960,
    surface: { offGrip: 0.55, offDrag: 160, offRolling: 0.09, iceGrip: 1, ice: [] },
    theme: {
      sky: { sun: [120, 22, -60], turbidity: 10, rayleigh: 2.2 },
      fog: { color: '#e3c49a', near: 70, far: 330 },
      hemisphere: { sky: '#ffe6c2', ground: '#b5824a', intensity: 0.75 },
      sun: { color: '#ffd9a0', intensity: 1.9 },
      ground: { style: 'sand', a: '#d9b071', b: '#c99d5f' },
      hills: 2.6,
      walls: ['#e65100', '#f3e3c3'],
      curbs: ['#e65100', '#fff3dc'],
      scatter: [
        { kind: 'cactus', count: 160 },
        { kind: 'redRock', count: 120 },
        { kind: 'dryBush', count: 220 },
      ],
      weather: 'dust',
      landmark: 'pyramids',
    },
  },

  // ---- 극지 아이스링크: 헤어핀이 많은 기술 코스 · 코너마다 빙판(미끄러움) · 코스 밖은 눈 ----
  polar: {
    id: 'polar',
    name: '극지',
    scale: 2.1,
    controlPoints: [
      [0, -140], [70, -142], [112, -122], [118, -82], [88, -55], [62, -18], [84, 16], [132, 20], [172, 52], [176, 102],
      [140, 138], [90, 132], [60, 100], [18, 112], [-12, 152], [-62, 168], [-112, 142], [-122, 90], [-92, 58],
      [-112, 18], [-162, 0], [-178, -52], [-150, -102], [-90, -132], [-40, -142],
    ],
    profile: [
      [0, 0], [120, 0], [200, 3], [300, 3], [400, 5], [500, 5], [600, 2], [700, 2], [800, 4], [900, 4], [1000, 1],
      [1100, 0],
    ],
    camelback: null,
    jumpStart: 1190,
    surface: {
      offGrip: 0.5,
      offDrag: 110,
      offRolling: 0.07,
      iceGrip: 0.3,
      // 빙판 [시작, 끝, 쪽(1 왼쪽 · -1 오른쪽)] — 도로 절반만 덮어 반대쪽으로 피할 수 있다
      ice: [[140, 200, 1], [560, 615, -1], [870, 915, 1], [995, 1045, -1]],
    },
    theme: {
      sky: { sun: [-150, 12, 80], turbidity: 3, rayleigh: 3 },
      fog: { color: '#c9dcf0', near: 90, far: 380 },
      hemisphere: { sky: '#e8f4ff', ground: '#9fb6cc', intensity: 0.85 },
      sun: { color: '#ffe8d0', intensity: 1.3 },
      ground: { style: 'snow', a: '#f4f8fc', b: '#e6eef7' },
      hills: 1.4,
      walls: ['#1565c0', '#f5f9ff'],
      curbs: ['#1e88e5', '#ffffff'],
      scatter: [
        { kind: 'snowPine', count: 260 },
        { kind: 'iceBlock', count: 90 },
        { kind: 'snowRock', count: 90 },
        { kind: 'penguin', count: 60 },
        { kind: 'igloo', count: 8 },
      ],
      weather: 'snow',
      landmark: 'icebergs',
    },
  },
}

export const MAP_IDS = Object.keys(MAPS) as MapId[]

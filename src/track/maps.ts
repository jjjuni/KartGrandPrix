/**
 * 맵 정의: 코스 모양(제어점) · 높낮이 · 점프대 · 노면 특성 · 테마(하늘·조명·땅·장식·날씨).
 * 거리 값(s)과 제어점은 '기본 단위'로 적고 scale을 곱해 쓴다 (trackData.ts의 loadTrack).
 *
 * 새 코스를 만들 때 지킬 것 (배율 적용 후)
 * - 최소 회전반경이 WALL_OFFSET(약 15.5m)보다 충분히 클 것 — 작으면 안쪽 방벽이 꼬인다
 * - 서로 다른 구간끼리 2 × WALL_OFFSET + 여유 이상 떨어질 것
 * - 점프대·낙타등 구간은 높이 프로필이 평평한 직선 위에 둘 것
 */

export type MapId = 'lobby' | 'forest' | 'desert' | 'polar' | 'mountain' | 'rally' | 'mine'

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
  /** 점프대 킥 램프 시작 s (기본 단위) — 없으면 null */
  jumpStart: number | null
  /** 울퉁불퉁한 구간 [시작 s, 끝 s] (기본 단위) — 도로가 연달아 오르내린다 */
  bumps: [number, number][]
  /** 둔덕 높이 (m) — 없으면 기본 0.9 */
  bumpHeight?: number
  /** 노면: 코스 밖(잔디 · 모래 · 눈)의 접지력·저항, 도로 위 빙판 구간 [시작 s, 끝 s] (기본 단위) */
  surface: {
    offGrip: number
    offDrag: number
    offRolling: number
    iceGrip: number
    ice: [number, number, 1 | -1][]
  }
  /**
   * 지름길: 본 코스 s=from에서 갈라져 via(기본 단위 좌표)를 지나 s=to에서 다시 합류하는 좁은 길 (폭 width m).
   * profile: [갈라진 곳부터의 거리 m, 높이 m] — 없으면 두 갈림 지점 높이를 곧게 잇는다 (양 끝은 늘 본 코스 높이).
   * from < to, 출발선을 사이에 두지 않을 것 (바퀴 세기)
   */
  shortcut?: { from: number; to: number; via: [number, number][]; width: number; profile?: [number, number][] }
  /**
   * 동굴 맵: 코스 전체를 바위 굴이 덮는다 (하늘 없음).
   * size: [s(기본 단위), 굴 반폭(m), 천장 높이(m)] — 사이는 부드럽게 이어진다.
   * dome: 큰 동굴 하나 (중심 at · 반지름 radius는 기본 단위, floor · top은 절대 높이 m) — 안쪽 바닥은 floor까지 꺼진 낭떠러지
   */
  cave?: {
    size: [number, number, number][]
    dome?: { at: [number, number]; radius: number; floor: number; top: number }
  }
  /** 터널 구간 [시작 s, 끝 s] (기본 단위) — 위로 다른 길이 지나가는 입체 교차로 */
  tunnel?: [number, number]
  theme: {
    sky: { sun: [number, number, number]; turbidity: number; rayleigh: number }
    /** 배경 · 안개 색, 안개가 시작·끝나는 거리 (m) */
    fog: { color: string; near: number; far: number }
    hemisphere: { sky: string; ground: string; intensity: number }
    sun: { color: string; intensity: number }
    /** 땅 질감 */
    ground: { style: 'grass' | 'sand' | 'snow' | 'rock'; a: string; b: string }
    /** 도로 포장 (기본 아스팔트). 비포장(dirt)은 흙길 질감에 연석 없음 */
    road?: 'dirt'
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
  // ---- 대기실: 둥근 타원 연습 코스 (방에서는 고를 수 없음) ----
  lobby: {
    id: 'lobby',
    name: '연습장',
    scale: 1,
    controlPoints: [
      [0, -70], [100, -70], [149.5, -49.5], [170, 0], [149.5, 49.5], [100, 70], [0, 70], [-100, 70], [-149.5, 49.5],
      [-170, 0], [-149.5, -49.5], [-100, -70],
    ],
    profile: [[0, 0]],
    camelback: null,
    jumpStart: 370, // 위쪽 직선
    bumps: [],
    surface: { offGrip: 0.7, offDrag: 95, offRolling: 0.06, iceGrip: 1, ice: [] },
    theme: {
      sky: { sun: [100, 40, 100], turbidity: 6, rayleigh: 1.5 },
      fog: { color: '#bcd6ec', near: 120, far: 450 },
      hemisphere: { sky: '#dfefff', ground: '#4a6b3a', intensity: 0.6 },
      sun: { color: '#ffffff', intensity: 1.6 },
      ground: { style: 'grass', a: '#5b9a4a', b: '#4f8c40' },
      hills: 0.6,
      walls: ['#c62828', '#eeeeee'],
      curbs: ['#d32f2f', '#f4f4f4'],
      scatter: [
        { kind: 'pine', count: 120 },
        { kind: 'broadleaf', count: 80 },
        { kind: 'bush', count: 100 },
      ],
      weather: 'none',
      landmark: 'none',
    },
  },

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
    bumps: [],
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
    // 울퉁불퉁한 모래 노면: 첫 오르막 전 · 언덕 사이 · 남쪽 골짜기 · 점프대 뒤
    bumps: [[110, 170], [390, 440], [640, 700], [1060, 1120]],
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
    bumps: [],
    surface: {
      offGrip: 0.5,
      offDrag: 110,
      offRolling: 0.07,
      iceGrip: 0.3,
      // 빙판 [시작, 끝, 쪽(1 왼쪽 · -1 오른쪽)] — 도로 절반만 덮어 반대쪽으로 피할 수 있다
      ice: [[140, 200, 1], [560, 615, -1], [870, 915, 1], [995, 1045, -1]],
    },
    theme: {
      // 지평선에 걸린 낮은 해: 눈 위로 주황빛, 그늘은 푸르게
      sky: { sun: [-150, 7, 80], turbidity: 2, rayleigh: 3.5 },
      fog: { color: '#b9cde6', near: 90, far: 380 },
      hemisphere: { sky: '#c9ddff', ground: '#8aa2c2', intensity: 0.75 },
      sun: { color: '#ffc896', intensity: 1.6 },
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

  // ---- 산악 고개: 가장 길고 어려운 코스 · 헤어핀 지그재그로 산을 오르고 · 정상 시케인 · 급경사로 내리꽂는 내리막 ----
  mountain: {
    id: 'mountain',
    name: '산악',
    scale: 2.1,
    controlPoints: [
      [0, -200], [90, -200], [160, -195], [215, -175], [248, -145],
      [262, -115], [250, -88], [222, -80], [160, -85], [110, -78],
      [80, -65], [78, -38], [100, -25], [160, -30], [205, -22],
      [235, -5], [232, 25], [205, 35], [160, 30], [130, 48], [100, 30], [70, 45], [40, 35],
      [10, 50], [0, 85], [20, 115], [80, 120], [140, 115],
      [175, 130], [175, 160], [145, 175], [80, 180], [20, 180], [-40, 178],
      [-90, 165], [-130, 140], [-160, 100], [-175, 40], [-160, -10],
      [-110, -20], [-60, -5], [-30, -30], [-55, -60], [-110, -70],
      [-140, -100], [-135, -150], [-100, -190], [-40, -200],
    ],
    // 헤어핀 셋을 지그재그로 오르는 오르막 → 정상 시케인 → 북쪽 능선(점프대 · 낙타등) → 서쪽 급경사 내리막 → 골짜기
    // 가파른 오르막 셋(헤어핀 사이마다 최대 약 20%) → 정상 72m → 서쪽 급경사 내리막(최대 약 30%)으로 확 떨어짐
    profile: [
      [0, 0], [140, 0], [240, 22], [320, 25], [420, 45], [500, 48], [600, 66], [680, 70], [740, 72], [960, 72],
      [1010, 58], [1060, 52], [1130, 52], [1220, 60], [1300, 64], [1480, 64], [1550, 66], [1680, 16], [1780, 0],
      [1880, -4], [1990, -2], [2080, 0],
    ],
    camelback: { center: 1390, riseLength: 25, fallLength: 45, height: 3 },
    jumpStart: 1080,
    bumps: [],
    surface: { offGrip: 0.6, offDrag: 120, offRolling: 0.07, iceGrip: 1, ice: [] },
    theme: {
      // 맑은 고산의 아침: 높고 강한 햇빛, 짙푸른 하늘, 정상에서 멀리까지 보이게
      sky: { sun: [-120, 55, 140], turbidity: 1.8, rayleigh: 2.6 },
      fog: { color: '#8fb0d6', near: 150, far: 560 },
      hemisphere: { sky: '#b9d4ff', ground: '#3a5030', intensity: 0.6 },
      sun: { color: '#fff0d4', intensity: 2.0 },
      ground: { style: 'grass', a: '#6d8c4a', b: '#617f40' },
      hills: 2.2,
      walls: ['#f9a825', '#263238'],
      curbs: ['#f9a825', '#fafafa'],
      scatter: [
        { kind: 'pine', count: 320 },
        { kind: 'rock', count: 170 },
        { kind: 'bush', count: 140 },
        { kind: 'broadleaf', count: 50 },
      ],
      weather: 'none',
      landmark: 'none',
    },
  },

  // ---- 랠리: 8자 비포장 코스 · 산 밑 터널과 그 산꼭대기를 다시 지나는 입체 교차 · 낮게 울퉁불퉁한 흙길 ----
  rally: {
    id: 'rally',
    name: '랠리',
    scale: 2.1,
    controlPoints: [
      [150, -95], [100, -95], [50, -50], [0, 0], [-50, 50], [-90, 85], [-130, 100], [-175, 92], [-215, 55],
      [-235, 10], [-210, -30], [-228, -70], [-185, -100], [-140, -92], [-100, -105], [-50, -50], [0, 0], [50, 50],
      [95, 88], [135, 112], [180, 95], [205, 55], [238, 22], [222, -15], [242, -55], [215, -95], [185, -110],
    ],
    // 아래 길(s≈189, 산 밑 터널) 0m → 서쪽 고리에서 올라 → 위 길(s≈889, 터널 위 산꼭대기) 32m → 동쪽 고리에서 내려옴
    profile: [[0, 0], [240, 0], [330, 2], [500, 4], [700, 5], [800, 26], [850, 32], [925, 32], [990, 18], [1080, 7], [1180, 5], [1300, 3]],
    camelback: null,
    jumpStart: null,
    // 랠리 요철 구간 (출발 뒤 · 서쪽 고리 둘 · 동쪽 고리 셋)
    bumps: [[50, 120], [400, 460], [540, 610], [1050, 1110], [1150, 1210], [1330, 1390]],
    bumpHeight: 0.35,
    surface: { offGrip: 0.6, offDrag: 110, offRolling: 0.07, iceGrip: 1, ice: [] },
    tunnel: [150, 230],
    theme: {
      // 먼지 낀 늦은 오후: 낮은 호박색 해, 황토빛 안개
      sky: { sun: [140, 15, -90], turbidity: 9, rayleigh: 1.8 },
      fog: { color: '#d6b98f', near: 90, far: 380 },
      hemisphere: { sky: '#ffdcae', ground: '#5a4630', intensity: 0.65 },
      sun: { color: '#ffc27a', intensity: 2.0 },
      ground: { style: 'grass', a: '#7d8a4c', b: '#717d44' },
      road: 'dirt',
      hills: 1.6,
      walls: ['#8d6e63', '#e0d3bd'],
      curbs: ['#8d6e63', '#e0d3bd'],
      scatter: [
        { kind: 'pine', count: 220 },
        { kind: 'broadleaf', count: 90 },
        { kind: 'rock', count: 160 },
        { kind: 'dryBush', count: 200 },
      ],
      weather: 'dust',
      landmark: 'none',
    },
  },

  // ---- 광산: 하늘이 없는 동굴 코스 · 좁은 굴과 넓은 동굴이 번갈아 · 큰 동굴의 낭떠러지를 뛰어넘는 지름길 ----
  mine: {
    id: 'mine',
    name: '광산',
    scale: 2,
    controlPoints: [
      [0, -160], [90, -160], [140, -150], [170, -120], [155, -90], [170, -60], [170, -30], [195, 0], [220, 10],
      [265, 25], [290, 65], [280, 110], [245, 135], [210, 135], [175, 120], [150, 95], [110, 120], [60, 110],
      [20, 150], [-40, 150], [-90, 110], [-80, 60], [-130, 20], [-150, -40], [-120, -90], [-150, -140],
      [-100, -175], [-40, -168],
    ],
    // 굴을 오르내리다 → 입구(s≈283)에서 큰 동굴 바닥(s≈350)까지 24m를 내리꽂고 → 낭떠러지를 돌아 다시 올라온다
    profile: [
      [0, 0], [60, 0], [120, 4], [170, -2], [220, 5], [283, 8], [345, -16], [365, -16], [446, -6], [520, -2], [572, 0],
      [600, 0], [646, 4], [700, 12], [780, 2], [860, 9], [940, -2], [1020, 6], [1100, 0], [1180, 7], [1260, 0], [1320, 3],
    ],
    camelback: null,
    jumpStart: null,
    bumps: [],
    surface: { offGrip: 0.6, offDrag: 120, offRolling: 0.07, iceGrip: 1, ice: [] },
    // 지름길: 큰 동굴 바닥에서 둔덕을 타고 날아올라 낭떠러지를 건너 맞은편 선반에 내린다 (빨라야 닿는다)
    shortcut: {
      from: 352,
      to: 600,
      // 선반에 내린 뒤 왼쪽으로 크게 돌아 본 코스와 나란히 합류
      via: [[240, 35], [236, 65], [226, 100], [219, 117], [203, 125]],
      width: 13,
      // 둔덕 꼭대기(88m)에서 날아 32m 낭떠러지를 건너 선반(120m)에 내린다 — 130km/h 이상이어야 닿는다.
      // 착지 뒤 140m부터 250m까지 완만히 올라 본 코스 높이에 미리 맞춘다 (나란히 붙는 곳에서 높이 차가 없게)
      profile: [[23, -16], [88, -8], [94, -45], [114, -45], [120, -14], [140, -14], [250, -1]],
    },
    cave: {
      size: [
        [0, 45, 22], [70, 40, 20], [110, 17, 10], [200, 18, 11], [240, 24, 14], [283, 20, 13], [646, 20, 13], [700, 17, 10],
        [760, 38, 24], [850, 17, 10], [920, 30, 18], [1000, 17, 10], [1080, 42, 26], [1170, 18, 11], [1260, 26, 15],
        [1340, 40, 20],
      ],
      dome: { at: [225, 70], radius: 110, floor: -45, top: 40 },
    },
    theme: {
      sky: { sun: [60, 80, 40], turbidity: 2, rayleigh: 1 },
      fog: { color: '#1b1510', near: 40, far: 260 },
      hemisphere: { sky: '#ffb070', ground: '#2a1d12', intensity: 0.75 },
      sun: { color: '#ffb36b', intensity: 0.7 },
      ground: { style: 'rock', a: '#4a4038', b: '#40372f' },
      road: 'dirt',
      hills: 0,
      walls: ['#c98a2b', '#3a3028'],
      curbs: ['#c98a2b', '#3a3028'],
      scatter: [
        { kind: 'rock', count: 160 },
        { kind: 'redRock', count: 60 },
      ],
      weather: 'none',
      landmark: 'none',
    },
  },
}

/** 방에서 고를 수 있는 맵 (대기실 연습장은 빼고) */
export const MAP_IDS = (Object.keys(MAPS) as MapId[]).filter((id) => id !== 'lobby')

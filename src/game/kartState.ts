import { Quaternion, Vector3 } from 'three'
import type { BoostKind, Gear } from '../physics/vehicle'

/**
 * 카트의 실시간 상태. 물리 루프(useFrame)가 매 프레임 쓰고,
 * HUD·조명 같은 다른 컴포넌트가 읽는다. React state가 아니므로 리렌더링이 없다.
 */
export const kartState = {
  position: new Vector3(),
  /** 차체 회전 (온라인 전송용) */
  quaternion: new Quaternion(),
  /** 차체가 바라보는 방향 (Y축 회전, rad) */
  heading: 0,
  /** km/h, 진행 방향 기준 (+전진 / -후진) */
  speedKmh: 0,
  /** 부스터 게이지 0 ~ 1 */
  gauge: 0,
  drifting: false,
  /** 드리프트 탈출 후 순간 부스터 입력을 받는 남은 시간 (s) */
  boostWindow: 0,
  /** 남은 부스터 시간 (s) */
  boostTime: 0,
  /** 지금 쓰는 부스터 종류: Z 부스터(full) / 순간 부스터(instant) */
  boostKind: 'none' as BoostKind,
  /** Z 부스터 지속 시간 (게이지 표시용) */
  boostDuration: 1,
  gear: 'P' as Gear,
  /** 잔디 위 바퀴가 2개 이상 */
  offRoad: false,
  airborne: false,
}

export type KartState = typeof kartState

if (import.meta.env.DEV) {
  // 개발 중 콘솔에서 상태 확인용: window.__kart
  ;(window as unknown as { __kart: KartState }).__kart = kartState
}

import { setSurfaceTuning } from '../physics/vehicle'
import { MAPS, type MapId } from './maps'
import { loadTrack } from './trackData'

/**
 * 맵 불러오기: 트랙 데이터(코스·높낮이·빙판)를 다시 계산하고 노면 특성을 물리에 적용한다.
 * 지형·장식처럼 트랙에서 파생되는 값은 각자 trackVersion이 바뀐 걸 보고 다음에 쓸 때 다시 만든다.
 * 3D 장면은 App이 맵 id를 key로 다시 만든다.
 */
export function loadMap(id: MapId) {
  loadTrack(id)
  setSurfaceTuning((MAPS[id] ?? MAPS.forest).surface)
}

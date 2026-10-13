import { MAPS, type MapId } from '../track/maps'

/** 첫 진입 · 방 나가기 · 방 입장 · 맵 변경 */
type Reason = 'init' | 'leave' | 'enter' | 'map'

/** 맵을 만드는 동안 화면 전체를 덮는다 (뒤 장면이 살짝 비친다) */
export default function LoadingScreen({ map, reason, roomName }: { map: MapId; reason: Reason; roomName?: string }) {
  const [title, text] = {
    init: ['레이스 준비', '게임 불러오는 중'],
    leave: ['대기실', '대기실로 나가는 중'],
    enter: [roomName ?? '', '방에 들어가는 중'],
    map: [MAPS[map].name, '코스 불러오는 중'],
  }[reason]
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <p className="loading-map">{title}</p>
      <div className="loading-bar" aria-hidden="true" />
      <p className="loading-text">{text}</p>
    </div>
  )
}

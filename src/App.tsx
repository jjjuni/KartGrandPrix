import { Canvas, useFrame } from '@react-three/fiber'
import { Sky } from '@react-three/drei'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import ContactMaterials from './components/ContactMaterials'
import Ground from './components/Ground'
import Hud from './components/Hud'
import Kart from './components/Kart'
import KeyGuide from './components/KeyGuide'
import Minimap from './components/Minimap'
import RemoteKarts from './components/RemoteKarts'
import SunLight from './components/SunLight'
import { PhysicsWorld } from './physics/PhysicsWorld'
import MapAtmosphere from './track/MapAtmosphere'
import Track from './track/Track'
import { loadMap } from './track/loadMap'
import { MAPS, type MapId } from './track/maps'
import { gridPose } from './track/trackData'
import Countdown from './ui/Countdown'
import EntryScreen from './ui/EntryScreen'
import LoadingScreen from './ui/LoadingScreen'
import LobbyScreen from './ui/LobbyScreen'
import ResultsBoard from './ui/ResultsBoard'
import RoomPanel from './ui/RoomPanel'
import VehiclePicker from './ui/VehiclePicker'
import { useOnline } from './ui/hooks'

/** 새 장면이 몇 프레임 그려진 뒤(셰이더 컴파일까지) 알린다 */
function SceneReady({ onReady }: { onReady: () => void }) {
  const frames = useRef(0)
  useFrame(() => {
    if (++frames.current === 3) onReady()
  })
  return null
}

export default function App() {
  const o = useOnline()
  // 방의 맵 (대기실은 둥근 연습장). 맵이 바뀌면 트랙을 다시 계산하고, 아래 3D 장면을 key로 새로 만든다
  const wanted: MapId = o.room?.map ?? 'lobby'
  const [mapId, setMapId] = useState<MapId | null>(null)
  // 마지막으로 다 그려진 장면의 맵과 그때 있던 방 (로딩 문구를 상황에 맞게 고르는 데 쓴다)
  const [ready, setReady] = useState<{ map: MapId; room: string | null } | null>(null)
  // 같은 맵으로 방을 오가면 로딩 없이 넘어가므로, 지금 방을 여기서 따라가 둔다 (안 그러면 첫 맵 변경이 '방 입장'으로 보임)
  const roomId = o.room?.id ?? null
  useEffect(() => {
    if (ready && ready.map === wanted && ready.room !== roomId) setReady({ map: wanted, room: roomId })
  }, [ready, wanted, roomId])
  // 맵 계산(1~2초)은 메인 스레드를 막으므로, 로딩 화면이 먼저 그려진 다음 프레임에 시작한다
  useEffect(() => {
    if (wanted === mapId) return
    // rAF가 아니라 타이머: 창이 가려져 rAF가 멈춰도 맵은 계산된다
    const timer = setTimeout(() => setMapId(wanted), 100)
    return () => clearTimeout(timer)
  }, [wanted, mapId])
  useMemo(() => mapId && loadMap(mapId), [mapId])
  const theme = MAPS[mapId ?? wanted].theme
  // 방에서는 내 출발 그리드 칸, 대기실에서는 첫 칸에 세운다
  const { position: start, yaw } = gridPose(o.room ? o.slot : 0)
  // 닉네임 → 대기실 → 방. 앞의 두 화면에서는 출발선에 세운 카트와 트랙이 배경이 된다
  const screen = !o.name ? 'entry' : !o.room ? 'lobby' : 'room'

  return (
    <>
      <Canvas shadows camera={{ position: [start[0], start[1] + 4, start[2] - 10], fov: 60, far: 900 }}>
        <color attach="background" args={[theme.fog.color]} />
        <fog attach="fog" args={[theme.fog.color, theme.fog.near, theme.fog.far]} />
        <Sky sunPosition={theme.sky.sun} turbidity={theme.sky.turbidity} rayleigh={theme.sky.rayleigh} />
        <hemisphereLight args={[theme.hemisphere.sky, theme.hemisphere.ground, theme.hemisphere.intensity]} />
        <SunLight direction={theme.sky.sun} color={theme.sun.color} intensity={theme.sun.intensity} />
        <Suspense fallback={null}>
          {/* cannon-es를 메인 스레드에서 직접 돌린다 — 타이어 힘을 매 물리 스텝마다 계산하기 위해 */}
          {mapId && (
            <PhysicsWorld key={mapId}>
              <SceneReady onReady={() => setReady({ map: mapId, room: o.room?.id ?? null })} />
              <ContactMaterials />
              <Ground />
              <Track />
              <Kart position={start} yaw={yaw} />
              <RemoteKarts />
              <MapAtmosphere />
            </PhysicsWorld>
          )}
        </Suspense>
      </Canvas>

      {/* 첫 로딩 중에는 닉네임 · 대기실 창을 숨긴다 */}
      {ready && screen === 'entry' && <EntryScreen />}
      {ready && screen === 'lobby' && <LobbyScreen />}
      {screen === 'room' && (
        <>
          <RoomPanel />
          <ResultsBoard />
          <KeyGuide />
        </>
      )}
      {/* 미니맵 · 계기판은 닉네임 · 대기실에서도 (연습장을 달릴 수 있으니) */}
      {ready && <Minimap key={mapId} />}
      {ready && <Hud />}
      {ready && <VehiclePicker />}
      <Countdown />
      {ready?.map !== wanted && (
        <LoadingScreen
          map={wanted}
          reason={!ready ? 'init' : !o.room ? 'leave' : o.room.id !== ready.room ? 'enter' : 'map'}
          roomName={o.room?.name}
        />
      )}
    </>
  )
}

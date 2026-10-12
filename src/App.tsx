import { Canvas } from '@react-three/fiber'
import { Sky } from '@react-three/drei'
import { Suspense } from 'react'
import ContactMaterials from './components/ContactMaterials'
import Ground from './components/Ground'
import Hud from './components/Hud'
import Kart from './components/Kart'
import KeyGuide from './components/KeyGuide'
import Minimap from './components/Minimap'
import RemoteKarts from './components/RemoteKarts'
import SunLight from './components/SunLight'
import { PhysicsWorld } from './physics/PhysicsWorld'
import Track from './track/Track'
import { gridPose } from './track/trackData'
import Countdown from './ui/Countdown'
import EntryScreen from './ui/EntryScreen'
import LobbyScreen from './ui/LobbyScreen'
import ResultsBoard from './ui/ResultsBoard'
import RoomPanel from './ui/RoomPanel'
import { useOnline } from './ui/hooks'

export default function App() {
  // 그리드 첫 칸에서 시작. 온라인에 접속하면 서버가 정해 준 칸으로 옮긴다 (Kart.tsx)
  const { position: start, yaw } = gridPose(0)
  const o = useOnline()
  // 닉네임 → 대기실 → 방. 앞의 두 화면에서는 출발선에 세운 카트와 트랙이 배경이 된다
  const screen = !o.name ? 'entry' : !o.room ? 'lobby' : 'room'

  return (
    <>
      <Canvas shadows camera={{ position: [start[0], start[1] + 4, start[2] - 10], fov: 60, far: 900 }}>
        <color attach="background" args={['#bcd6ec']} />
        <fog attach="fog" args={['#bcd6ec', 120, 450]} />
        <Sky sunPosition={[100, 40, 100]} turbidity={6} rayleigh={1.5} />
        <hemisphereLight args={['#dfefff', '#4a6b3a', 0.6]} />
        <SunLight />
        <Suspense fallback={null}>
          {/* cannon-es를 메인 스레드에서 직접 돌린다 — 타이어 힘을 매 물리 스텝마다 계산하기 위해 */}
          <PhysicsWorld>
            <ContactMaterials />
            <Ground />
            <Track />
            <Kart position={start} yaw={yaw} />
            <RemoteKarts />
          </PhysicsWorld>
        </Suspense>
      </Canvas>

      {screen === 'entry' && <EntryScreen />}
      {screen === 'lobby' && <LobbyScreen />}
      {screen === 'room' && (
        <>
          <RoomPanel />
          <ResultsBoard />
          <KeyGuide />
          <Minimap />
          <Hud />
        </>
      )}
      <Countdown />
    </>
  )
}

import Bridge from './Bridge'
import Cones from './Cones'
import Curbs from './Curbs'
import Grandstand from './Grandstand'
import IcePatches from './IcePatches'
import JumpMarkers from './JumpMarkers'
import Road from './Road'
import StartLine from './StartLine'
import TireStacks from './TireStacks'
import Trees from './Trees'
import Tunnel from './Tunnel'
import Walls from './Walls'
import { HAS_JUMP, currentMap } from './trackData'

export default function Track() {
  return (
    <>
      <Road />
      <IcePatches />
      {/* 비포장 길에는 연석이 없다 */}
      {currentMap.theme.road !== 'dirt' && <Curbs />}
      <Walls />
      <Bridge />
      <Tunnel />
      <StartLine />
      <Grandstand />
      <Cones />
      <TireStacks />
      {HAS_JUMP && <JumpMarkers />}
      <Trees />
    </>
  )
}

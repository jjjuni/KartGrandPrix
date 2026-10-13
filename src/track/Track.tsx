import Cones from './Cones'
import Curbs from './Curbs'
import Grandstand from './Grandstand'
import IcePatches from './IcePatches'
import JumpMarkers from './JumpMarkers'
import Road from './Road'
import StartLine from './StartLine'
import TireStacks from './TireStacks'
import Trees from './Trees'
import Walls from './Walls'

export default function Track() {
  return (
    <>
      <Road />
      <IcePatches />
      <Curbs />
      <Walls />
      <StartLine />
      <Grandstand />
      <Cones />
      <TireStacks />
      <JumpMarkers />
      <Trees />
    </>
  )
}

import { useFrame } from '@react-three/fiber'
import type { World } from 'cannon-es'
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { FIXED_STEP, MAX_SUB_STEPS, createWorld } from './world'

const WorldContext = createContext<World | null>(null)

/** 물리 월드 제공 + 매 프레임 고정 스텝으로 진행 (메인 스레드) */
export function PhysicsWorld({ children }: { children: ReactNode }) {
  const world = useMemo(createWorld, [])

  // priority -1: 카트·소품이 위치를 읽는 기본 useFrame(0)보다 먼저 실행 (음수는 자동 렌더링을 끄지 않음)
  useFrame((_, delta) => {
    // 탭 전환 등으로 delta가 커져도 한 번에 너무 많이 진행하지 않게
    world.step(FIXED_STEP, Math.min(delta, 0.1), MAX_SUB_STEPS)
  }, -1)

  return <WorldContext.Provider value={world}>{children}</WorldContext.Provider>
}

export function useWorld() {
  const world = useContext(WorldContext)
  if (!world) throw new Error('useWorld는 <PhysicsWorld> 안에서만 쓸 수 있습니다')
  return world
}

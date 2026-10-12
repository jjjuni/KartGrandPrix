import { useEffect, useRef } from 'react'

export type Action = Exclude<keyof Controls, 'tapped'>

export type Controls = {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
  brake: boolean
  drift: boolean
  boost: boolean
  reset: boolean
  /**
   * 이번 프레임 사이에 '눌린 적이 있는' 키. 프레임이 잠깐 느려질 때 짧게 누른 키(Z 등)를
   * 눌렀다 떼기 전에 한 번도 읽지 못하고 놓치는 일을 막는다. 읽는 쪽에서 비운다
   */
  tapped: Set<Action>
}

const KEY_MAP: Record<string, Action> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'backward',
  ArrowDown: 'backward',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'brake',
  ShiftLeft: 'drift',
  ShiftRight: 'drift',
  KeyZ: 'boost',
  KeyR: 'reset',
}

/**
 * 키 입력 상태를 ref로 보관한다.
 * useFrame에서 매 프레임 읽기만 하므로 키 입력으로 리렌더링이 일어나지 않는다.
 * e.code 기준이라 한/영 입력 상태와 관계없이 동작한다.
 */
export function useControls() {
  const controls = useRef<Controls>({
    forward: false,
    backward: false,
    left: false,
    right: false,
    brake: false,
    drift: false,
    boost: false,
    reset: false,
    tapped: new Set(),
  })

  useEffect(() => {
    const set = (e: KeyboardEvent, pressed: boolean) => {
      const action = KEY_MAP[e.code]
      if (!action) return
      e.preventDefault() // 방향키·스페이스로 페이지가 스크롤되지 않게
      controls.current[action] = pressed
      if (pressed && !e.repeat) controls.current.tapped.add(action)
    }
    const down = (e: KeyboardEvent) => set(e, true)
    const up = (e: KeyboardEvent) => set(e, false)
    // 창이 포커스를 잃으면 눌린 키가 고정되지 않도록 모두 해제
    const clear = () => {
      for (const k of Object.values(KEY_MAP)) controls.current[k] = false
      controls.current.tapped.clear()
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
    }
  }, [])

  return controls
}

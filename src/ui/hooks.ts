import { useSyncExternalStore } from 'react'
import { race, raceVersion, subscribeRace } from '../game/race'
import { online, onlineVersion, subscribe } from '../net/online'

/** 접속 상태가 바뀔 때마다 다시 그린다 (값은 online 객체를 그대로 읽음) */
export function useOnline() {
  useSyncExternalStore(subscribe, onlineVersion)
  return online
}

export function useRace() {
  useSyncExternalStore(subscribeRace, raceVersion)
  return race
}

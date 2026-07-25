import { useEffect, useState } from 'react'
import { readOnlineStatus, subscribeOnlineStatus } from '@/lib/networkConnectivity'

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => readOnlineStatus())

  useEffect(() => subscribeOnlineStatus(setIsOnline), [])

  return { isOnline, isOffline: !isOnline }
}

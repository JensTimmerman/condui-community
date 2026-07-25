import { useLocation } from 'react-router-dom'
import { useOfflineConnectivityUi } from '@/hooks/useOfflineConnectivityUi'
import { OfflineConnectivityFloatingNotice } from '@/components/connectivity/OfflineConnectivityFloatingNotice'
import { offlineNoticeTopClassForPath } from '@/lib/connectivity/offlineNoticePlacement'

/** Global offline notice (floating). Editor logo indicator is handled in Layout. */
export function OfflineConnectivityNotice() {
  const { pathname } = useLocation()
  const { showBanner, dismissBanner } = useOfflineConnectivityUi({ allowDismiss: true })

  if (!showBanner) return null

  return (
    <OfflineConnectivityFloatingNotice
      onDismiss={dismissBanner}
      topClassName={offlineNoticeTopClassForPath(pathname)}
    />
  )
}

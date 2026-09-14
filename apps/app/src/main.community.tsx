import React from 'react'
import ReactDOM from 'react-dom/client'
import { CommunityErrorBoundary } from '@/editions/community/CommunityErrorBoundary'
import { registerAppServiceWorker } from '@/lib/pwa/registerAppServiceWorker'
import { completeAppHardReloadNavigation } from '@/lib/pwa/serviceWorkerUpdateReload'
import { resolveInitialThemePreference } from '@/utils/userPreferences'
import CommunityApp from './CommunityApp'
import './index.css'

const isCompletingHardReload = completeAppHardReloadNavigation()

if (!isCompletingHardReload) {
  registerAppServiceWorker()

  void import('@/lib/symbolImage').then(({ warmSymbolSvgCache }) => {
    void warmSymbolSvgCache({ isDark: resolveInitialThemePreference(['eendra-theme']) === 'dark' })
  })

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <CommunityErrorBoundary>
      <React.StrictMode>
        <CommunityApp />
      </React.StrictMode>
    </CommunityErrorBoundary>,
  )
}

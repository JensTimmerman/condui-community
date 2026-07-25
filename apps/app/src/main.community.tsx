import React from 'react'
import ReactDOM from 'react-dom/client'
import { CommunityErrorBoundary } from '@/editions/community/CommunityErrorBoundary'
import { registerAppServiceWorker } from '@/lib/pwa/registerAppServiceWorker'
import CommunityApp from './CommunityApp'
import './index.css'

registerAppServiceWorker()

void import('@/lib/symbolImage').then(({ warmSymbolSvgCache }) => {
  void warmSymbolSvgCache({ bothThemes: true })
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <CommunityErrorBoundary>
    <React.StrictMode>
      <CommunityApp />
    </React.StrictMode>
  </CommunityErrorBoundary>,
)

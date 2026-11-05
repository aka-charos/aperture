import React from 'react'
import ReactDOM from 'react-dom/client'
import { firstLanguageReady } from './i18n/config'
import { loadBranding } from './lib/branding'
import { installChunkReload } from './lib/staleChunk'
import App from './App'

// This module is in the entry chunk, whose hashed name identifies the build.
installChunkReload(import.meta.url)

// Not awaited: the name and logo only affect presentation, and blocking first
// paint on a round trip to show the same defaults in the overwhelming majority
// of installs is a bad trade. They arrive a frame or two later and re-render.
void loadBranding()

// Unlike the name above, the language decides every word and the direction of
// the page. Without this wait a viewer reading Greek or Arabic would get a flash
// of left-to-right English while their locale chunk arrives.
void firstLanguageReady().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
})




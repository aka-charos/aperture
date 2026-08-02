import React from 'react'
import ReactDOM from 'react-dom/client'
import './i18n/config'
import { loadBranding } from './lib/branding'
import App from './App'

// Not awaited: the name and logo only affect presentation, and blocking first
// paint on a round trip to show the same defaults in the overwhelming majority
// of installs is a bad trade. They arrive a frame or two later and re-render.
void loadBranding()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)




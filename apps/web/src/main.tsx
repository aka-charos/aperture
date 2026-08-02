import React from 'react'
import ReactDOM from 'react-dom/client'
import './i18n/config'
import { loadAppName } from './lib/branding'
import App from './App'

// Not awaited: the name only affects wording, and blocking first paint on a
// round trip to show the same default in the overwhelming majority of installs
// is a bad trade. It arrives a frame or two later and re-renders.
void loadAppName()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)




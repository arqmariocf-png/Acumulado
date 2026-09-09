import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Habilita "instalar app" (PWA) y la recepción de notificaciones push de
// recordatorios -- sin esto registrado, el navegador nunca ofrece
// instalarla ni puede entregar un push aunque el usuario ya se haya
// suscrito.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Si falla el registro (navegador viejo, etc.) la app sigue
      // funcionando normal en pestaña de navegador, solo sin poder
      // instalarse ni recibir push.
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

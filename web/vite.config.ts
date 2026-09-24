import { writeFileSync, mkdirSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Versión de la compilación: la app la compara contra /version.json para
// avisar "hay una versión nueva" en pestañas que llevan abiertas desde antes
// del deploy (la app instalada en el teléfono no se recarga sola).
const VERSION = new Date().toISOString()

function versionJson(): Plugin {
  return {
    name: 'acumulado-version-json',
    closeBundle() {
      mkdirSync('dist', { recursive: true })
      writeFileSync('dist/version.json', JSON.stringify({ version: VERSION }))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), versionJson()],
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
})

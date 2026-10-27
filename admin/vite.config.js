import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Served by FastAPI under /admin
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
})

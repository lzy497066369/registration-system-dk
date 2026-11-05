import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5280,
    proxy: {
      '/api': 'http://localhost:8110',
      '/uploads': 'http://localhost:8110',
    },
  },
})

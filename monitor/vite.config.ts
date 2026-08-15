import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Bind IPv4 explicitly — Windows often resolves localhost to ::1 only
    host: '127.0.0.1',
    port: Number(process.env.QORLITH_WEB_PORT || 5173),
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.QORLITH_PORT || 3921}`,
        changeOrigin: true,
      },
    },
  },
})

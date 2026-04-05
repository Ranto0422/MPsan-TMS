import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Only enable HTTPS for non-localhost (mobile devices need HTTPS for push)
    // On localhost, service workers work without HTTPS
    ...(process.env.VITE_HTTPS === 'true' ? [basicSsl()] : []),
  ],
  server: {
    host: true, // Allow access from other devices on the network
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})

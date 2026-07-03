import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'

export default defineConfig({
  // Solid JSX transform so tests can import .tsx modules (components, brand icons).
  plugins: [solid()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@/core': resolve(__dirname, 'src/core'),
      '@/features': resolve(__dirname, 'src/features'),
      '@/components': resolve(__dirname, 'src/components'),
      '@/stores': resolve(__dirname, 'src/stores'),
      '@/types': resolve(__dirname, 'src/types'),
      '@/lib': resolve(__dirname, 'src/lib'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
})

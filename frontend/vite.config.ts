import { resolve } from 'path'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  base: './',
  build: {
    emptyOutDir: true,
    outDir: 'dist',
    sourcemap: true,
    minify: 'esbuild',
    rollupOptions: {
      input: resolve(__dirname, 'src/main.tsx'),
      output: {
        entryFileNames: 'assets/index.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  plugins: [
    solid({
      emitCss: true,
      installSolidComponents: true,
    }),
  ],
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
  css: {
    postcss: './postcss.config.cjs',
  },
  server: {
    port: 3800,
  },
})

import { resolve } from 'path'
import { defineConfig } from 'vite'
import bundleAnalyzer from 'vite-bundle-analyzer'
import solidPlugin from 'vite-plugin-solid'
import solidSvg from 'vite-plugin-solid-svg'

const ANALYZE_BUNDLE = Boolean(process.env.VITE_ANALYZE_BUNDLE)

const IS_PLAYWRIGHT = Boolean(process.env.mode === 'test')

export default defineConfig({
  base: './',
  build: {
    emptyOutDir: true,
    outDir: 'dist',
    sourcemap: true,
    target: 'esnext',
    // minify: 'esbuild',
    // rollupOptions: {
    //   input: resolve(__dirname, 'src/main.tsx'),
    //   output: {
    //     entryFileNames: 'assets/index.js',
    //     chunkFileNames: 'assets/[name]-[hash].js',
    //     assetFileNames: 'assets/[name]-[hash].[ext]',
    //   },
    // },
  },
  plugins: [
    solidPlugin(),
    ANALYZE_BUNDLE ? bundleAnalyzer() : undefined,
    solidSvg({ defaultAsComponent: true }),
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
    modules: {
      localsConvention: 'camelCaseOnly',
    },
  },
  // todo: was this used?
  // css: {
  //   postcss: './postcss.config.cjs',
  // },
  server: {
    port: 3800,
    proxy: {
      '/api': {
        target: IS_PLAYWRIGHT ? 'http://localhost:3846' : 'http://localhost:3847',
        changeOrigin: true,
      },
    },
  },
})

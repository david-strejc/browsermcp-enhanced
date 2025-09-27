import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  external: [], // Bundle všechny závislosti
  noExternal: [/.*/], // Explicitně bundluj vše
  target: 'node18',
  bundle: true,
  clean: true,
  minify: false, // Pro lepší debugování
  sourcemap: false,
  dts: false,
  onSuccess: 'chmod +x dist/*.js',
  platform: 'node',
  shims: true, // Přidá Node.js shims
  define: {
    'global': 'globalThis'
  }
})
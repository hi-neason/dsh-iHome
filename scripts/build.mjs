import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
})

// DSH loads a factory per browser plugin and supplies React through its require.
await build({
  entryPoints: ['src/client.tsx'],
  outfile: 'dist/client.js',
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  // The desktop loader serves a single client module, without a public asset path.
  loader: { '.css': 'text', '.webp': 'dataurl' },
  external: ['react', 'react-dom'],
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory(require) {
var module = { exports: {} };
var exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
})

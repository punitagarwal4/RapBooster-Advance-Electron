import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'

// better-sqlite3 is a native module and the Prisma client ships a WASM query
// compiler — both must stay external and be unpacked from the asar archive.
const nativeExternals = [
  'better-sqlite3',
  '@prisma/client',
  '@prisma/adapter-better-sqlite3',
]

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: [] })],
    build: {
      rollupOptions: {
        external: nativeExternals,
        input: {
          index: resolve(__dirname, 'electron/main/index.ts'),
          'self-test': resolve(__dirname, 'electron/main/self-test.ts'),
          // Built alongside main so it shares the same externals and lands at
          // out/main/wa-service/index.js, which wa-bridge forks.
          'wa-service/index': resolve(__dirname, 'electron/wa-service/index.ts'),
        },
      },
    },
    resolve: {
      alias: {
        '@main': resolve('electron/main'),
        '@shared': resolve('shared'),
        '@generated': resolve('generated'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload/index.ts') },
      },
    },
  },
})

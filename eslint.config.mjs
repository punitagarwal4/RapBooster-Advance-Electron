import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'out/**',
      'dist/**',
      'generated/**',
      'renderer/.next/**',
      'renderer/out/**',
      'test-results/**',
      'playwright-report/**',
      // Vendored UI prototypes — reference material, never imported (CLAUDE.md §2.8).
      'design/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // CLAUDE.md §5.6: the renderer is untrusted input and IPC payloads are
      // zod-validated, so `any` at a boundary defeats the whole contract.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // CLAUDE.md §5.1: no silent catches.
      'no-empty': ['error', { allowEmptyCatch: false }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  {
    // Main, preload, wa-service and build tooling all run in Node/Electron.
    files: [
      'electron/**/*.ts',
      'shared/**/*.ts',
      'scripts/**/*.mjs',
      '*.config.{ts,mjs,js}',
      'prisma.config.ts',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Application logging goes through electron-log, but the headless
      // self-test writes to stdout by design — that is its entire output
      // contract with scripts/smoke.mjs.
      'no-console': 'off',
    },
  },

  {
    files: ['renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The renderer has no logger of its own; anything worth recording goes
      // to main over IPC.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
)

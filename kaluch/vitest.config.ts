import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': import.meta.dirname, 'server-only': `${import.meta.dirname}/tests/stubs/server-only.ts` } },
  test: { include: ['tests/**/*.test.ts'] },
})

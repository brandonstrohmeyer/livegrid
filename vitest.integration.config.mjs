import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.{js,ts}', 'tests/rules/**/*.test.{js,ts}'],
    testTimeout: 30000,
    hookTimeout: 30000,
    threads: false,
    fileParallelism: false,
    maxWorkers: 1,
    sequence: {
      concurrent: false
    }
  }
})

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.ts'],
      exclude: ['src/domain/**/*.test.ts'],
      reporter: ['text', 'lcov'],
    },
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'src/domain/**/*.test.ts',
            'src/server/**/*.test.ts',
            'test/**/*.test.ts',
            'scripts/**/*.test.ts',
          ],
          testTimeout: 30000,
          hookTimeout: 30000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['src/web/**/*.test.{ts,tsx}'],
          setupFiles: ['test/setup.web.ts'],
        },
      },
    ],
  },
});

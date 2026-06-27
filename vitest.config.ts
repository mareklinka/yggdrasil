import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, 'tests/obsidian.stub.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    tsconfig: './tsconfig.json',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'cobertura'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/main.ts',
        'src/**/*.d.ts',
      ],
    },
  },
});

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS === 'true' ? '/TikZ-Editor/' : '/',
  plugins: [react()],
  test: { include: ['src/**/*.test.ts', 'tests/**/*.test.ts'], environment: 'node' },
});

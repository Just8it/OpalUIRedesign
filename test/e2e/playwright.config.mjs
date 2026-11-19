import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'extension.spec.mjs', workers: 1, timeout: 45000, expect: { timeout: 15000 }, reporter: [['list']], outputDir: './results' });

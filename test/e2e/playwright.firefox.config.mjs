import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';
export default defineConfig({ ...base, testMatch: 'firefox.spec.mjs', outputDir: './results/firefox' });

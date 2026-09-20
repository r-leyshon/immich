import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// The preset is CommonJS; createRequire is the ESM-safe way to load it in production.
export const emailTailwindPreset = require('tailwindcss-preset-email') as Record<string, unknown>;

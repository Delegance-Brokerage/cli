// Flat config for the sdk workspace (eslint 9+ removed .eslintrc and --ext).
// The root repo config also lints sdk/ via `npm run lint` at the root; this
// local config exists so `npm run lint` INSIDE sdk/ works standalone with the
// devDependencies pinned here.
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: tsParser, sourceType: 'module' },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: { ...tsPlugin.configs.recommended.rules },
  },
];

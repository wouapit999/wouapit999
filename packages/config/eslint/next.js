import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

import { createBaseConfig } from './base.js';

/**
 * ESLint preset for the Next.js 16 portals (`apps/web`, `apps/admin`): base preset plus
 * `@next/eslint-plugin-next` Core Web Vitals rules and React Hooks rules.
 *
 * @param {import('./base.js').BaseConfigOptions} [options]
 * @returns {import('eslint').Linter.Config[]}
 */
export function createNextConfig(options = {}) {
  const { ignores = [], ...rest } = options;

  return [
    ...createBaseConfig({ ...rest, ignores: ['next-env.d.ts', ...ignores] }),
    {
      files: ['**/*.{js,jsx,mjs,ts,tsx}'],
      languageOptions: {
        globals: { ...globals.browser, ...globals.node },
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
    },
    nextPlugin.configs['core-web-vitals'],
    reactHooks.configs.flat.recommended,
    {
      files: ['**/*.{jsx,tsx}'],
      rules: {
        // Server Components return promises from async components; this rule misfires there.
        '@typescript-eslint/no-misused-promises': [
          'error',
          { checksVoidReturn: { attributes: false, arguments: false } },
        ],
      },
    },
    {
      files: ['**/*.test.{ts,tsx}', '**/__tests__/**'],
      rules: {
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
  ];
}

export default createNextConfig;

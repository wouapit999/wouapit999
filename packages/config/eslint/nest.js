import globals from 'globals';

import { createBaseConfig } from './base.js';

/**
 * ESLint preset for the NestJS API (`apps/api`). Builds on the base preset and relaxes the
 * rules that fight Nest's decorator-driven dependency injection.
 *
 * @param {import('./base.js').BaseConfigOptions} [options]
 * @returns {import('eslint').Linter.Config[]}
 */
export function createNestConfig(options = {}) {
  return [
    ...createBaseConfig(options),
    {
      files: ['**/*.ts'],
      rules: {
        // Nest resolves constructor dependencies from emitted decorator metadata, which requires
        // value imports; `import type` would erase them and break DI.
        '@typescript-eslint/consistent-type-imports': 'off',
        '@typescript-eslint/no-import-type-side-effects': 'off',
        // Nest modules and marker classes are intentionally empty.
        '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
        // Controllers/services commonly return inferred Promise<Dto>; explicit types are optional.
        '@typescript-eslint/explicit-function-return-type': 'off',
        // Decorated DTO properties are assigned by class-transformer, not constructors.
        '@typescript-eslint/no-unsafe-assignment': 'error',
        '@typescript-eslint/no-unsafe-argument': 'error',
      },
    },
    {
      files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
      languageOptions: { globals: { ...globals.jest } },
      rules: {
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/unbound-method': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
  ];
}

export default createNestConfig;

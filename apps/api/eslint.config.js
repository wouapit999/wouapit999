import { createNestConfig } from '@bi-rem/config/eslint/nest';

export default [
  ...createNestConfig({
    tsconfigRootDir: import.meta.dirname,
    allowDefaultProject: ['eslint.config.js', 'test/*.mjs'],
  }),
  {
    // Test doubles are idiomatically written as `async () => value` and empty decorated stubs.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
];

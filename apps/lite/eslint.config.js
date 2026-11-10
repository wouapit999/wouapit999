import { createNextConfig } from '@bi-rem/config/eslint/next';

export default [
  ...createNextConfig({
    tsconfigRootDir: import.meta.dirname,
    ignores: [
      'next-env.d.ts',
      'postcss.config.mjs',
      '.next-*/**',
      'src/generated/**',
      'public/**',
      'tests/e2e/**/*.mjs',
    ],
  }),
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Lite is self-contained: money helpers live in src/server/money.ts.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: 'Money must never be handled as floats; use @/server/money.',
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts', 'prisma/**/*.ts', 'scripts/**/*.mjs'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];

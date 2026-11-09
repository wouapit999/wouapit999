import { createNextConfig } from '@bi-rem/config/eslint/next';

export default createNextConfig({
  tsconfigRootDir: import.meta.dirname,
  ignores: ['next-env.d.ts', 'postcss.config.mjs'],
});

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Paths no workspace should ever lint. */
export const DEFAULT_IGNORES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/out/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/generated/**',
];

/**
 * Config-style files that often live outside any tsconfig project. Pass this as
 * `allowDefaultProject` when a workspace's tsconfig does NOT include them (a file that is both in
 * a tsconfig and in `allowDefaultProject` is a parsing error for typescript-eslint).
 */
export const DEFAULT_PROJECT_FILES = [
  '*.config.ts',
  '*.config.mts',
  '*.config.cts',
  '*.config.js',
  '*.config.mjs',
  '*.config.cjs',
];

/**
 * @typedef {object} BaseConfigOptions
 * @property {string} [tsconfigRootDir] Absolute path of the workspace (use `import.meta.dirname`).
 *   Required when `typeChecked` is true.
 * @property {string[]} [ignores] Extra glob patterns to ignore, merged with {@link DEFAULT_IGNORES}.
 * @property {boolean} [typeChecked] Enable type-aware rules via the TypeScript project service.
 *   Defaults to true.
 * @property {string[]} [allowDefaultProject] Globs (no `**`) for files outside any tsconfig that
 *   should still be type-checked with a default project. Defaults to none; see
 *   {@link DEFAULT_PROJECT_FILES}.
 */

/**
 * Shared ESLint 9 flat config for every BI-Rem workspace: JavaScript recommended rules,
 * typescript-eslint (type-checked by default) plus the stylistic preset, and Prettier
 * compatibility applied last.
 *
 * @param {BaseConfigOptions} [options]
 * @returns {import('eslint').Linter.Config[]}
 */
export function createBaseConfig(options = {}) {
  const { tsconfigRootDir, ignores = [], typeChecked = true, allowDefaultProject = [] } = options;

  if (typeChecked && !tsconfigRootDir) {
    throw new Error(
      '@bi-rem/config: createBaseConfig requires `tsconfigRootDir` when typeChecked is true',
    );
  }

  /** @type {import('eslint').Linter.Config[]} */
  const tsPresets = typeChecked
    ? [...tseslint.configs.recommendedTypeChecked, ...tseslint.configs.stylisticTypeChecked]
    : [...tseslint.configs.recommended, ...tseslint.configs.stylistic];

  /** @type {import('eslint').Linter.Config[]} */
  const config = [
    { ignores: [...DEFAULT_IGNORES, ...ignores] },
    js.configs.recommended,
    ...tsPresets,
    {
      languageOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
        globals: { ...globals.es2023, ...globals.node },
        parserOptions: typeChecked
          ? { projectService: { allowDefaultProject }, tsconfigRootDir }
          : {},
      },
      linterOptions: { reportUnusedDisableDirectives: 'error' },
      rules: {
        eqeqeq: ['error', 'always', { null: 'ignore' }],
        'no-console': ['warn', { allow: ['warn', 'error'] }],
        'no-restricted-syntax': [
          'error',
          {
            selector: "CallExpression[callee.name='parseFloat']",
            message: 'Money must never be handled as floats; use @bi-rem/shared money utils.',
          },
        ],
        'object-shorthand': 'error',
        'prefer-const': 'error',
        '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/explicit-module-boundary-types': 'off',
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
            ignoreRestSiblings: true,
          },
        ],
        '@typescript-eslint/no-import-type-side-effects': 'error',
        '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      },
    },
    ...(typeChecked
      ? [
          {
            files: ['**/*.{ts,tsx,mts,cts}'],
            rules: {
              '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
              '@typescript-eslint/no-misused-promises': [
                'error',
                { checksVoidReturn: { attributes: false } },
              ],
              '@typescript-eslint/switch-exhaustiveness-check': 'error',
              '@typescript-eslint/no-unnecessary-condition': 'error',
              '@typescript-eslint/prefer-nullish-coalescing': [
                'error',
                { ignorePrimitives: { string: true } },
              ],
              '@typescript-eslint/restrict-template-expressions': [
                'error',
                { allowNumber: true, allowBoolean: true },
              ],
            },
          },
        ]
      : []),
    // Plain JS files (config files, scripts) are never type-checked.
    { files: ['**/*.{js,mjs,cjs}'], ...tseslint.configs.disableTypeChecked },
    prettier,
  ];

  return config;
}

export default createBaseConfig;

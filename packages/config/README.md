# @bi-rem/config

Shared TypeScript and ESLint 9 (flat config) presets. No build step; files are consumed in place.

## tsconfig presets

| File                    | Use for                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `tsconfig/base.json`    | Extends the repo root `tsconfig.base.json` (single source of truth)                          |
| `tsconfig/library.json` | `packages/*` libraries built with `tsc` (NodeNext ESM, declarations, `verbatimModuleSyntax`) |
| `tsconfig/nest.json`    | `apps/api` (CommonJS, decorators + metadata, `outDir: dist`)                                 |
| `tsconfig/nextjs.json`  | `apps/web`, `apps/admin` (bundler resolution, `jsx: preserve`, Next TS plugin)               |

Extend them with a **relative path**:

```jsonc
// packages/shared/tsconfig.json
{ "extends": "../config/tsconfig/library.json" }
// apps/api/tsconfig.json
{ "extends": "../../packages/config/tsconfig/nest.json" }
```

`"extends": "@bi-rem/config/tsconfig/nest.json"` also resolves for `tsc`, but tsserver-based
tools (type-aware ESLint, editors) do not realpath the pnpm symlink and then fail to find the
root `tsconfig.base.json`. Use the relative form.

## ESLint presets

```js
// packages/<lib>/eslint.config.js
import { createBaseConfig } from '@bi-rem/config/eslint/base';
export default createBaseConfig({ tsconfigRootDir: import.meta.dirname });

// apps/api/eslint.config.js
import { createNestConfig } from '@bi-rem/config/eslint/nest';
export default createNestConfig({ tsconfigRootDir: import.meta.dirname });

// apps/web/eslint.config.js
import { createNextConfig } from '@bi-rem/config/eslint/next';
export default createNextConfig({ tsconfigRootDir: import.meta.dirname });
```

Options (all presets):

- `tsconfigRootDir` – required for type-aware linting; pass `import.meta.dirname`.
- `ignores` – extra globs, merged with `DEFAULT_IGNORES` (dist, .next, coverage, generated…).
- `typeChecked` – default `true`; set `false` for JS-only workspaces.
- `allowDefaultProject` – globs for files outside every tsconfig that should still be linted
  (e.g. `DEFAULT_PROJECT_FILES` = `*.config.ts|js|mjs…`). Leave empty when your tsconfig already
  includes those files, otherwise typescript-eslint reports a parsing error.

The base preset applies `@eslint/js` recommended, `typescript-eslint` recommended + stylistic
(type-checked), a few BI-Rem rules (no floats for money via `parseFloat`, inline type imports,
exhaustive switches) and `eslint-config-prettier` last. The Nest preset disables
`consistent-type-imports` (DI needs value imports) and relaxes unsafe-* rules in specs. The Next
preset adds `@next/eslint-plugin-next` Core Web Vitals and `eslint-plugin-react-hooks`.

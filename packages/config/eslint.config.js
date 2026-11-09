import { createBaseConfig } from './eslint/base.js';

// This package ships plain JavaScript presets, so type-aware linting is unnecessary here.
export default createBaseConfig({ tsconfigRootDir: import.meta.dirname, typeChecked: false });

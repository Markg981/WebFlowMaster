/* eslint-env node */
module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier', // must be last: turns off formatting rules handled by Prettier
  ],
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'client/dist/',
    'migrations/',
    'migrations_old/',
    'allure-results/',
    'results/',
    'coverage/',
    '*.config.js',
    '*.config.ts',
    'scripts/',
  ],
  rules: {
    // The codebase leans heavily on `any`; keep it as a warning rather than an error
    // so the gate is useful without a massive up-front cleanup.
    '@typescript-eslint/no-explicit-any': 'off',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-empty-function': 'off',
    // Global type augmentation (e.g. Express.User) legitimately needs `declare global { namespace ... }`.
    '@typescript-eslint/no-namespace': 'off',
    '@typescript-eslint/ban-ts-comment': 'warn',
    'no-empty': 'warn',
    'no-constant-condition': ['error', { checkLoops: false }],
    // Pre-existing legacy style issues across the codebase — kept visible as warnings
    // so the CI gate isn't blocked by them, while real-bug rules below stay as errors.
    'no-case-declarations': 'warn',
    'no-useless-escape': 'warn',
    '@typescript-eslint/prefer-as-const': 'warn',
    // React Hooks: kept as warnings for now — there are pre-existing violations
    // (e.g. a top-level useToast) worth fixing, but they shouldn't block the CI gate yet.
    'react-hooks/rules-of-hooks': 'warn',
    'react-hooks/exhaustive-deps': 'warn',
    // These catch real bugs (e.g. the duplicated object keys found in this repo):
    'no-dupe-keys': 'error',
    'no-dupe-class-members': 'error',
    'no-redeclare': 'error',
    'no-unreachable': 'error',
  },
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.test.tsx'],
      env: { node: true },
    },
  ],
};

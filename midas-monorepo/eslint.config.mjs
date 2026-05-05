import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // SEC-02: Ban float arithmetic in financial paths
    files: [
      'packages/database/src/**/*.ts',
      'apps/telegram-bot/src/services/**/*.ts',
      'apps/background-workers/src/**/*.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name="parseFloat"]',
          message: 'SEC-02: parseFloat is forbidden in financial paths. Use Decimal from decimal.js.',
        },
        {
          selector: 'CallExpression[callee.name="Number"]',
          message: 'SEC-02: Number() is forbidden in financial paths. Use Decimal from decimal.js.',
        },
        {
          selector: 'UnaryExpression[operator="+"][argument.type!="UnaryExpression"]',
          message: 'SEC-02: Unary + coercion is forbidden in financial paths. Use Decimal from decimal.js.',
        },
      ],
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.js', '**/*.mjs'],
  },
);

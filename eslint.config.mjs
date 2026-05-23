import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintPluginUnicorn.configs['flat/recommended'],
  {
    rules: {
      'no-else-return': ['error', { allowElseIf: false }],
      'unicorn/no-lonely-if': 'error',
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/filename-case': 'off',
      'unicorn/no-null': 'off',
      'unicorn/prefer-module': 'off',
      'unicorn/prefer-top-level-await': 'off',
      'unicorn/no-array-reduce': 'off',
      'unicorn/prefer-spread': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/import-style': 'off',
      'unicorn/no-process-exit': 'off',
      'unicorn/no-array-for-each': 'off',
      'unicorn/text-encoding-identifier-case': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'coverage/'],
  }
);

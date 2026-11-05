import globals from 'globals';
import pluginJest from 'eslint-plugin-jest';
import shellConfig from '@rancher/shell/eslint.config.base.mjs';

export default [
  ...shellConfig,

  // Unit tests. `globals` and `eslint-plugin-jest` come from `@rancher/shell`, the same way as the
  // rest of the eslint toolchain. Without this, `describe`/`it`/`expect`/`jest` are reported as
  // undefined in every test file.
  {
    files: [
      '**/__tests__/**/*.{js,ts}',
      '**/*.test.{js,ts}',
      'jest.config.js',
      'jest.setup.js',
    ],
    plugins:         { jest: pluginJest },
    languageOptions: { globals: { ...globals.jest } },
    rules:           {
      ...pluginJest.configs['flat/recommended'].rules,
      'jest/no-commented-out-tests': 'off',
      'jest/no-disabled-tests':      'off',
    },
  },

  // Project-specific ignores on top of the shell defaults (node_modules, dist, dist-pkg,
  // coverage and dotfiles are already ignored by the shared config).
  {
    ignores: [
      'assets/fonts',
      'dist',
      'dist-pkg',
      'dynamic-importer.js',
      'ksconfig.json',
      'shell/utils/dynamic-importer.js',
      'shell/assets/fonts',
      'cypress/downloads',
      'cypress/reports',
      'cypress/screenshots',
      'cypress/videos',
    ],
  },
  {
    rules: {
      'no-multiple-empty-lines': ['error', { max: 1 }],
      'no-useless-constructor':  'error',
      'no-mixed-operators':      'warn',

      // Kept disabled to match the previous `.eslintrc` behavior.
      'vue/multi-word-component-names':            'off',
      '@typescript-eslint/no-empty-object-type':   'off', // successor to the old (disabled) ban-types
    },
  },

  {
    files: ['**/*.d.ts'],
    rules: {
      'no-unused-vars':                    'off',
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },

  {
    files: ['**/*.vue'],
    rules: {
      'vue/no-v-html':                    'error',
      'vue/html-indent':                  ['error', 2],
      'vue/html-closing-bracket-newline': ['error', { singleline: 'never', multiline: 'always' }],
      'vue/html-closing-bracket-spacing': 'error',
      'vue/html-end-tags':                'error',
      'vue/html-quotes':                  'error',
      'vue/html-self-closing':            ['error', {
        html: {
          void:      'never',
          normal:    'always',
          component: 'always',
        },
        svg:  'always',
        math: 'always',
      }],
      'vue/max-attributes-per-line': ['error', {
        singleline: { max: 1 },
        multiline:  { max: 1 },
      }],
    },
  },

  {
    files: ['**/*.{js,ts,vue}'],
    rules: {
      '@typescript-eslint/no-this-alias':     'off',
      '@typescript-eslint/no-explicit-any':   'off',
      '@typescript-eslint/no-empty-function': 'off',
      'no-unused-vars':                       'off',
      '@typescript-eslint/no-unused-vars':    'warn',
    },
  },

  {
    files: [
      '**/*.test.{js,ts}',
      '**/__tests__/**/*.{js,ts}',
      '**/__mocks__/**/*.{js,ts}',
    ],
    rules: {
      '@typescript-eslint/no-empty-function':              'off',
      '@typescript-eslint/no-non-null-assertion':          'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
];

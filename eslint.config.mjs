import shellConfig from '@rancher/shell/eslint.config.base.mjs';

export default [
  ...shellConfig,

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

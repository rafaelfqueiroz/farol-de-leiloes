// Flat ESLint config for the frontend (DEVELOPMENT §1/§2, TESTING §9, DESIGN DS-01/DS-20/DS-21).
// `next lint` no longer exists in Next 16, so ESLint runs directly.
// Legacy violations are listed in eslint-suppressions.json (ESLint bulk suppressions), never
// disabled here; #30 removes them. New code is held to every rule below from the day it lands.
import { fileURLToPath } from 'node:url';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import tseslint from 'typescript-eslint';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

// DS-01: a component never hardcodes a colour or a pixel value; both come from the theme.
const inSx = "JSXAttribute[name.name='sx']";
const noHardcodedStyleInSx = [
  {
    selector: `${inSx} Literal[value=/#[0-9a-fA-F]{3,8}\\b/]`,
    message:
      'DS-01: no hex colour in sx. Use a theme palette token (e.g. color: "text.secondary").',
  },
  {
    selector: `${inSx} TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]`,
    message:
      'DS-01: no hex colour in sx. Use a theme palette token (e.g. color: "text.secondary").',
  },
  {
    selector: `${inSx} Literal[value=/[0-9]\\s*px\\b/]`,
    message:
      'DS-01: no px literal in sx. Use theme.spacing(), a spacing unit (p: 2) or a typography variant.',
  },
  {
    selector: `${inSx} TemplateElement[value.raw=/[0-9]\\s*px\\b/]`,
    message:
      'DS-01: no px literal in sx. Use theme.spacing(), a spacing unit (p: 2) or a typography variant.',
  },
];

// A warning is never read and cannot be bulk-suppressed, so every rule the Next presets ship as a
// warning runs as an error here; legacy hits are then listed in eslint-suppressions.json like the rest.
const warningsAsErrors = (configs) =>
  configs.map((config) =>
    config.rules
      ? {
          ...config,
          rules: Object.fromEntries(
            Object.entries(config.rules).map(([name, entry]) => {
              const [severity, ...options] = Array.isArray(entry) ? entry : [entry];
              return [name, severity === 'warn' || severity === 1 ? ['error', ...options] : entry];
            }),
          ),
        }
      : config,
  );

export default defineConfig([
  globalIgnores([
    '.next/**',
    'node_modules/**',
    'coverage/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'public/**',
  ]),
  ...warningsAsErrors([...nextCoreWebVitals, ...nextTypescript]),
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    languageOptions: {
      parserOptions: {
        // Type-aware linting: no-floating-promises needs type information.
        projectService: true,
        tsconfigRootDir: rootDir,
      },
    },
    rules: {
      // DS-21: eslint-config-next already registers the jsx-a11y plugin; add the full recommended rules.
      ...jsxA11y.flatConfigs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error', // DV-02
      '@typescript-eslint/no-non-null-assertion': 'error', // DV-03
      '@typescript-eslint/no-floating-promises': 'error', // an un-awaited write is silent data loss
      'no-console': 'error', // DV-11: client logging goes to Sentry
      'no-restricted-syntax': ['error', ...noHardcodedStyleInSx], // DS-01
    },
  },
  {
    // DS-20: user-facing strings come from the next-intl pt-BR catalogue, not JSX literals.
    files: ['app/**/*.tsx'],
    ignores: ['**/*.test.tsx'],
    rules: {
      'react/jsx-no-literals': ['error', { noStrings: true, ignoreProps: true }],
    },
  },
  {
    // Plain JS/MJS (this config) has no tsconfig project to type-check against.
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
]);

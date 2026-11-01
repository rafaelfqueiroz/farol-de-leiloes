// Flat ESLint config for the backend (DEVELOPMENT §1/§2, TESTING §9).
// Legacy violations are listed in eslint-suppressions.json (ESLint bulk suppressions), never
// disabled here; #30 removes them. New code is held to every rule below from the day it lands.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import globals from 'globals';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

// Every top-level directory of src/ is a module (ARCHITECTURE §3).
const modules = readdirSync(new URL('./src/', import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

// AR-05: `domain/` is pure — no framework, no I/O, no ambient clock or environment.
const domainForbiddenModules = [
  'mongoose',
  'rxjs',
  'stripe',
  'nodemailer',
  'puppeteer',
  'cheerio',
  'passport',
  'bcrypt',
  'cache-manager',
  'class-validator',
  'class-transformer',
  'axios',
  'node-fetch',
  'undici',
  'fs',
  'http',
  'https',
  'net',
  'child_process',
].flatMap((name) => [name, `node:${name}`]);

const domainImportRule = {
  paths: domainForbiddenModules.map((name) => ({
    name,
    message: 'AR-05: domain/ imports no framework, database client, vendor SDK or I/O.',
  })),
  patterns: [
    {
      group: ['@nestjs/*', '@aws-sdk/*', 'passport-*', 'puppeteer-*', 'fs/*', 'node:fs/*'],
      message: 'AR-05: domain/ imports no framework, database client, vendor SDK or I/O.',
    },
  ],
};

// AR-09: another module is reached through its exported service, never its repository or schema.
const crossModulePatterns = (self) => ({
  group: modules
    .filter((other) => other !== self)
    .flatMap((other) => [
      `**/${other}/**/*.repository`,
      `**/${other}/schemas`,
      `**/${other}/schemas/**`,
      `**/${other}/**/*.schema`,
      `**/${other}/**/*.schemas`,
    ]),
  message:
    "AR-09: never import another module's repository, schema or model. Ask its exported service.",
});

const domainOnlyProperties = [
  { object: 'process', property: 'env', message: 'AR-05: domain/ reads no environment.' },
  {
    object: 'Date',
    property: 'now',
    message: 'AR-05/AR-24: domain/ takes the current time as an argument.',
  },
];

const domainOnlySyntax = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'AR-05/AR-24: domain/ takes the current time as an argument; no new Date().',
  },
];

export default defineConfig(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'data/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        // Type-aware linting: no-floating-promises needs type information.
        projectService: true,
        tsconfigRootDir: rootDir,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error', // DV-02
      '@typescript-eslint/no-non-null-assertion': 'error', // DV-03
      '@typescript-eslint/no-floating-promises': 'error', // an un-awaited write is silent data loss
      'no-console': 'error', // DV-11, AR-45: NestJS Logger only
    },
  },
  // AR-09, one block per module so each module is allowed its own files.
  ...modules.map((self) => ({
    files: [`src/${self}/**/*.ts`],
    rules: {
      'no-restricted-imports': ['error', { patterns: [crossModulePatterns(self)] }],
    },
  })),
  // AR-05 (later blocks win, so the domain blocks repeat the AR-09 patterns of their module).
  ...modules.map((self) => ({
    files: [`src/${self}/**/domain/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: domainImportRule.paths,
          patterns: [...domainImportRule.patterns, crossModulePatterns(self)],
        },
      ],
      'no-restricted-properties': ['error', ...domainOnlyProperties],
      'no-restricted-syntax': ['error', ...domainOnlySyntax],
    },
  })),
  {
    // Plain JS/MJS (this config) has no tsconfig project to type-check against.
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
);

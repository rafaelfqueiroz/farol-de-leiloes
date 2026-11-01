// Run from the pre-commit hook (root husky + lint-staged); this directory is the tasks' cwd, so the
// package's own prettier, eslint and eslint-suppressions.json are used (DV-12, TS-30).
const config = {
  '*.{ts,tsx,js,jsx,mjs,cjs}': [
    'prettier --write --ignore-unknown',
    // --pass-on-unpruned-suppressions: fixing a legacy violation must not fail the commit;
    // `npm run lint:prune` shrinks eslint-suppressions.json afterwards.
    'eslint --fix --no-warn-ignored --pass-on-unpruned-suppressions',
  ],
  '*.{json,css,md,yml,yaml}': 'prettier --write --ignore-unknown',
};

export default config;

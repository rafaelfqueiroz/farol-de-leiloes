// SPEC-003 BR-003-06..BR-003-10 (TESTING §10): the Lighthouse CI configuration. The reference
// profile, the budgets and the route groups are in perf/budgets.cjs; `npm run test:perf` is the
// way to run it (perf/run.mjs brings up the full-catalog stack first).
const { buildConfig } = require('./perf/lighthouse-config.cjs');

module.exports = buildConfig(process.env);

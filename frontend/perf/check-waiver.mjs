// SPEC-003 BR-003-10: reads a release's notes on stdin and exits 0 with the waiver's reason on
// stdout when they carry a valid `Performance waiver: <reason>` line (perf/waiver.mjs), 1 when
// they do not. The release-gate job of .github/workflows/performance.yml pipes
// `gh release view <tag> --json body --jq .body` into it.
import { findWaiver } from './waiver.mjs';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

const reason = findWaiver(Buffer.concat(chunks).toString('utf8'));
if (reason === null) {
  process.stderr.write('No "Performance waiver: <reason>" line in the release notes.\n');
  process.exit(1);
}
// A single line with no control characters: it is echoed into the job summary.
process.stdout.write(`${reason.replace(/[\u0000-\u001f\u007f]/g, ' ')}\n`);

// DV-37: the pre-push hook checks only the packages a push changes. The selection lives in
// `.husky/lib/changed-packages.sh`, a POSIX sh function, so it is driven here through `sh`
// with fabricated file lists instead of a real push.
import { spawnSync } from 'child_process';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');

function select(files: string[]): string[] {
  const result = spawnSync(
    'sh',
    ['-c', `. "${join(root, '.husky', 'lib', 'changed-packages.sh')}"; select_packages`],
    { input: files.join('\n') + '\n', encoding: 'utf8' },
  );
  expect(result.status).toBe(0);
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(' ')[0] as string);
}

describe('pre-push package selection (DV-37)', () => {
  it('checks only the backend for a backend-only change', () => {
    expect(select(['backend/src/auctions/auctions.service.ts'])).toEqual(['backend']);
  });

  it('checks only the frontend for a frontend-only change', () => {
    expect(select(['frontend/app/page.tsx', 'frontend/lib/money.ts'])).toEqual(['frontend']);
  });

  it('checks both packages when each changes', () => {
    expect(select(['backend/package.json', 'frontend/package.json'])).toEqual([
      'backend',
      'frontend',
    ]);
  });

  it.each([
    '.node-version',
    'docker-compose.yml',
    'package.json',
    'package-lock.json',
    '.husky/pre-push',
    '.husky/lib/changed-packages.sh',
    '.prettierrc.json',
    'eslint.config.mjs',
  ])('checks both packages when the shared root file %s changes', (file) => {
    expect(select([file])).toEqual(['backend', 'frontend']);
  });

  it.each([
    ['docs only', ['docs/guidelines/DEVELOPMENT.md', 'docs/adr/README.md']],
    ['.github only', ['.github/pull_request_template.md', '.github/workflows/ci.yml']],
    ['docs and .github', ['docs/runbooks/README.md', '.github/workflows/ci.yml']],
    ['other root files', ['CLAUDE.md', 'SECURITY.md', '.gitignore']],
    ['nothing', []],
  ])('checks neither package for %s', (_name, files) => {
    expect(select(files)).toEqual([]);
  });

  it('still checks the backend when a docs change rides along with it', () => {
    expect(select(['docs/guidelines/DEVELOPMENT.md', 'backend/src/main.ts'])).toEqual(['backend']);
  });
});

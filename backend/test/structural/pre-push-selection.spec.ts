// DV-37: the pre-push hook checks only the packages a push changes, measured from every pushed
// ref and run on the revision being pushed. The selection lives in
// `.husky/lib/changed-packages.sh`, a POSIX sh function, so it is driven here through `sh`
// with fabricated file lists; the whole hook is driven against scratch git repos (each with a
// bare origin) fed the real pre-push stdin format.
import { spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
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

// ---------------------------------------------------------------------------------------------
// The whole hook, against scratch repositories.
// ---------------------------------------------------------------------------------------------

const ZEROS = '0'.repeat(40);

/** Environment without the git variables a surrounding hook may have set. */
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX']) delete env[key];
  return env;
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv() });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

interface Repo {
  dir: string;
  origin: string;
}

const scratchDirs: string[] = [];

/** A scratch repository on `main`, with the hook installed, a bare origin and `origin/main`. */
function makeRepo(checkScript = 'echo checked'): Repo {
  const base = mkdtempSync(join(tmpdir(), 'pre-push-spec-'));
  scratchDirs.push(base);
  const dir = join(base, 'work');
  const origin = join(base, 'origin.git');
  mkdirSync(dir);
  git(base, 'init', '--bare', '-b', 'main', origin);
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'spec@example.com');
  git(dir, 'config', 'user.name', 'Spec');
  git(dir, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, '.husky', 'lib'), { recursive: true });
  copyFileSync(join(root, '.husky', 'pre-push'), join(dir, '.husky', 'pre-push'));
  copyFileSync(
    join(root, '.husky', 'lib', 'changed-packages.sh'),
    join(dir, '.husky', 'lib', 'changed-packages.sh'),
  );
  for (const pkg of ['backend', 'frontend']) {
    mkdirSync(join(dir, pkg));
    writeFileSync(
      join(dir, pkg, 'package.json'),
      JSON.stringify({ name: pkg, version: '1.0.0', scripts: { check: checkScript } }),
    );
  }
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', 'README.md'), 'docs\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'initial');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '-u', 'origin', 'main');
  return { dir, origin };
}

/** Commits a change to `file` (created if needed) on the branch, then returns to the previous one. */
function commitOnBranch(repo: Repo, branch: string, file: string, from = 'main'): string {
  const previous = git(repo.dir, 'rev-parse', '--abbrev-ref', 'HEAD');
  git(repo.dir, 'checkout', '-B', branch, from);
  mkdirSync(join(repo.dir, file, '..'), { recursive: true });
  writeFileSync(join(repo.dir, file), `${branch} ${Math.random()}\n`);
  git(repo.dir, 'add', '-A');
  git(repo.dir, 'commit', '-m', `${branch}: change ${file}`);
  const sha = git(repo.dir, 'rev-parse', 'HEAD');
  git(repo.dir, 'checkout', previous);
  return sha;
}

function pushLine(ref: string, localSha: string, remoteSha = ZEROS, remoteRef = ref): string {
  return `${ref} ${localSha} ${remoteRef} ${remoteSha}`;
}

interface HookRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runHook(repo: Repo, lines: string[], dryRun = true): HookRun {
  const result = spawnSync('sh', ['.husky/pre-push', 'origin', repo.origin], {
    cwd: repo.dir,
    input: lines.join('\n') + '\n',
    encoding: 'utf8',
    env: cleanEnv(dryRun ? { PRE_PUSH_DRY_RUN: '1' } : {}),
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function checkedLines(output: string): string[] {
  return output.split('\n').filter((line) => line.startsWith('pre-push: checking '));
}

function worktreeCount(repo: Repo): number {
  return git(repo.dir, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree ')).length;
}

describe('pre-push hook on the refs being pushed (DV-37)', () => {
  afterAll(() => {
    for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
  });

  it('selects a non-checked-out branch with backend changes and checks it in a worktree', () => {
    const repo = makeRepo();
    const sha = commitOnBranch(repo, 'feature', 'backend/src/a.ts');
    expect(git(repo.dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');

    const run = runHook(repo, [pushLine('refs/heads/feature', sha)]);

    expect(run.status).toBe(0);
    const checks = checkedLines(run.stdout);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toContain('checking backend');
    expect(checks[0]).toContain('refs/heads/feature');
    expect(checks[0]).toContain('in a temporary worktree');
    expect(checks[0]).toContain('not the checked-out HEAD');
    expect(run.stdout).toContain('merge-base with origin/main');
    expect(worktreeCount(repo)).toBe(1);
  });

  it('gives each ref of an --all style push its own package', () => {
    const repo = makeRepo();
    const backendSha = commitOnBranch(repo, 'be', 'backend/src/a.ts');
    const frontendSha = commitOnBranch(repo, 'fe', 'frontend/app/page.tsx');

    const run = runHook(repo, [
      pushLine('refs/heads/be', backendSha),
      pushLine('refs/heads/fe', frontendSha),
    ]);

    expect(run.status).toBe(0);
    const checks = checkedLines(run.stdout);
    expect(checks).toHaveLength(2);
    expect(checks[0]).toMatch(/checking backend .* for refs\/heads\/be at /);
    expect(checks[1]).toMatch(/checking frontend .* for refs\/heads\/fe at /);
    expect(run.stdout).not.toMatch(/checking backend .* for refs\/heads\/fe/);
    expect(run.stdout).not.toMatch(/checking frontend .* for refs\/heads\/be/);
  });

  it('measures a new remote branch from the merge-base with origin/main', () => {
    const repo = makeRepo();
    git(repo.dir, 'checkout', '-b', 'feature');
    writeFileSync(join(repo.dir, 'backend', 'a.ts'), 'a\n');
    git(repo.dir, 'add', '-A');
    git(repo.dir, 'commit', '-m', 'backend');
    writeFileSync(join(repo.dir, 'docs', 'README.md'), 'later docs\n');
    git(repo.dir, 'add', '-A');
    git(repo.dir, 'commit', '-m', 'docs');
    const sha = git(repo.dir, 'rev-parse', 'HEAD');

    const run = runHook(repo, [pushLine('refs/heads/feature', sha, ZEROS)]);

    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/new remote branch/);
    expect(run.stdout).toContain('merge-base with origin/main');
    const checks = checkedLines(run.stdout);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toContain('checking backend');
  });

  it('falls back to the merge-base when the remote revision is unknown locally', () => {
    const repo = makeRepo();
    const sha = commitOnBranch(repo, 'feature', 'frontend/app/x.tsx');

    const run = runHook(repo, [pushLine('refs/heads/feature', sha, 'a'.repeat(40))]);

    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/remote revision aaaaaaa is not available locally/);
    expect(run.stdout).toContain('merge-base with origin/main');
    const checks = checkedLines(run.stdout);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toContain('checking frontend');
  });

  it('measures an update of an existing remote branch from the remote revision', () => {
    const repo = makeRepo();
    const first = commitOnBranch(repo, 'feature', 'backend/src/a.ts');
    git(repo.dir, 'push', 'origin', `${first}:refs/heads/feature`);
    git(repo.dir, 'checkout', 'feature');
    writeFileSync(join(repo.dir, 'frontend', 'x.tsx'), 'x\n');
    git(repo.dir, 'add', '-A');
    git(repo.dir, 'commit', '-m', 'frontend');
    const second = git(repo.dir, 'rev-parse', 'HEAD');

    const run = runHook(repo, [pushLine('refs/heads/feature', second, first)]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`remote revision ${first.slice(0, 7)}`);
    const checks = checkedLines(run.stdout);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toContain('checking frontend');
  });

  it('skips a push that only deletes refs', () => {
    const repo = makeRepo();
    const run = runHook(repo, [pushLine('(delete)', ZEROS, 'b'.repeat(40), 'refs/heads/old')]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('deleting a remote ref, skipped');
    expect(run.stdout).toContain('nothing to check');
    expect(checkedLines(run.stdout)).toEqual([]);
  });

  it('skips a delete but still checks the other refs of the same push', () => {
    const repo = makeRepo();
    const sha = commitOnBranch(repo, 'feature', 'backend/src/a.ts');
    const run = runHook(repo, [
      pushLine('(delete)', ZEROS, 'b'.repeat(40), 'refs/heads/old'),
      pushLine('refs/heads/feature', sha),
    ]);

    expect(run.status).toBe(0);
    expect(checkedLines(run.stdout)).toHaveLength(1);
  });

  it('checks the checked-out HEAD in place when the package is clean', () => {
    const repo = makeRepo();
    git(repo.dir, 'checkout', '-b', 'feature');
    writeFileSync(join(repo.dir, 'backend', 'a.ts'), 'a\n');
    git(repo.dir, 'add', '-A');
    git(repo.dir, 'commit', '-m', 'backend');
    const sha = git(repo.dir, 'rev-parse', 'HEAD');
    // A dirty change in the OTHER package does not matter for the backend.
    writeFileSync(join(repo.dir, 'frontend', 'package.json'), '{"dirty":true}\n');

    const run = runHook(repo, [pushLine('refs/heads/feature', sha)]);

    expect(run.status).toBe(0);
    const checks = checkedLines(run.stdout);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toContain('checking backend');
    expect(checks[0]).toContain('in place');
    expect(checks[0]).not.toContain('worktree');
  });

  it.each([
    [
      'an unstaged change',
      (dir: string) => writeFileSync(join(dir, 'backend', 'package.json'), '{"dirty":1}\n'),
    ],
    [
      'an untracked file',
      (dir: string) => writeFileSync(join(dir, 'backend', 'untracked.ts'), 'u\n'),
    ],
    [
      'a staged change',
      (dir: string) => {
        writeFileSync(join(dir, 'backend', 'staged.ts'), 's\n');
        git(dir, 'add', 'backend/staged.ts');
      },
    ],
  ])('checks HEAD in a worktree when the package has %s', (_name, dirty) => {
    const repo = makeRepo();
    git(repo.dir, 'checkout', '-b', 'feature');
    writeFileSync(join(repo.dir, 'backend', 'a.ts'), 'a\n');
    git(repo.dir, 'add', '-A');
    git(repo.dir, 'commit', '-m', 'backend');
    const sha = git(repo.dir, 'rev-parse', 'HEAD');
    dirty(repo.dir);

    const run = runHook(repo, [pushLine('refs/heads/feature', sha)]);

    expect(run.status).toBe(0);
    const checks = checkedLines(run.stdout);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toContain('in a temporary worktree');
    expect(checks[0]).toContain('uncommitted changes');
  });

  it('checks neither package for a docs-only push', () => {
    const repo = makeRepo();
    const sha = commitOnBranch(repo, 'docs', 'docs/guidelines/NEW.md');

    const run = runHook(repo, [pushLine('refs/heads/docs', sha)]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('no package changed');
    expect(run.stdout).toContain('nothing to check');
    expect(checkedLines(run.stdout)).toEqual([]);
  });

  it('checks a revision pushed under two refs only once per package', () => {
    const repo = makeRepo();
    const sha = commitOnBranch(repo, 'one', 'backend/src/a.ts');

    const run = runHook(repo, [pushLine('refs/heads/one', sha), pushLine('refs/heads/two', sha)]);

    expect(run.status).toBe(0);
    expect(checkedLines(run.stdout)).toHaveLength(1);
    expect(run.stdout).toContain('already planned for another pushed ref');
  });

  it('selects both packages, and says why, when no base can be computed', () => {
    const repo = makeRepo();
    const sha = commitOnBranch(repo, 'feature', 'docs/only.md');
    git(repo.dir, 'update-ref', '-d', 'refs/remotes/origin/main');

    const run = runHook(repo, [pushLine('refs/heads/feature', sha)]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('no origin/main to compare with, selecting both packages');
    expect(checkedLines(run.stdout)).toHaveLength(2);
  });

  describe('real run in a temporary worktree', () => {
    // The fake package has no package-lock.json, so the hook runs `npm install` (a real package
    // has a lockfile and gets `npm ci`). Its `check` reports where and on what revision it ran.
    const report = 'echo CHECK_PWD=$PWD && echo CHECK_REV=$(git rev-parse HEAD)';

    it('creates, uses and removes the worktree when the check passes', () => {
      const repo = makeRepo(report);
      const sha = commitOnBranch(repo, 'feature', 'backend/src/a.ts');
      const mainSha = git(repo.dir, 'rev-parse', 'HEAD');

      const run = runHook(repo, [pushLine('refs/heads/feature', sha)], false);

      expect(run.status).toBe(0);
      expect(run.stdout).toContain('in a temporary worktree');
      const pwd = /^CHECK_PWD=(.*)$/m.exec(run.stdout)?.[1] ?? '';
      expect(pwd).toMatch(/worktree[/\\]backend$/);
      expect(pwd.startsWith(repo.dir)).toBe(false);
      expect(run.stdout).toContain(`CHECK_REV=${sha}`);
      expect(run.stdout).not.toContain(`CHECK_REV=${mainSha}`);
      expect(existsSync(pwd)).toBe(false);
      expect(worktreeCount(repo)).toBe(1);
      expect(git(repo.dir, 'worktree', 'list')).not.toContain('worktree');
      expect(git(repo.dir, 'status', '--porcelain')).toBe('');
    }, 120_000);

    it('removes the worktree and fails the push when the check fails', () => {
      const repo = makeRepo(`${report} && exit 1`);
      const sha = commitOnBranch(repo, 'feature', 'backend/src/a.ts');

      const run = runHook(repo, [pushLine('refs/heads/feature', sha)], false);

      expect(run.status).toBe(1);
      expect(run.stdout).toContain(`CHECK_REV=${sha}`);
      expect(run.stderr).toContain('backend check FAILED');
      expect(run.stderr).toContain('TS-30');
      const pwd = /^CHECK_PWD=(.*)$/m.exec(run.stdout)?.[1] ?? '';
      expect(existsSync(pwd)).toBe(false);
      expect(worktreeCount(repo)).toBe(1);
    }, 120_000);

    it('checks every ref and exits 1 when any of them fails', () => {
      const repo = makeRepo(report);
      const good = commitOnBranch(repo, 'good', 'frontend/app/x.tsx');
      // Only the backend of this branch fails its check.
      git(repo.dir, 'checkout', '-B', 'bad', 'main');
      writeFileSync(
        join(repo.dir, 'backend', 'package.json'),
        JSON.stringify({ name: 'backend', version: '1.0.0', scripts: { check: 'exit 1' } }),
      );
      git(repo.dir, 'add', '-A');
      git(repo.dir, 'commit', '-m', 'bad backend');
      const bad = git(repo.dir, 'rev-parse', 'HEAD');
      git(repo.dir, 'checkout', 'main');

      const run = runHook(
        repo,
        [pushLine('refs/heads/bad', bad), pushLine('refs/heads/good', good)],
        false,
      );

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('backend check FAILED for refs/heads/bad');
      expect(run.stdout).toContain(`CHECK_REV=${good}`);
      expect(worktreeCount(repo)).toBe(1);
    }, 120_000);

    it('runs a clean checked-out HEAD in place, without a worktree', () => {
      const repo = makeRepo(report);
      git(repo.dir, 'checkout', '-b', 'feature');
      writeFileSync(join(repo.dir, 'backend', 'a.ts'), 'a\n');
      git(repo.dir, 'add', '-A');
      git(repo.dir, 'commit', '-m', 'backend');
      const sha = git(repo.dir, 'rev-parse', 'HEAD');

      const run = runHook(repo, [pushLine('refs/heads/feature', sha)], false);

      expect(run.status).toBe(0);
      const pwd = /^CHECK_PWD=(.*)$/m.exec(run.stdout)?.[1] ?? '';
      expect(pwd).toMatch(/work[/\\]backend$/);
      expect(run.stdout).toContain(`CHECK_REV=${sha}`);
    }, 120_000);
  });
});

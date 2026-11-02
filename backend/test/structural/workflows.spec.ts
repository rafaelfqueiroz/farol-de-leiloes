// SC-21: GitHub Actions pinned to a commit SHA, least-privilege `permissions:`, no
// `pull_request_target`; DV-05: CI reads Node from `.node-version`. Checks every workflow in
// .github/workflows/.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  actionReferences,
  findForbiddenTriggers,
  findMissingPermissions,
  findNodeVersionProblems,
  findUnpinnedActions,
  findWorkflowProblems,
} from './workflow-check';

const root = join(__dirname, '..', '..', '..');
const workflowsDir = join(root, '.github', 'workflows');
const workflows = readdirSync(workflowsDir).filter((name) => /\.ya?ml$/.test(name));

const SHA = 'a'.repeat(40);

describe('SC-21 / DV-05: the repository workflows', () => {
  it('exist', () => {
    expect(workflows).toEqual(expect.arrayContaining(['ci.yml', 'codeql.yml']));
  });

  it.each(workflows)('%s follows the workflow rules', (name) => {
    const content = readFileSync(join(workflowsDir, name), 'utf8');
    expect(findWorkflowProblems(`.github/workflows/${name}`, content)).toEqual([]);
  });
});

describe('action pinning', () => {
  it('reads each uses: with its comment', () => {
    const content = [
      `      - uses: actions/checkout@${SHA} # v7.0.1`,
      `        uses: 'github/codeql-action/init@${SHA}'`,
    ].join('\n');
    expect(actionReferences(content)).toEqual([
      { line: 1, ref: `actions/checkout@${SHA}`, comment: 'v7.0.1' },
      { line: 2, ref: `github/codeql-action/init@${SHA}`, comment: '' },
    ]);
  });

  it('accepts a SHA pin with a version comment, and a local action', () => {
    const content = [
      `      - uses: actions/checkout@${SHA} # v7.0.1`,
      `      - uses: github/codeql-action/analyze@${SHA} # v4.39.1`,
      '      - uses: ./.github/actions/setup',
    ].join('\n');
    expect(findUnpinnedActions('ci.yml', content)).toEqual([]);
  });

  it('rejects a tag, a branch and a short SHA', () => {
    const content = [
      '      - uses: actions/checkout@v7',
      '      - uses: actions/setup-node@main # v7.1.0',
      '      - uses: actions/upload-artifact@cf430e0 # v7.0.2',
    ].join('\n');
    expect(findUnpinnedActions('ci.yml', content)).toEqual([
      'ci.yml:1: "actions/checkout@v7" is not pinned to a 40-character commit SHA',
      'ci.yml:2: "actions/setup-node@main" is not pinned to a 40-character commit SHA',
      'ci.yml:3: "actions/upload-artifact@cf430e0" is not pinned to a 40-character commit SHA',
    ]);
  });

  it('rejects a Docker action, which is not a commit pin', () => {
    expect(findUnpinnedActions('ci.yml', '      - uses: docker://alpine:3')).toHaveLength(1);
  });

  it('requires the version comment on a SHA pin', () => {
    const content = [`      - uses: actions/checkout@${SHA}`, `      - uses: x/y@${SHA} # v7`].join(
      '\n',
    );
    expect(findUnpinnedActions('ci.yml', content)).toEqual([
      `ci.yml:1: "actions/checkout@${SHA}" needs a "# vX.Y.Z" comment naming its version`,
      `ci.yml:2: "x/y@${SHA}" needs a "# vX.Y.Z" comment naming its version`,
    ]);
  });
});

describe('triggers and permissions', () => {
  it('rejects pull_request_target and workflow_run, in either form', () => {
    const content = ['on:', '  pull_request_target:', 'on: [push, workflow_run]'].join('\n');
    expect(findForbiddenTriggers('w.yml', content)).toEqual([
      'w.yml:2: "pull_request_target" is not allowed (SC-21)',
      'w.yml:3: "workflow_run" is not allowed (SC-21)',
    ]);
  });

  it('ignores a trigger named only in a comment', () => {
    expect(findForbiddenTriggers('w.yml', '# no pull_request_target here')).toEqual([]);
  });

  it('requires top-level permissions, not just per job', () => {
    expect(findMissingPermissions('w.yml', 'name: CI\npermissions: {}\n')).toEqual([]);
    expect(findMissingPermissions('w.yml', 'jobs:\n  a:\n    permissions:\n')).toEqual([
      'w.yml: declares no top-level "permissions:" (SC-21)',
    ]);
  });
});

describe('Node version in CI (DV-05)', () => {
  const setupNode = `      - uses: actions/setup-node@${SHA} # v7.1.0`;

  it('accepts setup-node reading node-version-file', () => {
    const content = [
      setupNode,
      '        with:',
      '          node-version-file: .node-version',
      '      - run: npm ci',
    ].join('\n');
    expect(findNodeVersionProblems('ci.yml', content)).toEqual([]);
  });

  it('rejects node-version, and setup-node without node-version-file', () => {
    const content = [
      setupNode,
      '        with:',
      '          node-version: 24',
      '      - run: npm ci',
      `      - name: Node`,
      `        uses: actions/setup-node@${SHA} # v7.1.0`,
      '      - run: node -v',
      '        env:',
      '          node-version-file: not-this-step',
    ].join('\n');
    expect(findNodeVersionProblems('ci.yml', content)).toEqual([
      'ci.yml:3: sets "node-version"; use "node-version-file" (DV-05)',
      'ci.yml:1: setup-node without "node-version-file" (DV-05)',
      'ci.yml:6: setup-node without "node-version-file" (DV-05)',
    ]);
  });
});

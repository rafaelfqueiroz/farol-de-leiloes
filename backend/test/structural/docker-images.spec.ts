// SC-16: no `.env*` file can reach an image's build context; the images run as a non-root user.
// Checks every Dockerfile at the root and in each package (the deploy images, DEVELOPMENT §12).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { findDockerImageProblems, finalStageUser, ignoresEnvFiles } from './docker-image-check.js';

const root = join(import.meta.dirname, '..', '..', '..');

function dockerfiles(): string[] {
  return ['.', 'backend', 'frontend'].flatMap((dir) =>
    readdirSync(join(root, dir))
      .filter((name) => /^Dockerfile$/.test(name))
      .map((name) => join(dir, name)),
  );
}

describe('SC-16: the repository Dockerfiles', () => {
  it('include the backend and frontend images', () => {
    expect(dockerfiles()).toEqual(['backend/Dockerfile', 'frontend/Dockerfile']);
  });

  it.each(dockerfiles())('%s keeps .env* out and runs as non-root', (file) => {
    const ignore = join(root, file, '..', '.dockerignore');
    const dockerignore = existsSync(ignore) ? readFileSync(ignore, 'utf8') : undefined;
    expect(
      findDockerImageProblems(file, readFileSync(join(root, file), 'utf8'), dockerignore),
    ).toEqual([]);
  });
});

describe('docker image checks', () => {
  const nonRoot = 'FROM node:24.22.2-slim AS build\nUSER root\nFROM node:24.22.2-slim\nUSER node\n';

  it('accepts a .dockerignore that excludes .env*', () => {
    expect(ignoresEnvFiles('node_modules\n.env*\n')).toBe(true);
    expect(findDockerImageProblems('Dockerfile', nonRoot, '.env*\n')).toEqual([]);
  });

  it('rejects a missing .dockerignore and one that lists only .env', () => {
    expect(findDockerImageProblems('Dockerfile', nonRoot, undefined)).toEqual([
      'Dockerfile: has no .dockerignore next to it (SC-16)',
    ]);
    expect(findDockerImageProblems('Dockerfile', nonRoot, '.env\n')).toEqual([
      'Dockerfile: its .dockerignore does not exclude ".env*" (SC-16)',
    ]);
  });

  it('reads the user of the final stage only', () => {
    expect(finalStageUser(nonRoot)).toBe('node');
    expect(finalStageUser('FROM a\nUSER node\nFROM b\n')).toBeUndefined();
  });

  it('rejects a final stage that runs as root', () => {
    for (const dockerfile of ['FROM a\n', 'FROM a\nUSER root\n', 'FROM a\nUSER 0\n']) {
      expect(findDockerImageProblems('Dockerfile', dockerfile, '.env*')).toEqual([
        'Dockerfile: the final stage runs as root; add a non-root USER',
      ]);
    }
  });
});

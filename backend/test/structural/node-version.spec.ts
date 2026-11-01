// DV-05: Node 24 LTS, one exact version, pinned everywhere. A future CI workflow reads
// `node-version-file: .node-version`, so the root file is the source of truth guarded here.
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import {
  findNodeVersionDrift,
  nodeImageTags,
  versionFromImageTag,
  type PinnedVersion,
} from './node-version-check';

const root = join(__dirname, '..', '..', '..');
const read = (file: string): string => readFileSync(join(root, file), 'utf8');
const nodeVersionFile = (file: string): string => read(file).trim();
const enginesNode = (file: string): string => {
  const pkg: { engines?: { node?: string } } = JSON.parse(read(file));
  return pkg.engines?.node ?? '(missing engines.node)';
};

function dockerfiles(): string[] {
  const found: string[] = [];
  for (const dir of ['.', 'backend', 'frontend']) {
    for (const name of readdirSync(join(root, dir))) {
      if (/^Dockerfile(\..+)?$/.test(name) || /\.Dockerfile$/.test(name)) {
        found.push(relative(root, join(root, dir, name)));
      }
    }
  }
  return found;
}

function repositoryPins(): PinnedVersion[] {
  const pins: PinnedVersion[] = [
    { file: 'backend/.node-version', version: nodeVersionFile('backend/.node-version') },
    { file: 'frontend/.node-version', version: nodeVersionFile('frontend/.node-version') },
    { file: 'backend/package.json (engines.node)', version: enginesNode('backend/package.json') },
    { file: 'frontend/package.json (engines.node)', version: enginesNode('frontend/package.json') },
  ];
  for (const file of ['docker-compose.yml', ...dockerfiles()]) {
    if (!existsSync(join(root, file))) continue;
    for (const tag of nodeImageTags(read(file))) {
      pins.push({ file: `${file} (node:${tag})`, version: versionFromImageTag(tag) });
    }
  }
  return pins;
}

describe('DV-05: Node version is pinned to one exact version everywhere', () => {
  it('every pin equals the root .node-version', () => {
    expect(findNodeVersionDrift(nodeVersionFile('.node-version'), repositoryPins())).toEqual([]);
  });

  it('pins the Compose images, so the node: image check is not vacuous', () => {
    const compose = nodeImageTags(read('docker-compose.yml'));
    expect(compose.length).toBeGreaterThan(0);
  });
});

describe('findNodeVersionDrift', () => {
  const ok: PinnedVersion[] = [
    { file: 'backend/.node-version', version: '24.22.2' },
    { file: 'docker-compose.yml (node:24.22.2-slim)', version: '24.22.2' },
  ];

  it('reports nothing when every pin agrees', () => {
    expect(findNodeVersionDrift('24.22.2', ok)).toEqual([]);
  });

  it('names the file that drifts', () => {
    const drifted = [...ok, { file: 'frontend/package.json (engines.node)', version: '>=20' }];
    expect(findNodeVersionDrift('24.22.2', drifted)).toEqual([
      'frontend/package.json (engines.node): pins ">=20" but .node-version is "24.22.2"',
    ]);
  });

  it('catches a patch-level mismatch', () => {
    const drifted = [{ file: 'docker-compose.yml (node:24.22.1-slim)', version: '24.22.1' }];
    expect(findNodeVersionDrift('24.22.2', drifted)).toHaveLength(1);
  });

  it('rejects a root .node-version that is not exact', () => {
    expect(findNodeVersionDrift('24', [])).toEqual([
      '.node-version: "24" is not an exact x.y.z version',
    ]);
  });
});

describe('node image parsing', () => {
  it('reads exact tags from Compose and Dockerfile lines', () => {
    const content = [
      '    image: node:24.22.2-slim',
      'FROM node:24.22.2-alpine AS build',
      '    image: mongo:7',
    ].join('\n');
    expect(nodeImageTags(content)).toEqual(['24.22.2-slim', '24.22.2-alpine']);
  });

  it('keeps a floating tag as is so it fails the exact-version check', () => {
    expect(versionFromImageTag('24-slim')).toBe('24-slim');
    expect(versionFromImageTag('24.22.2-slim')).toBe('24.22.2');
    expect(
      findNodeVersionDrift('24.22.2', [{ file: 'f', version: versionFromImageTag('lts') }]),
    ).toHaveLength(1);
  });
});

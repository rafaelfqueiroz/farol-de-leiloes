// DV-05: one exact Node version, pinned everywhere. Kept pure so the drift check itself is testable.

export interface PinnedVersion {
  /** Repository-relative path of the file that pins the version. */
  file: string;
  /** What that file pins, e.g. `24.22.2`, or an image tag such as `24-slim` when it is not exact. */
  version: string;
}

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

/** `24.22.2-slim` -> `24.22.2`; a floating tag such as `24-slim` or `lts` is returned as is. */
export function versionFromImageTag(tag: string): string {
  const match = /^(\d+\.\d+\.\d+)(?:-.+)?$/.exec(tag);
  return match?.[1] ?? tag;
}

/** Every `node:<tag>` image reference in a Compose file or Dockerfile. */
export function nodeImageTags(content: string): string[] {
  const tags: string[] = [];
  for (const line of content.split('\n')) {
    const match = /^\s*(?:image:\s*|FROM\s+(?:--platform=\S+\s+)?)["']?node:([^\s"'@]+)/i.exec(line);
    if (match?.[1]) tags.push(match[1]);
  }
  return tags;
}

/**
 * Returns one message per pin that is not an exact version or that differs from `expected`
 * (the root `.node-version`, which every other pin must equal).
 */
export function findNodeVersionDrift(expected: string, pins: PinnedVersion[]): string[] {
  const problems: string[] = [];
  if (!EXACT_VERSION.test(expected)) {
    problems.push(`.node-version: "${expected}" is not an exact x.y.z version`);
  }
  for (const pin of pins) {
    if (pin.version !== expected) {
      problems.push(`${pin.file}: pins "${pin.version}" but .node-version is "${expected}"`);
    }
  }
  return problems;
}

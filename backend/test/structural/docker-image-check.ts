// SC-16 and least privilege for the deploy images (DEVELOPMENT §12): every Dockerfile has a
// `.dockerignore` next to it that keeps `.env*` out of the build context, and its final stage
// runs as a non-root user. The exact Node tag is node-version-check.ts's job (DV-05).
// Line-based and pure, so the checks themselves are tested.

const ROOT_USERS = new Set(['root', '0', '0:0', 'root:root']);

/** True when the ignore file excludes every `.env*` file with a single pattern. */
export function ignoresEnvFiles(dockerignore: string): boolean {
  return dockerignore.split('\n').some((line) => ['.env*', '**/.env*'].includes(line.trim()));
}

/** The user the final stage runs as, or `undefined` when it never sets one (root). */
export function finalStageUser(dockerfile: string): string | undefined {
  let user: string | undefined;
  for (const line of dockerfile.split('\n')) {
    const from = /^\s*FROM\s/i.test(line);
    const set = /^\s*USER\s+(\S+)/i.exec(line);
    if (from) user = undefined;
    else if (set?.[1]) user = set[1];
  }
  return user;
}

/** One message per rule a Dockerfile breaks; `dockerignore` is undefined when there is none. */
export function findDockerImageProblems(
  file: string,
  dockerfile: string,
  dockerignore: string | undefined,
): string[] {
  const problems: string[] = [];
  if (dockerignore === undefined) {
    problems.push(`${file}: has no .dockerignore next to it (SC-16)`);
  } else if (!ignoresEnvFiles(dockerignore)) {
    problems.push(`${file}: its .dockerignore does not exclude ".env*" (SC-16)`);
  }
  const user = finalStageUser(dockerfile);
  if (user === undefined || ROOT_USERS.has(user)) {
    problems.push(`${file}: the final stage runs as root; add a non-root USER`);
  }
  return problems;
}

// AR-44: every variable the config schema reads is listed in .env.example with a comment, and the
// file lists nothing the schema does not read. Line-based and pure, so the check itself is tested.

const KEY_LINE = /^([A-Z][A-Z0-9_]*)=/;

/** The keys the file assigns, in order. */
export function exampleKeys(example: string): string[] {
  return example
    .split('\n')
    .map((line) => KEY_LINE.exec(line.trim())?.[1])
    .filter((key): key is string => key !== undefined);
}

/** One message per AR-44 problem: a key missing, a stale key, or a key with no comment above it. */
export function findEnvExampleProblems(example: string, schemaKeys: readonly string[]): string[] {
  const problems: string[] = [];
  const lines = example.split('\n').map((line) => line.trim());
  const listed = exampleKeys(example);

  for (const key of schemaKeys) {
    if (!listed.includes(key))
      problems.push(`${key}: read by the schema, missing from .env.example`);
  }
  for (const key of listed) {
    if (!schemaKeys.includes(key)) problems.push(`${key}: in .env.example, not read by the schema`);
  }
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    const key = KEY_LINE.exec(line)?.[1];
    if (key === undefined) return;
    if (seen.has(key)) problems.push(`${key}: listed more than once`);
    seen.add(key);
    if (!lines[index - 1]?.startsWith('#')) {
      problems.push(`${key}: needs a comment line directly above it`);
    }
  });
  return problems;
}

const SECRET_NAME = /(SECRET|PASS|KEY|TOKEN|_ID)$/;
const PLACEHOLDER = /^$|fake|replace|your-|example|changeme|placeholder/i;

/** The key=value pairs the file assigns (the value verbatim, unquoted, without a trailing comment). */
export function exampleValues(example: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of example.split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) values[match[1] as string] = (match[2] as string).replace(/^["']|["']$/g, '');
  }
  return values;
}

/**
 * SC-16: a secret-looking variable (name ends in SECRET, PASS, KEY, TOKEN or _ID) holds an obvious
 * placeholder (empty, `fake-...`, `replace-...`, `your-...`, `example`), never a realistic value.
 */
export function findFilledInSecrets(example: string): string[] {
  return Object.entries(exampleValues(example))
    .filter(([key, value]) => SECRET_NAME.test(key) && !PLACEHOLDER.test(value))
    .map(([key]) => `${key}: holds a value that does not look like a placeholder`);
}

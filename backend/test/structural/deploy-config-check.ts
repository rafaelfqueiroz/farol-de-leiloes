// ADR-004, DV-35, AR-44: the production runtime configuration comes from the GitHub
// `deploy-production` environment. deploy/render-env.sh lists every value it renders (ENTRIES),
// .github/workflows/deploy.yml maps exactly those names from the right context in its
// `&runtime-config` anchor, and every step that runs render-env.sh uses that anchor. Together with
// backend/.env.example this keeps a new variable from being forgotten on the way to production.
// Line-based and pure (no YAML or shell parser), so the checks themselves are tested.

export type Source = 'secret' | 'variable';

export interface RendererEntry {
  name: string;
  source: Source;
  /** The env file it is written to, without `.env`. */
  file: string;
  /** `required`, `optional` or `llm:<provider>`. */
  need: string;
}

const ENTRY =
  /^"([A-Z][A-Z0-9_]*)\s+(secret|variable)\s+([a-z]+)\s+(required|optional|llm:[a-z]+)"$/;
const MAPPING = /^([A-Z][A-Z0-9_]*):\s*(.*?)\s*$/;
const STEP_START = /^\s*-\s+(name|uses|id|run|if|env):/;
const RUNTIME_ENV = /^\s*env:\s*[&*]runtime-config\s*$/;

/** The items of a `readonly NAME=(` … `)` array in a bash script, comments and blanks skipped. */
export function bashArray(script: string, name: string): string[] {
  const lines = script.split('\n');
  const start = lines.findIndex((line) => line.trim() === `readonly ${name}=(`);
  if (start === -1) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const text = line.trim();
    if (text === ')') break;
    if (text !== '' && !text.startsWith('#')) items.push(text);
  }
  return items;
}

/** render-env.sh's ENTRIES; an item that does not parse is returned in `malformed`. */
export function rendererEntries(script: string): {
  entries: RendererEntry[];
  malformed: string[];
} {
  const entries: RendererEntry[] = [];
  const malformed: string[] = [];
  for (const item of bashArray(script, 'ENTRIES')) {
    const match = ENTRY.exec(item);
    if (match) {
      const [, name, source, file, need] = match as unknown as [
        string,
        string,
        Source,
        string,
        string,
      ];
      entries.push({ name, source, file, need });
    } else {
      malformed.push(item);
    }
  }
  return { entries, malformed };
}

/** The names of a constants array such as BACKEND_CONSTANTS (`"PORT=3000"` → `PORT`). */
export function constantNames(script: string, array: string): string[] {
  return bashArray(script, array).map((item) => item.replace(/^"/, '').split('=')[0] ?? '');
}

/** The `env: &runtime-config` block of a workflow, as name → expression. */
export function runtimeConfigMapping(workflow: string): Record<string, string> {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => /^\s*env:\s*&runtime-config\s*$/.test(line));
  const mapping: Record<string, string> = {};
  if (start === -1) return mapping;
  const indent = (lines[start] ?? '').search(/\S/);
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (line.search(/\S/) <= indent) break;
    const match = MAPPING.exec(line.trim());
    if (match) mapping[match[1] as string] = match[2] as string;
  }
  return mapping;
}

/** The expression deploy.yml must use for an entry. */
export function expectedExpression(entry: RendererEntry): string {
  const context = entry.source === 'secret' ? 'secrets' : 'vars';
  return `\${{ ${context}.${entry.name} }}`;
}

/** One message per name mapped wrongly, missing from the mapping, or unknown to the renderer. */
export function findMappingProblems(
  entries: readonly RendererEntry[],
  mapping: Record<string, string>,
): string[] {
  const problems: string[] = [];
  for (const entry of entries) {
    const actual = mapping[entry.name];
    const expected = expectedExpression(entry);
    if (actual === undefined) {
      problems.push(`${entry.name}: rendered by render-env.sh, not mapped in deploy.yml`);
    } else if (actual !== expected) {
      problems.push(`${entry.name}: mapped as ${actual} in deploy.yml, expected ${expected}`);
    }
  }
  const known = new Set(entries.map((entry) => entry.name));
  for (const name of Object.keys(mapping)) {
    if (!known.has(name)) problems.push(`${name}: mapped in deploy.yml, unknown to render-env.sh`);
  }
  return problems;
}

/**
 * The steps that run render-env.sh, each as `{ line, usesRuntimeConfig }`: whether the step's own
 * lines include `env: &runtime-config` or `env: *runtime-config`.
 */
export function renderSteps(workflow: string): { line: number; usesRuntimeConfig: boolean }[] {
  const lines = workflow.split('\n');
  const steps: { line: number; usesRuntimeConfig: boolean }[] = [];
  lines.forEach((text, index) => {
    if (!text.includes('render-env.sh') || text.trim().startsWith('#')) return;
    let start = index;
    while (start > 0 && !/^\s*-\s/.test(lines[start] ?? '')) start -= 1;
    const step = lines.slice(start, index + 1);
    if (!STEP_START.test(lines[start] ?? '')) return;
    steps.push({ line: index + 1, usesRuntimeConfig: step.some((line) => RUNTIME_ENV.test(line)) });
  });
  return steps;
}

/**
 * The backend names the renderer writes (entries for backend.env and the BACKEND_CONSTANTS) are
 * exactly the keys of backend/.env.example except NODE_ENV, which comes from the image; each once.
 */
export function findCoverageProblems(
  entries: readonly RendererEntry[],
  backendConstants: readonly string[],
  exampleKeys: readonly string[],
): string[] {
  const problems: string[] = [];
  const rendered = [
    ...entries.filter((entry) => entry.file === 'backend').map((entry) => entry.name),
    ...backendConstants,
  ];
  const expected = exampleKeys.filter((key) => key !== 'NODE_ENV');
  for (const key of expected) {
    if (!rendered.includes(key)) {
      problems.push(`${key}: in backend/.env.example, not rendered to backend.env`);
    }
  }
  for (const name of rendered) {
    if (!expected.includes(name)) {
      problems.push(`${name}: rendered to backend.env, not in backend/.env.example`);
    }
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.name)) problems.push(`${entry.name}: listed more than once`);
    seen.add(entry.name);
  }
  return problems;
}

/** The `{$NAME}` placeholders a Caddyfile reads from its environment. */
export function caddyPlaceholders(caddyfile: string): string[] {
  const names = new Set<string>();
  for (const match of caddyfile.matchAll(/\{\$([A-Z][A-Z0-9_]*)\}/g)) names.add(match[1] as string);
  return [...names].sort();
}

const SECRET_LOOKING = /(SECRET|PASS|_KEY|TOKEN|_URI$|_DSN$)/;

/** SC-16: a secret-looking name comes from an environment secret, never a variable. */
export function findSecretSourceProblems(entries: readonly RendererEntry[]): string[] {
  return entries
    .filter((entry) => SECRET_LOOKING.test(entry.name) && entry.source !== 'secret')
    .map((entry) => `${entry.name}: looks like a secret, so it must be an environment secret`);
}

/**
 * The entries marked `required` are exactly `required`, and each `llm:<provider>` entry is the key
 * that provider needs (LLM_PROVIDER_KEY), every cloud provider having one.
 */
export function findRequirementProblems(
  entries: readonly RendererEntry[],
  required: readonly string[],
  llmKeys: Readonly<Record<string, string>>,
): string[] {
  const problems: string[] = [];
  const marked = entries.filter((entry) => entry.need === 'required').map((entry) => entry.name);
  for (const name of required) {
    if (!marked.includes(name)) problems.push(`${name}: required in production, not marked so`);
  }
  for (const name of marked) {
    if (!required.includes(name)) problems.push(`${name}: marked required, optional in production`);
  }
  const llm = entries.filter((entry) => entry.need.startsWith('llm:'));
  for (const [provider, key] of Object.entries(llmKeys)) {
    if (!llm.some((entry) => entry.need === `llm:${provider}` && entry.name === key)) {
      problems.push(`${key}: must be marked llm:${provider}`);
    }
  }
  for (const entry of llm) {
    if (llmKeys[entry.need.slice('llm:'.length)] !== entry.name) {
      problems.push(`${entry.name}: marked ${entry.need}, which is not that provider's key`);
    }
  }
  return problems;
}

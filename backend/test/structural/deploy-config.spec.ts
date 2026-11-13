// ADR-004, DV-35, AR-44: every variable of backend/.env.example (except NODE_ENV, from the image)
// reaches production through deploy/render-env.sh and the `&runtime-config` mapping of
// .github/workflows/deploy.yml, from the right kind of GitHub value, with the schema's production
// requirements, and nothing unknown is mapped. A variable added to the schema and .env.example
// (env-example.spec.ts) fails here until it is added to both deploy files.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ZodType } from 'zod';
import { ENV_KEYS, LLM_PROVIDER_KEY, envSchema } from '../../src/config/env.schema';
import { exampleKeys } from './env-example-check';
import {
  type RendererEntry,
  bashArray,
  caddyPlaceholders,
  constantNames,
  findCoverageProblems,
  findMappingProblems,
  findRequirementProblems,
  findSecretSourceProblems,
  renderSteps,
  rendererEntries,
  runtimeConfigMapping,
} from './deploy-config-check';

const root = join(__dirname, '..', '..', '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

// What production requires beyond the schema's own required keys: the log hash key (the schema's
// superRefine, AR-46) and the proxy hop count (Caddy is one hop; the default 0 breaks SC-04).
const PRODUCTION_REQUIRED = ['LOG_HASH_SECRET', 'TRUST_PROXY_HOPS'];

/** The keys the schema rejects when absent: no default and not optional. */
function schemaRequiredKeys(): string[] {
  const shape = envSchema.shape as Record<string, ZodType>;
  return ENV_KEYS.filter((key) => !shape[key]?.safeParse(undefined).success);
}

describe('ADR-004: production configuration from the deploy-production environment', () => {
  const script = read('deploy/render-env.sh');
  const workflow = read('.github/workflows/deploy.yml');
  const { entries, malformed } = rendererEntries(script);
  const caddyNames = caddyPlaceholders(read('deploy/Caddyfile'));

  it('render-env.sh lists its entries in the expected shape', () => {
    expect(malformed).toEqual([]);
    expect(entries.length).toBeGreaterThan(0);
  });

  it('renders every backend/.env.example key but NODE_ENV, and nothing else', () => {
    const constants = constantNames(script, 'BACKEND_CONSTANTS');
    expect(
      findCoverageProblems(entries, constants, exampleKeys(read('backend/.env.example'))),
    ).toEqual([]);
  });

  it('renders exactly the placeholders the Caddyfile reads to caddy.env, and the frontend constant', () => {
    const caddy = entries.filter((entry) => entry.file === 'caddy').map((entry) => entry.name);
    expect(caddy.sort()).toEqual(caddyNames);
    expect(entries.every((entry) => ['caddy', 'backend'].includes(entry.file))).toBe(true);
    expect(constantNames(script, 'FRONTEND_CONSTANTS')).toEqual(['BACKEND_API_URL']);
  });

  it('deploy.yml maps every entry from its secret or variable, and nothing unknown', () => {
    expect(findMappingProblems(entries, runtimeConfigMapping(workflow))).toEqual([]);
  });

  it('runs render-env.sh only in steps that use the runtime-config mapping (check and render)', () => {
    const steps = renderSteps(workflow);
    expect(steps).toHaveLength(2);
    expect(steps.filter((step) => !step.usesRuntimeConfig)).toEqual([]);
  });

  it('keeps secret-looking values in environment secrets (SC-16)', () => {
    expect(findSecretSourceProblems(entries)).toEqual([]);
  });

  it('marks as required what production requires, and each LLM key for its provider', () => {
    const required = [...schemaRequiredKeys(), ...PRODUCTION_REQUIRED, ...caddyNames];
    expect(findRequirementProblems(entries, required, LLM_PROVIDER_KEY)).toEqual([]);
  });
});

describe('deploy config checks', () => {
  const entry = (
    name: string,
    source: RendererEntry['source'],
    need = 'required',
    file = 'backend',
  ): RendererEntry => ({ name, source, file, need });

  it('reads a bash array, its entries and constants', () => {
    const script = [
      'readonly ENTRIES=(',
      '  # a comment',
      '  "A_KEY        secret    backend  required"',
      '  "B_URL        variable  caddy    llm:groq"',
      '  "broken line"',
      ')',
      'readonly BACKEND_CONSTANTS=(',
      '  "PORT=3000"',
      ')',
    ].join('\n');
    expect(bashArray(script, 'MISSING')).toEqual([]);
    expect(rendererEntries(script)).toEqual({
      entries: [entry('A_KEY', 'secret'), entry('B_URL', 'variable', 'llm:groq', 'caddy')],
      malformed: ['"broken line"'],
    });
    expect(constantNames(script, 'BACKEND_CONSTANTS')).toEqual(['PORT']);
  });

  it('reads the runtime-config block and its steps', () => {
    const workflow = [
      '      - name: Check',
      '        env: &runtime-config',
      '          A_KEY: ${{ secrets.A_KEY }}',
      '          # comment',
      '          B_URL: ${{ vars.B_URL }}',
      '        run: bash deploy/render-env.sh check',
      '      - name: Render',
      '        env: *runtime-config',
      '        run: |',
      '          bash deploy/render-env.sh render "$DIR"',
      '      # render-env.sh in a comment is not a step',
      '      - name: Elsewhere',
      '        run: bash deploy/render-env.sh check',
    ].join('\n');
    expect(runtimeConfigMapping(workflow)).toEqual({
      A_KEY: '${{ secrets.A_KEY }}',
      B_URL: '${{ vars.B_URL }}',
    });
    expect(renderSteps(workflow)).toEqual([
      { line: 6, usesRuntimeConfig: true },
      { line: 10, usesRuntimeConfig: true },
      { line: 13, usesRuntimeConfig: false },
    ]);
  });

  it('reports a wrong source, a missing mapping and an unknown one', () => {
    const entries = [entry('A_KEY', 'secret'), entry('B_URL', 'variable')];
    expect(
      findMappingProblems(entries, { A_KEY: '${{ vars.A_KEY }}', C_X: '${{ vars.C_X }}' }),
    ).toEqual([
      'A_KEY: mapped as ${{ vars.A_KEY }} in deploy.yml, expected ${{ secrets.A_KEY }}',
      'B_URL: rendered by render-env.sh, not mapped in deploy.yml',
      'C_X: mapped in deploy.yml, unknown to render-env.sh',
    ]);
  });

  it('reports a forgotten key, an unknown one and a duplicate', () => {
    const entries = [entry('A_KEY', 'secret'), entry('A_KEY', 'secret'), entry('Z', 'variable')];
    expect(findCoverageProblems(entries, ['PORT'], ['NODE_ENV', 'PORT', 'A_KEY', 'B'])).toEqual([
      'B: in backend/.env.example, not rendered to backend.env',
      'Z: rendered to backend.env, not in backend/.env.example',
      'A_KEY: listed more than once',
    ]);
  });

  it('reads Caddyfile placeholders', () => {
    expect(caddyPlaceholders('{$B} {\n}\nwww.{$A} {\n redir https://{$B}{uri}\n}')).toEqual([
      'A',
      'B',
    ]);
  });

  it('reports a secret-looking variable', () => {
    expect(
      findSecretSourceProblems([entry('SMTP_PASS', 'variable'), entry('SMTP_USER', 'variable')]),
    ).toEqual(['SMTP_PASS: looks like a secret, so it must be an environment secret']);
  });

  it('reports a requirement mismatch and a misplaced LLM key', () => {
    const entries = [
      entry('A', 'variable'),
      entry('B', 'variable', 'optional'),
      entry('GROQ_API_KEY', 'secret', 'llm:openai'),
    ];
    expect(
      findRequirementProblems(entries, ['B'], {
        groq: 'GROQ_API_KEY',
        openai: 'OPENAI_API_KEY',
      }),
    ).toEqual([
      'B: required in production, not marked so',
      'A: marked required, optional in production',
      'GROQ_API_KEY: must be marked llm:groq',
      'OPENAI_API_KEY: must be marked llm:openai',
      "GROQ_API_KEY: marked llm:openai, which is not that provider's key",
    ]);
  });
});

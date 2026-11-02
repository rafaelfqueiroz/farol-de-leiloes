// SC-21 and DV-05 for GitHub Actions workflows: every action pinned to a commit SHA (with the
// version it stands for in a comment), least-privilege `permissions:` declared at the top level,
// no `pull_request_target` or `workflow_run` trigger, and Node taken from `.node-version`.
// Line-based on purpose (no YAML dependency), and kept pure so the checks themselves are tested.

export interface ActionReference {
  /** 1-based line number in the workflow. */
  line: number;
  /** What follows `uses:`, e.g. `actions/checkout@<sha>`. */
  ref: string;
  /** The trailing comment without `#`, e.g. `v7.0.1`; empty when there is none. */
  comment: string;
}

const USES = /^\s*(?:-\s+)?uses:\s*["']?([^\s"'#]+)["']?\s*(?:#\s*(.*?))?\s*$/;
const PINNED = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}$/;
const VERSION_COMMENT = /^v\d+\.\d+\.\d+$/;
const FORBIDDEN_TRIGGERS = /\b(pull_request_target|workflow_run)\b/;

const lines = (content: string): string[] => content.split('\n');
const indentOf = (line: string): number => line.length - line.trimStart().length;
const isBlankOrComment = (line: string): boolean => /^\s*(#.*)?$/.test(line);
/** The line without a trailing ` # comment` (a `#` inside a value is rare enough to ignore). */
const withoutComment = (line: string): string => line.replace(/(^|\s)#.*$/, '');

/** Every `uses:` in a workflow, in order. */
export function actionReferences(content: string): ActionReference[] {
  const found: ActionReference[] = [];
  lines(content).forEach((text, index) => {
    const match = USES.exec(text);
    if (match?.[1]) found.push({ line: index + 1, ref: match[1], comment: match[2] ?? '' });
  });
  return found;
}

/**
 * One message per action that is not pinned to a full commit SHA with a `# vX.Y.Z` comment.
 * A local action (`./path`) is part of the repository and needs no pin.
 */
export function findUnpinnedActions(file: string, content: string): string[] {
  const problems: string[] = [];
  for (const { line, ref, comment } of actionReferences(content)) {
    if (ref.startsWith('./')) continue;
    if (!PINNED.test(ref)) {
      problems.push(`${file}:${line}: "${ref}" is not pinned to a 40-character commit SHA`);
    } else if (!VERSION_COMMENT.test(comment)) {
      problems.push(`${file}:${line}: "${ref}" needs a "# vX.Y.Z" comment naming its version`);
    }
  }
  return problems;
}

/** One message per `pull_request_target` or `workflow_run` outside a comment. */
export function findForbiddenTriggers(file: string, content: string): string[] {
  const problems: string[] = [];
  lines(content).forEach((text, index) => {
    const match = FORBIDDEN_TRIGGERS.exec(withoutComment(text));
    if (match) problems.push(`${file}:${index + 1}: "${match[1]}" is not allowed (SC-21)`);
  });
  return problems;
}

/** A message when the workflow has no top-level `permissions:` key. */
export function findMissingPermissions(file: string, content: string): string[] {
  return lines(content).some((text) => /^permissions:/.test(text))
    ? []
    : [`${file}: declares no top-level "permissions:" (SC-21)`];
}

/** The lines of the step that contains `line` (0-based), from its `- ` to the next step. */
function stepAround(all: string[], line: number): string[] {
  let start = line;
  while (start > 0 && !/^\s*-\s/.test(all[start] ?? '')) start -= 1;
  const dashIndent = indentOf(all[start] ?? '');
  let end = start + 1;
  while (end < all.length) {
    const text = all[end] ?? '';
    if (!isBlankOrComment(text) && indentOf(text) <= dashIndent) break;
    end += 1;
  }
  return all.slice(start, end);
}

/**
 * DV-05: every `actions/setup-node` step reads `node-version-file` and none sets
 * `node-version`, so CI runs the version in `.node-version` and nothing else.
 */
export function findNodeVersionProblems(file: string, content: string): string[] {
  const problems: string[] = [];
  const all = lines(content);
  all.forEach((text, index) => {
    if (/^\s*node-version:/.test(withoutComment(text))) {
      problems.push(`${file}:${index + 1}: sets "node-version"; use "node-version-file" (DV-05)`);
    }
  });
  for (const { line, ref } of actionReferences(content)) {
    if (!ref.startsWith('actions/setup-node@')) continue;
    const step = stepAround(all, line - 1);
    if (!step.some((text) => /^\s*node-version-file:/.test(text))) {
      problems.push(`${file}:${line}: setup-node without "node-version-file" (DV-05)`);
    }
  }
  return problems;
}

/** Every workflow rule above, for one file. */
export function findWorkflowProblems(file: string, content: string): string[] {
  return [
    ...findUnpinnedActions(file, content),
    ...findForbiddenTriggers(file, content),
    ...findMissingPermissions(file, content),
    ...findNodeVersionProblems(file, content),
  ];
}

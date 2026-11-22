// SPEC-010 BR-010-02, BR-010-07: the legal documents come from the API as Markdown. This is the
// small, safe renderer's parser (SC-20: no new dependency for a handful of constructs). It turns the
// text into a plain data tree; `LegalDocument` turns the tree into React elements. Nothing here
// produces HTML, so there is no `dangerouslySetInnerHTML` and no HTML pass-through: raw tags in the
// source are just text (React escapes them), and a link is only kept when it is http(s) or mailto.
//
// The subset: headings, paragraphs, bulleted and numbered lists (one level), tables, block quotes,
// horizontal rules, and in a line: **strong**, *emphasis*, `code`, [links](https://…) and
// backslash escapes. Anything else is shown as the text it is.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] };

export type Block =
  | { kind: 'heading'; level: number; children: Inline[] }
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { kind: 'quote'; paragraphs: Inline[][] }
  | { kind: 'rule' };

const MAX_INLINE_DEPTH = 4;
// Every scan below is linear in the length of the text it reads, and the text it reads is bounded:
// a legal document has short lines and short paragraphs, so anything longer is shown as the plain
// text it is and never parsed (no input of any length can make this renderer slow, SC-20).
const MAX_LINE_LENGTH = 2000;
const MAX_INLINE_LENGTH = 20_000;
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|>~<]/;

/** The URL itself when it is an absolute http(s) or mailto URL, else null (SC-20). */
export function safeHref(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '' || /[\s\u0000-\u001f]/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? trimmed : null;
  } catch {
    return null;
  }
}

function pushText(out: Inline[], text: string): void {
  if (text === '') return;
  const last = out[out.length - 1];
  if (last?.kind === 'text') last.text += text;
  else out.push({ kind: 'text', text });
}

/** `**strong**`, `*emphasis*`, `` `code` `` and `[text](url)` inside one line of text. */
export function parseInline(source: string, depth = 0): Inline[] {
  if (source.length > MAX_INLINE_LENGTH) return [{ kind: 'text', text: source }];
  const out: Inline[] = [];
  // where the next "](" and the next ")" after it are: found once and reused, so a run of "[" with
  // no link after it costs one scan, not one per "["
  let closeAt = -2;
  let endAt = -2;
  let i = 0;
  while (i < source.length) {
    const char = source.charAt(i);

    if (char === '\\' && i + 1 < source.length && ESCAPABLE.test(source.charAt(i + 1))) {
      pushText(out, source.charAt(i + 1));
      i += 2;
      continue;
    }

    if (char === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i + 1) {
        out.push({ kind: 'code', text: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (depth < MAX_INLINE_DEPTH && source.startsWith('**', i)) {
      const end = source.indexOf('**', i + 2);
      if (end > i + 2) {
        out.push({ kind: 'strong', children: parseInline(source.slice(i + 2, end), depth + 1) });
        i = end + 2;
        continue;
      }
    }

    if (depth < MAX_INLINE_DEPTH && char === '*' && !source.startsWith('**', i)) {
      const end = source.indexOf('*', i + 1);
      if (end > i + 1 && !/^\s/.test(source.charAt(i + 1))) {
        out.push({ kind: 'em', children: parseInline(source.slice(i + 1, end), depth + 1) });
        i = end + 1;
        continue;
      }
    }

    if (depth < MAX_INLINE_DEPTH && char === '[') {
      if (closeAt !== -1 && closeAt < i + 1) closeAt = source.indexOf('](', i + 1);
      const close = closeAt;
      if (close !== -1 && (endAt === -2 || (endAt !== -1 && endAt < close + 2))) {
        endAt = source.indexOf(')', close + 2);
      }
      const end = close === -1 ? -1 : endAt;
      if (close > i + 1 && end > close) {
        const label = source.slice(i + 1, close);
        const href = safeHref(source.slice(close + 2, end));
        // an unsafe or malformed target is not a link: the label stays as plain text
        if (href !== null)
          out.push({ kind: 'link', href, children: parseInline(label, depth + 1) });
        else pushText(out, label);
        i = end + 1;
        continue;
      }
    }

    pushText(out, char);
    i += 1;
  }
  return out;
}

function isSpace(char: string): boolean {
  return char === ' ' || char === '\t';
}

/** `# Title`, `## Title ##`: the level (1 to 6) and the text, or null. */
function headingOf(line: string): { level: number; text: string } | null {
  let level = 0;
  while (level < line.length && line.charAt(level) === '#') level += 1;
  if (level < 1 || level > 6 || !isSpace(line.charAt(level))) return null;
  let end = line.length;
  while (end > level && (isSpace(line.charAt(end - 1)) || line.charAt(end - 1) === '#')) end -= 1;
  // a closing run of hashes is dropped, but a text made only of them is kept as text
  return { level, text: line.slice(level, Math.max(end, level)).trim() };
}

/** The text of a list item (`- x`, `* x`, `+ x`, `1. x`, `1) x`), or null. */
function listItemOf(line: string, ordered: boolean): string | null {
  let i = 0;
  while (i < line.length && isSpace(line.charAt(i))) i += 1;
  if (ordered) {
    const digitsFrom = i;
    while (i < line.length && i - digitsFrom < 9 && /\d/.test(line.charAt(i))) i += 1;
    if (i === digitsFrom || !['.', ')'].includes(line.charAt(i))) return null;
  } else if (!['-', '*', '+'].includes(line.charAt(i))) {
    return null;
  }
  i += 1;
  if (!isSpace(line.charAt(i))) return null;
  return line.slice(i).trim();
}
const bulletOf = (line: string) => listItemOf(line, false);
const numberedOf = (line: string) => listItemOf(line, true);

/** `---`, `* * *`, `___`: three or more of one marker, with spaces allowed between. */
function isRule(line: string): boolean {
  const text = line.trim();
  const marker = text.charAt(0);
  if (!['-', '*', '_'].includes(marker)) return false;
  let count = 0;
  for (const char of text) {
    if (char === marker) count += 1;
    else if (!isSpace(char)) return false;
  }
  return count >= 3;
}

/** One cell of a table's separator row: `---`, `:--`, `--:`, `:-:`. */
function isSeparatorCell(cell: string): boolean {
  const text = cell.trim();
  let from = 0;
  let to = text.length;
  if (text.startsWith(':')) from = 1;
  if (to > from && text.endsWith(':')) to -= 1;
  if (to <= from) return false;
  for (let i = from; i < to; i += 1) if (text.charAt(i) !== '-') return false;
  return true;
}

/** The separator row under a table's header: every cell between the pipes is dashes. */
function isTableSeparator(line: string): boolean {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|')) body = body.slice(0, -1);
  return body !== '' && body.split('|').every(isSeparatorCell);
}

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  const body = line.trim().replace(/^\|/, '');
  for (let i = 0; i < body.length; i += 1) {
    const char = body.charAt(i);
    if (char === '\\' && body.charAt(i + 1) === '|') {
      current += '|';
      i += 1;
    } else if (char === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  // a row ends with "|" (an empty last cell is no cell) or with text
  if (current.trim() !== '' || !line.trim().endsWith('|')) cells.push(current.trim());
  return cells;
}

const startsBlock = (line: string): boolean =>
  headingOf(line) !== null ||
  bulletOf(line) !== null ||
  numberedOf(line) !== null ||
  isRule(line) ||
  line.trimStart().startsWith('>') ||
  line.trimStart().startsWith('|');

/** The document as blocks. Total: any text gives a tree, never an error. */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // a line this long is no heading, list or table: it is text, and plain text at that
    if (line.length > MAX_LINE_LENGTH) {
      blocks.push({ kind: 'paragraph', children: [{ kind: 'text', text: line.trim() }] });
      i += 1;
      continue;
    }

    const heading = headingOf(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading.level, children: parseInline(heading.text) });
      i += 1;
      continue;
    }

    if (isRule(line)) {
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    if (line.trimStart().startsWith('|') && isTableSeparator(lines[i + 1] ?? '')) {
      const header = splitRow(line).map((cell) => parseInline(cell));
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && (lines[i] ?? '').trimStart().startsWith('|')) {
        rows.push(splitRow(lines[i] ?? '').map((cell) => parseInline(cell)));
        i += 1;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    if (line.trimStart().startsWith('>')) {
      const paragraphs: Inline[][] = [];
      let current: string[] = [];
      const flush = () => {
        if (current.length > 0) paragraphs.push(parseInline(current.join(' ')));
        current = [];
      };
      while (i < lines.length && (lines[i] ?? '').trimStart().startsWith('>')) {
        const text = (lines[i] ?? '').trimStart().replace(/^>\s?/, '').trim();
        if (text === '') flush();
        else current.push(text);
        i += 1;
      }
      flush();
      blocks.push({ kind: 'quote', paragraphs });
      continue;
    }

    const bullet = bulletOf(line);
    const numbered = bullet === null ? numberedOf(line) : null;
    if (bullet !== null || numbered !== null) {
      const ordered = numbered !== null;
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? '';
        const item =
          current.length > MAX_LINE_LENGTH ? null : (ordered ? numberedOf : bulletOf)(current);
        if (item !== null) {
          items.push(item);
        } else if (current.trim() !== '' && /^\s+\S/.test(current) && items.length > 0) {
          // an indented continuation of the previous item
          items[items.length - 1] += ` ${current.trim()}`;
        } else {
          break;
        }
        i += 1;
      }
      blocks.push({ kind: 'list', ordered, items: items.map((item) => parseInline(item)) });
      continue;
    }

    const paragraph: string[] = [line.trim()];
    i += 1;
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !startsBlock(lines[i] ?? '')) {
      paragraph.push((lines[i] ?? '').trim());
      i += 1;
    }
    blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join(' ')) });
  }

  return blocks;
}

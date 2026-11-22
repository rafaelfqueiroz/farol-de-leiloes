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
  const out: Inline[] = [];
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
      const close = source.indexOf('](', i + 1);
      const end = close === -1 ? -1 : source.indexOf(')', close + 2);
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

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,9}[.)]\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

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
  HEADING.test(line) ||
  BULLET.test(line) ||
  NUMBERED.test(line) ||
  RULE.test(line) ||
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

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        children: parseInline(heading[2] ?? ''),
      });
      i += 1;
      continue;
    }

    if (RULE.test(line) && !BULLET.test(line)) {
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    if (line.trimStart().startsWith('|') && TABLE_SEPARATOR.test(lines[i + 1] ?? '')) {
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

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = numbered !== null;
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? '';
        const match = (ordered ? NUMBERED : BULLET).exec(current);
        if (match) {
          items.push((match[1] ?? '').trim());
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

import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, safeHref, type Block, type Inline } from './legal-markdown';

const text = (value: string): Inline => ({ kind: 'text', text: value });

describe('safeHref (SC-20)', () => {
  it.each([
    ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
    ['http://example.com', 'http://example.com'],
    ['mailto:privacidade@example.com', 'mailto:privacidade@example.com'],
  ])('keeps %s', (value, expected) => {
    expect(safeHref(value)).toBe(expected);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:x',
    'file:///etc/passwd',
    'ftp://example.com',
    '//evil.example',
    '/relative',
    'java\nscript:alert(1)',
    'https://exa mple.com',
    '',
    '   ',
  ])('refuses %j', (value) => {
    expect(safeHref(value)).toBeNull();
  });
});

describe('parseInline', () => {
  it('reads strong, emphasis, code and links', () => {
    expect(parseInline('a **b** *c* `d` [e](https://x.test)')).toEqual([
      text('a '),
      { kind: 'strong', children: [text('b')] },
      text(' '),
      { kind: 'em', children: [text('c')] },
      text(' '),
      { kind: 'code', text: 'd' },
      text(' '),
      { kind: 'link', href: 'https://x.test', children: [text('e')] },
    ]);
  });

  it('keeps an unsafe link as its label, never as a link', () => {
    // the target ends at the first ")", the rest of the text is only text
    expect(parseInline('[clique](javascript:alert(1))')).toEqual([text('clique)')]);
    expect(parseInline('[x](data:text/html;base64,AAAA)')).toEqual([text('x')]);
  });

  it('treats raw HTML as plain text', () => {
    expect(parseInline('<script>alert(1)</script><img src=x onerror=alert(1)>')).toEqual([
      text('<script>alert(1)</script><img src=x onerror=alert(1)>'),
    ]);
  });

  it('honours backslash escapes and leaves unclosed markers alone', () => {
    expect(parseInline('\\*não\\* **aberto [sem fim')).toEqual([text('*não* **aberto [sem fim')]);
  });

  it('stops nesting at a bounded depth instead of recursing without end', () => {
    const nested = `${'**a '.repeat(50)}${'**'.repeat(50)}`;

    expect(() => parseInline(nested)).not.toThrow();
  });

  it('does not take a lone asterisk followed by a space for emphasis', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([text('2 * 3 * 4')]);
  });
});

const kinds = (blocks: Block[]) => blocks.map((block) => block.kind);

describe('parseMarkdown', () => {
  it('reads headings, paragraphs, lists, quotes and rules', () => {
    const blocks = parseMarkdown(
      [
        '# Título',
        '',
        '> **Aviso.** Texto',
        '',
        '## Seção',
        '',
        'Uma linha',
        'continua.',
        '',
        '- um',
        '- dois',
        '  continua',
        '',
        '1. a',
        '2) b',
        '',
        '---',
      ].join('\n'),
    );

    expect(kinds(blocks)).toEqual([
      'heading',
      'quote',
      'heading',
      'paragraph',
      'list',
      'list',
      'rule',
    ]);
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 });
    expect(blocks[3]).toEqual({ kind: 'paragraph', children: [text('Uma linha continua.')] });
    expect(blocks[4]).toMatchObject({ kind: 'list', ordered: false });
    expect((blocks[4] as Extract<Block, { kind: 'list' }>).items[1]).toEqual([
      text('dois continua'),
    ]);
    expect(blocks[5]).toMatchObject({ kind: 'list', ordered: true });
  });

  it('reads a table with escaped pipes and inline code', () => {
    const [table] = parseMarkdown(
      [
        '| Campo | Finalidade |',
        '| --- | --- |',
        '| `name` | a \\| b |',
        '| e-mail | login |',
      ].join('\n'),
    );

    expect(table).toEqual({
      kind: 'table',
      header: [[text('Campo')], [text('Finalidade')]],
      rows: [
        [[{ kind: 'code', text: 'name' }], [text('a | b')]],
        [[text('e-mail')], [text('login')]],
      ],
    });
  });

  it('is total: hostile and malformed input gives a tree, never an error', () => {
    const hostile = [
      '<script>alert(1)</script>',
      '[x](javascript:alert(1))',
      '| a |',
      '|---|',
      '> > > deep',
      '#######',
      '- ',
      '\u0000‮',
      '*'.repeat(10_000),
      '['.repeat(10_000),
    ];
    for (const input of hostile) expect(() => parseMarkdown(input)).not.toThrow();
  });

  it('turns CRLF text into the same blocks as LF text', () => {
    expect(parseMarkdown('# a\r\n\r\ntexto\r\n')).toEqual(parseMarkdown('# a\n\ntexto\n'));
  });
});

// SC-20 (CodeQL js/polynomial-redos): no input of any length may make the renderer slow. The bound is
// generous (500 ms); the shapes below took seconds with the first version's regular expressions.
describe('adversarial input is parsed in linear time', () => {
  const BOUND_MS = 500;
  const spaces = (n: number) => ' '.repeat(n);
  const timed = (input: string) => {
    const started = performance.now();
    const blocks = parseMarkdown(input);
    const elapsed = performance.now() - started;
    return { blocks, elapsed };
  };

  it.each([
    ['a table separator of spaces around one pipe', `| a |\n${spaces(80_000)}|${spaces(80_000)}`],
    ['a separator that is dashes and spaces, then text', `| a |\n${'- '.repeat(80_000)}x`],
    ['a separator of dashes with one wrong cell', `| a |\n${'|---'.repeat(50_000)}|x`],
    ['a rule that is spaces and one marker, then text', `${'- '.repeat(100_000)}x`],
    ['a rule of underscores and spaces, then text', `${'_ '.repeat(100_000)}x`],
    [
      'a heading with a long run of spaces and hashes',
      `# ${spaces(100_000)}${'#'.repeat(1000)}${spaces(100_000)}x`,
    ],
    ['a heading of only hashes and spaces', `#${spaces(150_000)}`],
    ['200k opening brackets', '['.repeat(200_000)],
    ['brackets, then "](" and no ")"', `${'['.repeat(100_000)}](x`],
    ['brackets with a ")" far after', `${'[a'.repeat(50_000)}](${'x'.repeat(50_000)})`],
    ['a long run of pipes', '|'.repeat(200_000)],
    ['pipes and spaces', '| '.repeat(100_000)],
    ['100k asterisks', '*'.repeat(100_000)],
    ['100k "**"', '**'.repeat(100_000)],
    ['100k backticks', '`'.repeat(100_000)],
    ['100k backslashes', '\\'.repeat(100_000)],
    ['100k "> "', '> '.repeat(100_000)],
    ['100k list markers', '- '.repeat(100_000)],
    ['a list item with a long continuation', `- a\n${'  b\n'.repeat(50_000)}`],
    ['a long numbered marker run', `${'1'.repeat(100_000)}. x`],
    ['100k short lines', 'a\n'.repeat(100_000)],
    ['100k table rows', `| a |\n| - |\n${'| x |\n'.repeat(50_000)}`],
  ])('%s', (_label, input) => {
    const { blocks, elapsed } = timed(input);

    expect(blocks.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(BOUND_MS);
  });

  it('shows a paragraph or a line past the bound as plain text, never parsed', () => {
    const long = `**${'a'.repeat(25_000)}**`;
    const [paragraph] = parseMarkdown(long);

    expect(paragraph).toEqual({ kind: 'paragraph', children: [text(long)] });
    expect(parseMarkdown(`# ${'a'.repeat(3000)}`)[0]).toMatchObject({ kind: 'paragraph' });
  });

  it('still reads the shapes it reads when they are normal: the rewritten scans keep their meaning', () => {
    expect(parseMarkdown('## Título ##')[0]).toMatchObject({ kind: 'heading', level: 2 });
    expect(parseMarkdown('#semespaço')[0]).toMatchObject({ kind: 'paragraph' });
    expect(parseMarkdown('####### sete')[0]).toMatchObject({ kind: 'paragraph' });
    expect(parseMarkdown('* * *')[0]).toEqual({ kind: 'rule' });
    expect(parseMarkdown('- - -')[0]).toEqual({ kind: 'rule' });
    expect(parseMarkdown('--')[0]).toMatchObject({ kind: 'paragraph' });
    expect(parseMarkdown('| a |\n|:--|--:|:-:|\n| b |')[0]).toMatchObject({ kind: 'table' });
    expect(parseMarkdown('| a |\n| -x- |\n| b |')[0]).toMatchObject({ kind: 'paragraph' });
    expect(parseMarkdown('a\n---')[1]).toEqual({ kind: 'rule' });
    expect(parseMarkdown('12) item')[0]).toMatchObject({ kind: 'list', ordered: true });
    expect(parseMarkdown('1234567890. item')[0]).toMatchObject({ kind: 'paragraph' });
    expect(parseMarkdown('-sem espaço')[0]).toMatchObject({ kind: 'paragraph' });
  });
});

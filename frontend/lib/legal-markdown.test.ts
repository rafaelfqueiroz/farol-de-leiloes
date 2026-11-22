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

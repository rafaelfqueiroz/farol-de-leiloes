'use client';

import Box from '@mui/material/Box';
import MuiLink from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import GavelOutlined from '@mui/icons-material/GavelOutlined';
import { useTranslations } from 'next-intl';
import { Fragment, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '@/lib/legal-markdown';
import type { LegalDocumentType } from '@/lib/legal';
import DateText from './DateText';
import InlineAlert from './InlineAlert';
import PageHeader from './PageHeader';
import StatusBadge from './StatusBadge';

export interface LegalDocumentProps {
  kind: LegalDocumentType;
  /** The page's only <h1> (DS-15): the document's own title. */
  title: string;
  version: string;
  /** The ISO instant the version took effect; shown as a day in Brasília time. */
  effectiveAt: string;
  /** A placeholder text not yet reviewed by a lawyer (BR-010-26): the banner and the pill show. */
  draft: boolean;
  /** The document, in Markdown (the subset of `lib/legal-markdown.ts`). */
  content: string;
}

function InlineText({ nodes }: { nodes: readonly Inline[] }): ReactNode {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case 'text':
        return <Fragment key={index}>{node.text}</Fragment>;
      case 'strong':
        return (
          <Box component="strong" key={index} sx={{ fontWeight: 'fontWeightMedium' }}>
            <InlineText nodes={node.children} />
          </Box>
        );
      case 'em':
        return (
          <em key={index}>
            <InlineText nodes={node.children} />
          </em>
        );
      case 'code':
        return (
          <Box
            component="code"
            key={index}
            sx={(theme) => ({
              ...theme.typography.caption,
              fontFamily: 'ui-monospace, Menlo, monospace',
              bgcolor: 'background.muted',
              px: 0.5,
              borderRadius: 0.5,
            })}
          >
            {node.text}
          </Box>
        );
      case 'link':
        // only http(s) and mailto get here (safeHref); the document is read in the same tab
        return (
          <MuiLink key={index} href={node.href} rel="noopener noreferrer">
            <InlineText nodes={node.children} />
          </MuiLink>
        );
    }
  });
}

const plainText = (nodes: readonly Inline[]): string =>
  nodes
    .map((node) =>
      node.kind === 'text' || node.kind === 'code' ? node.text : plainText(node.children),
    )
    .join('');

function headingVariant(level: number): 'h3' | 'h4' | 'h5' {
  if (level <= 2) return 'h3';
  return level === 3 ? 'h4' : 'h5';
}

function BlockView({ block, previousHeading }: { block: Block; previousHeading: string | null }) {
  const t = useTranslations('patterns.legalDocument');
  switch (block.kind) {
    case 'heading': {
      // the page's h1 is the document title: the document's own headings start at h2 (DS-15)
      const level = Math.min(6, Math.max(2, block.level));
      return (
        <Typography
          variant={headingVariant(block.level)}
          component={`h${level}` as 'h2'}
          sx={{ mt: 1, textWrap: 'balance' }}
        >
          <InlineText nodes={block.children} />
        </Typography>
      );
    }
    case 'paragraph':
      return (
        <Typography variant="body1" sx={{ lineHeight: 1.625 }}>
          <InlineText nodes={block.children} />
        </Typography>
      );
    case 'list':
      return (
        <Box
          component={block.ordered ? 'ol' : 'ul'}
          sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}
        >
          {block.items.map((item, index) => (
            <Typography key={index} component="li" variant="body1" sx={{ lineHeight: 1.625 }}>
              <InlineText nodes={item} />
            </Typography>
          ))}
        </Box>
      );
    case 'quote':
      return (
        <Box
          component="blockquote"
          sx={{
            m: 0,
            pl: 2,
            borderLeft: 3,
            borderColor: 'divider',
            color: 'text.secondary',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          {block.paragraphs.map((paragraph, index) => (
            <Typography key={index} variant="body1">
              <InlineText nodes={paragraph} />
            </Typography>
          ))}
        </Box>
      );
    case 'rule':
      return (
        <Box
          component="hr"
          sx={{ width: '100%', border: 0, borderTop: 1, borderColor: 'divider' }}
        />
      );
    case 'table':
      return (
        // a wide table scrolls inside its own block, never the page (DS-13); focusable so a
        // keyboard can scroll it (axe: scrollable-region-focusable)
        <Box
          role="region"
          tabIndex={0}
          aria-label={previousHeading ? t('tableOf', { heading: previousHeading }) : t('table')}
          sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}
        >
          <Table size="small">
            <TableHead>
              <TableRow>
                {block.header.map((cell, index) => (
                  <TableCell
                    key={index}
                    component="th"
                    scope="col"
                    sx={{ fontWeight: 'fontWeightMedium' }}
                  >
                    <InlineText nodes={cell} />
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {block.rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {row.map((cell, index) => (
                    <TableCell key={index} sx={{ verticalAlign: 'top' }}>
                      <InlineText nodes={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      );
  }
}

/**
 * SPEC-010 BR-010-02, BR-010-07 (frame "Documentos legais"): one legal document as a reading page.
 * The page's `h1`, the version pill, the draft marker, the day it took effect in Brasília time, and
 * the text. The text is Markdown rendered into React elements by a small parser (no HTML, no
 * `dangerouslySetInnerHTML`, links only http(s) and mailto), so hostile text cannot inject anything.
 * The reading column is at most 72 characters wide.
 */
export default function LegalDocument({
  kind,
  title,
  version,
  effectiveAt,
  draft,
  content,
}: LegalDocumentProps) {
  const t = useTranslations('patterns.legalDocument');
  const parsed = parseMarkdown(content);
  // the document's own first heading repeats the page title
  const blocks = parsed[0]?.kind === 'heading' && parsed[0].level === 1 ? parsed.slice(1) : parsed;

  // a table is named after the heading above it
  const views = blocks.map((block, index) => {
    const above = blocks.slice(0, index).findLast((earlier) => earlier.kind === 'heading');
    const previousHeading = above?.kind === 'heading' ? plainText(above.children) : null;
    return <BlockView key={index} block={block} previousHeading={previousHeading} />;
  });

  return (
    <>
      <Stack spacing={1.5}>
        <PageHeader title={title} />
        <Stack
          direction="row"
          useFlexGap
          spacing={1.5}
          sx={{ flexWrap: 'wrap', alignItems: 'center' }}
        >
          <StatusBadge status="neutral" label={t('version', { version })} />
          {draft ? <StatusBadge status="late" label={t('draft')} /> : null}
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t.rich('effectiveSince', {
              date: () => <DateText value={effectiveAt} />,
            })}
          </Typography>
        </Stack>
      </Stack>
      <Box
        component="article"
        aria-label={t(`article.${kind}`)}
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: '72ch' }}
      >
        {draft ? (
          <InlineAlert
            severity="warning"
            role="status"
            icon={<GavelOutlined fontSize="inherit" />}
            title={t('draftBanner.title')}
          >
            {t('draftBanner.text')}
          </InlineAlert>
        ) : null}
        {views}
      </Box>
    </>
  );
}

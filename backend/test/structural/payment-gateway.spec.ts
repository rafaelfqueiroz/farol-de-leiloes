// AR-10 / AR-20: Stripe sits behind the PaymentGateway port. Only its adapter imports the `stripe`
// SDK, so the adapter is the only place money can become Stripe's integer centavos. Specs are
// exempt: they may use Stripe's own test helpers (e.g. signing a webhook payload locally).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..', '..', 'src');
const ADAPTER = 'payments/adapters/stripe-payment-gateway.ts';

// `from 'stripe'`, `from "stripe/…"`, `require('stripe')`, `import('stripe')`.
const STRIPE_IMPORT = /(?:from\s+|require\(\s*|import\(\s*)['"]stripe(?:\/[^'"]*)?['"]/;

function importsStripe(source: string): boolean {
  return STRIPE_IMPORT.test(source);
}

function sourceFiles(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .map((file) => relative(SRC, join(SRC, file)).split('\\').join('/'));
}

describe('AR-10: only the Stripe adapter imports stripe', () => {
  it('finds stripe imported by the adapter and by no other source file', () => {
    const importers = sourceFiles().filter((file) =>
      importsStripe(readFileSync(join(SRC, file), 'utf8')),
    );

    expect(importers).toEqual([ADAPTER]);
  });
});

describe('importsStripe', () => {
  it.each([
    "import Stripe from 'stripe';",
    'import type { Stripe } from "stripe";',
    "import { Stripe } from 'stripe/cjs/stripe.cjs.node.js';",
    "const Stripe = require('stripe');",
    "import Stripe = require('stripe');",
    "const s = await import('stripe');",
  ])('sees %s', (line) => {
    expect(importsStripe(line)).toBe(true);
  });

  it.each([
    "import { PaymentGateway } from './payment-gateway';",
    'const stripeCustomerId = user.stripeCustomerId;',
    "import { x } from 'stripe-like';",
    "import { y } from '@stripe/stripe-js';",
  ])('ignores %s', (line) => {
    expect(importsStripe(line)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { isBotProtectionPage } from './bot-protection.js';
import { readCaixaFixture } from '../../../test/support/fixtures.js';

describe('isBotProtectionPage (BR-004-20)', () => {
  it('recognises the captured Radware page', () => {
    expect(isBotProtectionPage(readCaixaFixture('bot-protection.html'))).toBe(true);
  });

  it('recognises a page that loads a script from the Radware CDN host, and no look-alike', () => {
    expect(
      isBotProtectionPage('<script src="https://cdn.perfdrive.com/aperture/a.js"></script>'),
    ).toBe(true);
    expect(isBotProtectionPage('<script src="//cdn.perfdrive.com/x.js"></script>')).toBe(true);
    expect(isBotProtectionPage('<script src="https://cdn.perfdrive.com.evil.example/x.js">')).toBe(
      false,
    );
  });

  it('does not take an ordinary detail page for a challenge', () => {
    expect(isBotProtectionPage(readCaixaFixture('sfi-auction.html'))).toBe(false);
  });

  it('reads at most the first 256 KiB of a body', () => {
    const filler = '<p>x</p>'.repeat(40 * 1024); // 320 KiB
    expect(isBotProtectionPage(`<p>Radware Bot Manager</p>${filler}`)).toBe(true);
    expect(isBotProtectionPage(`${filler}<p>Radware Bot Manager</p>`)).toBe(false);
    expect(isBotProtectionPage(`${filler}<script src="https://cdn.perfdrive.com/x.js">`)).toBe(
      false,
    );
  });
});

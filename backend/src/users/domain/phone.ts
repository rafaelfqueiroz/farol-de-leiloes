// BR-001-27: a phone is optional, and when given it is a valid Brazilian number with area code
// (DDD). Pure and framework-free (AR-05): the decorator that applies it to a DTO is
// users/dto/phone-field.decorator.ts.
//
//   (84) 99999-1234  → +5584999991234   mobile: DDD 84, 9 digits starting with 9
//   +55 84 3222-1234 → +558432221234    landline: DDD 84, 8 digits starting 2-5
//   99999-1234       → null             no DDD
//
// E.164 for Brazil is `+55`, the two-digit DDD and the 8 (landline) or 9 (mobile) digit number.

/** The area codes Anatel assigns: 67 codes. */
const AREA_CODES: ReadonlySet<string> = new Set([
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '21',
  '22',
  '24',
  '27',
  '28',
  '31',
  '32',
  '33',
  '34',
  '35',
  '37',
  '38',
  '41',
  '42',
  '43',
  '44',
  '45',
  '46',
  '47',
  '48',
  '49',
  '51',
  '53',
  '54',
  '55',
  '61',
  '62',
  '63',
  '64',
  '65',
  '66',
  '67',
  '68',
  '69',
  '71',
  '73',
  '74',
  '75',
  '77',
  '79',
  '81',
  '82',
  '83',
  '84',
  '85',
  '86',
  '87',
  '88',
  '89',
  '91',
  '92',
  '93',
  '94',
  '95',
  '96',
  '97',
  '98',
  '99',
]);

const MOBILE = /^9\d{8}$/; // nine digits, the first one 9
const LANDLINE = /^[2-5]\d{7}$/; // eight digits, the first one 2 to 5

/** The E.164 form (`+55DDNNNNNNNNN`) of a Brazilian phone, or null when it is not one. */
export function normalizeBrazilianPhone(input: string): string | null {
  const compact = input.replace(/[\s().-]/g, '');
  const international = compact.startsWith('+');
  const digits = international ? compact.slice(1) : compact;
  if (!/^\d+$/.test(digits)) return null;

  let national = digits;
  if (international) {
    if (!digits.startsWith('55')) return null;
    national = digits.slice(2);
  } else if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    // 12 or 13 digits cannot be a national number (10 or 11), so a leading 55 is the country.
    national = digits.slice(2);
  }

  if (!AREA_CODES.has(national.slice(0, 2))) return null;
  const subscriber = national.slice(2);
  if (!MOBILE.test(subscriber) && !LANDLINE.test(subscriber)) return null;
  return `+55${national}`;
}

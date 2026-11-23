import { describe, expect, it } from 'vitest';
import { propertyTypeFromDescription } from './property-type.js';

describe('propertyTypeFromDescription (BR-004-11 fallback)', () => {
  it.each([
    ['Casa, 94.28 de área privativa, 180.00 de área do terreno', 'Casa'],
    ['Apartamento, 62.30 de área total', 'Apartamento'],
    ['Terreno, 0.00 de área total, 1899.98 de área do terreno.', 'Terreno'],
    ['  APARTAMENTO, 40 m2', 'Apartamento'],
    ['Imóvel comercial, 100.00 de área total', 'Imóvel comercial'],
    ['Galpão, 500.00 de área total', 'Galpão'],
  ])('%j begins with the type %j', (description, expected) => {
    expect(propertyTypeFromDescription(description)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    '',
    '   ',
    'Sem tipo na descrição',
    ', 94.28 de área',
    'A, sozinha',
    '123, números',
    'Casa 94.28 sem vírgula',
    'Um texto muito longo que certamente não é um tipo de imóvel, mas uma frase',
  ])('is unknown (null) for %j', (description) => {
    expect(propertyTypeFromDescription(description)).toBeNull();
  });
});

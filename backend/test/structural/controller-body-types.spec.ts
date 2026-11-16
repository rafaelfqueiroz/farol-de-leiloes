// BR-001-31 (RNF-13): no request body is bound to a type that can carry a protected attribute. A
// controller @Body() must be a request DTO of its own, never UpdateUserDto / CreateUserDto (which
// name role, providers, Stripe ids...) nor a schema or entity class. Read from the source, so a
// new controller is checked the day it lands, like the OpenAPI contract spec.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(import.meta.dirname, '..', '..', 'src');
const FORBIDDEN = /^(UpdateUserDto|CreateUserDto|\w+Entity|\w+Document|\w+Schema)$/;

function controllerFiles(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((file) => file.endsWith('.controller.ts'))
    .map((file) => join(SRC, file));
}

/** The type names of every `@Body(...)` parameter in a source file. */
export function bodyTypes(source: string): string[] {
  return [...source.matchAll(/@Body\([^)]*\)\s*\w+\s*:\s*([\w.<>[\]]+)/g)].map((m) => m[1] ?? '');
}

describe('BR-001-31: controller bodies are request DTOs', () => {
  it('finds the controllers and their bodies', () => {
    const files = controllerFiles();
    expect(files.length).toBeGreaterThan(5);
    const auth = readFileSync(files.find((f) => f.endsWith('auth.controller.ts')) ?? '', 'utf8');
    expect(bodyTypes(auth)).toContain('UpdateProfileDto');
  });

  it.each(controllerFiles().map((file) => [file.slice(SRC.length + 1), file]))(
    '%s binds no body to a user, entity, document or schema type',
    (_name, file) => {
      const offenders = bodyTypes(readFileSync(file as string, 'utf8')).filter((type) =>
        FORBIDDEN.test(type),
      );
      expect(offenders).toEqual([]);
    },
  );

  it('the pattern would catch the forbidden types', () => {
    expect(bodyTypes('create(@Body() dto: UpdateUserDto) {}')).toEqual(['UpdateUserDto']);
    expect(bodyTypes('x(@CurrentUser() u: A, @Body() body: UserEntity) {}')).toEqual([
      'UserEntity',
    ]);
    expect(FORBIDDEN.test('UpdateUserDto')).toBe(true);
    expect(FORBIDDEN.test('UserDocument')).toBe(true);
    expect(FORBIDDEN.test('UpdateProfileDto')).toBe(false);
  });
});

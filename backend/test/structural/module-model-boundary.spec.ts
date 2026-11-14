// AR-09 / DV-09: importing no foreign schema is not enough: a connection's model registry can
// still reach another module's data. Production code uses its injected model or a public service;
// test harnesses may register models and are outside this scan.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

const SRC = join(import.meta.dirname, '..', '..', 'src');

function unwrap(expression: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

function memberName(expression: ts.Expression): string | undefined {
  const member = unwrap(expression);
  if (ts.isPropertyAccessExpression(member)) return member.name.text;
  if (ts.isElementAccessExpression(member) && ts.isStringLiteralLike(member.argumentExpression)) {
    return member.argumentExpression.text;
  }
  return undefined;
}

function isModelRegistry(expression: ts.Expression): boolean {
  const receiver = unwrap(expression);
  return (
    (ts.isIdentifier(receiver) && ['db', 'connection'].includes(receiver.text)) ||
    memberName(receiver) === 'db' ||
    memberName(receiver) === 'connection'
  );
}

function modelRegistryLookups(file: string, source: string): string[] {
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const lookups: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (
        (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
        memberName(callee) === 'model' &&
        isModelRegistry(callee.expression)
      ) {
        const { line } = syntax.getLineAndCharacterOfPosition(node.getStart(syntax));
        lookups.push(`${file}:${line + 1}: runtime model registry lookup bypasses AR-09`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return lookups;
}

describe('AR-09: production modules do not look up models through a connection registry', () => {
  it('uses injected models or exported services instead of db.model/connection.model', () => {
    const violations = (readdirSync(SRC, { recursive: true }) as string[])
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      .flatMap((file) => modelRegistryLookups(file, readFileSync(join(SRC, file), 'utf8')));

    expect(violations).toEqual([]);
  });
});

describe('runtime model registry detection', () => {
  it.each([
    "this.reminderModel.db.model('AuctionEntity')",
    "this.reminderModel['db']['model']('AuctionEntity')",
    "this.reminderModel[`db`][`model`]('AuctionEntity')",
    "this.reminderModel.db?.model?.('AuctionEntity')",
    "(this.reminderModel.db as Connection).model('AuctionEntity')",
    "connection.model('AuctionEntity')",
    "db.model('AuctionEntity')",
    "connection['model']('AuctionEntity')",
    "this.connection.model('AuctionEntity')",
    "mongoose.connection.model('AuctionEntity')",
    "this['connection']['model']('AuctionEntity')",
  ])('rejects %s', (source) => {
    expect(modelRegistryLookups('reminders/reminders.service.ts', source)).toEqual([
      'reminders/reminders.service.ts:1: runtime model registry lookup bypasses AR-09',
    ]);
  });

  it.each([
    '@InjectModel(ReminderEntity.name) private readonly reminders: Model<ReminderDocument>;',
    'MongooseModule.forFeature([{ name: ReminderEntity.name, schema: ReminderSchema }]);',
    'this.reminderModel.findOne({ _id: id });',
    'this.auctionsService.findDocumentById(id);',
    "import { ReminderSchema } from './schemas/reminder.schema';",
    "// this.reminderModel.db.model('AuctionEntity')",
    'const example = "connection.model(\'AuctionEntity\')";',
    "const unrelated = { model: 'house', connection: true };",
  ])('allows %s', (source) => {
    expect(modelRegistryLookups('reminders/reminders.service.ts', source)).toEqual([]);
  });

  it('reports the source location of each lookup', () => {
    const source = [
      '// model lookups must use service boundaries',
      "this.reminderModel.db.model('AuctionEntity');",
      "connection.model('UserEntity');",
    ].join('\n');

    expect(modelRegistryLookups('reminders/reminders.service.ts', source)).toEqual([
      'reminders/reminders.service.ts:2: runtime model registry lookup bypasses AR-09',
      'reminders/reminders.service.ts:3: runtime model registry lookup bypasses AR-09',
    ]);
  });
});

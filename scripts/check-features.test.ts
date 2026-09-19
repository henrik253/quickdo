import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkFeatures, extractTestCalls } from './check-features';

const YAML = `- id: F-001
  title: Capture bar
  practice: capture everything
  status: done
  tests:
    - src/a.test.ts#[F-001] Enter appends a row
- id: F-002
  title: Chips
  status: in-progress
  tests:
    - src/a.test.ts#[F-002] chips render
- id: F-003
  title: Hotkey
  status: planned
  tests: []
  manual:
    - "Press the hotkey"
`;

const TEST_SRC = `import { it, test, describe } from 'vitest';
describe('x', () => {
  it('[F-001] Enter appends a row', () => {});
  it.todo('[F-002] chips render');
  test("[F-001] double \\"quoted\\" title", () => {});
});
`;

// built from fragments so this file does not itself carry an unknown tag
const GHOST = ['[F-', '099]'].join('');

function fixture(yaml = YAML, tests: Record<string, string> = { 'src/a.test.ts': TEST_SRC }) {
  const root = mkdtempSync(join(tmpdir(), 'quickdo-features-'));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'features.yaml'), yaml);
  for (const [file, src] of Object.entries(tests)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), src);
  }
  return root;
}

describe('scripts/check-features.ts', () => {
  it('[F-024] extracts it()/test() titles with their modifiers and unescapes quotes', () => {
    const calls = extractTestCalls(TEST_SRC);
    expect(calls.map((c) => [c.title, c.modifiers])).toEqual([
      ['[F-001] Enter appends a row', []],
      ['[F-002] chips render', ['todo']],
      ['[F-001] double "quoted" title', []],
    ]);
    expect(calls[1].line).toBe(4);
  });

  it('[F-024] a consistent repo passes and renders the acceptance table', () => {
    const r = checkFeatures(fixture());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.acceptance).toContain('| F-001 | Capture bar | ✅ done | capture everything |');
    expect(r.acceptance).toContain('`src/a.test.ts#[F-001] Enter appends a row`');
    expect(r.acceptance).toContain('Press the hotkey');
    expect(r.acceptance).toContain('1 of 3 features done.');
  });

  it('[F-024] a done feature without tests fails', () => {
    const r = checkFeatures(
      fixture(YAML.replace('tests: []', 'tests: []').replace('status: planned', 'status: done')),
    );
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('F-003: status done but no tests listed');
  });

  it('[F-024] a missing test file fails', () => {
    const r = checkFeatures(
      fixture(YAML.replace('src/a.test.ts#[F-001]', 'src/missing.test.ts#[F-001]')),
    );
    expect(r.errors).toContain('F-001: test file missing: src/missing.test.ts');
  });

  it('[F-024] a title not found inside an it()/test() call fails', () => {
    const r = checkFeatures(fixture(YAML.replace('Enter appends a row', 'Enter does nothing')));
    expect(
      r.errors.some((e) =>
        e.startsWith('F-001: title not found in an it()/test() call in src/a.test.ts'),
      ),
    ).toBe(true);
  });

  it('[F-024] a done feature whose test is .skip or .todo fails, but in-progress may use .todo', () => {
    const skipped = fixture(YAML, {
      'src/a.test.ts': TEST_SRC.replace("it('[F-001]", "it.skip('[F-001]"),
    });
    const r = checkFeatures(skipped);
    expect(r.errors).toContain(
      "F-001: test is skipped/todo in src/a.test.ts: '[F-001] Enter appends a row'",
    );
    expect(r.errors.filter((e) => e.startsWith('F-002'))).toEqual([]);
  });

  it('[F-024] an unknown [F-0xx] tag in any test file fails', () => {
    const r = checkFeatures(
      fixture(YAML, {
        'src/a.test.ts': TEST_SRC,
        'e2e/x.spec.ts': `test('${GHOST} ghost', () => {});`,
      }),
    );
    expect(r.errors).toContain(`e2e/x.spec.ts: unknown feature tag ${GHOST}`);
  });

  it('[F-024] the repo features.yaml itself is consistent with the test files', () => {
    const root = join(__dirname, '..');
    const r = checkFeatures(root);
    expect(r.errors).toEqual([]);
    expect(readFileSync(join(root, 'features.yaml'), 'utf8')).toContain('F-001');
  });
});

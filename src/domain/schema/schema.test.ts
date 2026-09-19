import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { InboxCommand } from '../types';
import {
  buildJsonSchema,
  DayStateSchema,
  HistoryEventSchema,
  INBOX_FILENAME,
  JSON_SCHEMAS,
  type JsonSchemaName,
  MIGRATIONS,
  migrateTodos,
  parseTodosFile,
  ScheduleSchema,
  SettingsSchema,
  TODOS_VERSION,
  validateInboxCommand,
} from './index';

const AT = '2026-09-18T07:03:00Z';
const NOW = '2026-09-18T09:12:00+02:00';

function validItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '01ITEM00000000000000000001',
    title: 'Read paper X',
    status: 'open',
    tags: [],
    rescheduleCount: 0,
    order: 0,
    source: { kind: 'ui' },
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function todosFile(items: unknown[] = [], over: Record<string, unknown> = {}): unknown {
  return { version: 1, updatedAt: NOW, items, ...over };
}

describe('schema: parseTodosFile', () => {
  it('[F-004] accepts a valid file and returns the typed items', () => {
    const file = parseTodosFile(
      todosFile([
        validItem({
          scheduledFor: '2026-09-18',
          block: { start: '09:00', minutes: 30 },
          checkpoint: null,
          estimateMin: 25,
          repeat: 'weekly:mon',
          fallback: { minutes: 15, at: '16:00' },
          source: { kind: 'agent', by: 'hermes', ref: 'https://example.com/issues/1' },
        }),
      ]),
    );
    expect(file.version).toBe(1);
    expect(file.items).toHaveLength(1);
    expect(file.items[0]).toMatchObject({ title: 'Read paper X', repeat: 'weekly:mon' });
  });

  it('[F-004] keeps unknown item keys (forward compatibility with newer writers)', () => {
    const raw = todosFile([
      validItem({ mood: 'good', extra: { nested: [1, 2, 3] }, futureFlag: true }),
    ]);
    const file = parseTodosFile(raw);
    expect(file.items[0]).toMatchObject({
      mood: 'good',
      extra: { nested: [1, 2, 3] },
      futureFlag: true,
    });
    // and the file as a whole survives a round trip
    expect(JSON.parse(JSON.stringify(file))).toEqual(raw);
  });

  it('[F-004] throws an Error whose message starts with the JSON path of the first problem', () => {
    const cases: Array<[unknown, RegExp]> = [
      ['not an object', /^\$: /],
      [null, /^\$: /],
      [todosFile([], { version: 2 }), /^version: /],
      [todosFile([], { updatedAt: 'yesterday' }), /^updatedAt: expected ISO 8601 instant/],
      [todosFile([{ id: 'a' }]), /^items\[0\]\.title: /],
      [todosFile([validItem(), validItem({ status: 'paused' })]), /^items\[1\]\.status: /],
      [
        todosFile([validItem({ block: { start: '9:00', minutes: 30 } })]),
        /^items\[0\]\.block\.start: expected HH:MM/,
      ],
      [
        todosFile([validItem({ block: { start: '09:00', minutes: 2 } })]),
        /^items\[0\]\.block\.minutes: /,
      ],
      [
        todosFile([validItem({ scheduledFor: '2026-13-01' })]),
        /^items\[0\]\.scheduledFor: expected YYYY-MM-DD/,
      ],
      [todosFile([validItem({ tags: ['ok', 7] })]), /^items\[0\]\.tags\[1\]: /],
      [todosFile([validItem({ source: { kind: 'robot' } })]), /^items\[0\]\.source\.kind: /],
      [todosFile([validItem({ repeat: 'weekly:funday' })]), /^items\[0\]\.repeat: /],
      [todosFile([validItem({ title: '' })]), /^items\[0\]\.title: /],
      [todosFile([validItem({ rescheduleCount: -1 })]), /^items\[0\]\.rescheduleCount: /],
      [{ version: 1, updatedAt: NOW }, /^items: /],
    ];
    for (const [raw, pattern] of cases) {
      expect(() => parseTodosFile(raw), JSON.stringify(raw)).toThrow(pattern);
    }
  });

  it('[F-004] every thrown error is a plain Error (the server keeps the message as a problem line)', () => {
    let caught: unknown;
    try {
      parseTodosFile(todosFile([{}]));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/^items\[0\]\./);
  });
});

describe('schema: validateInboxCommand', () => {
  const add = (item: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
    v: 1,
    op: 'add',
    by: 'hermes',
    at: AT,
    item: { title: 'Reply to alice', ...item },
    ...over,
  });

  it('[F-026] accepts each of the four ops', () => {
    const cmds: unknown[] = [
      add({
        note: 'see issue',
        estimateMin: 10,
        due: '2026-09-30',
        suggestedFor: '2026-09-19',
        project: 'thesis',
        tags: ['mail'],
        cue: 'after lunch',
        ref: 'https://example.com/issues/1',
        dedupeKey: 'issue-1-reply',
      }),
      { v: 1, op: 'update', by: 'hermes', at: AT, id: 'a', patch: { tags: ['x'] } },
      {
        v: 1,
        op: 'update',
        by: 'hermes',
        at: AT,
        dedupeKey: 'k',
        baseUpdatedAt: NOW,
        patch: { title: 'New', note: 'n', due: '2026-09-30', estimateMin: 5 },
      },
      { v: 1, op: 'done', by: 'hermes', at: AT, id: 'a', baseUpdatedAt: NOW },
      { v: 1, op: 'done', by: 'hermes', at: AT, dedupeKey: 'k', baseUpdatedAt: NOW },
      { v: 1, op: 'ping', by: 'hermes', at: AT },
    ];
    for (const raw of cmds) {
      const r = validateInboxCommand(raw);
      expect(r.ok, JSON.stringify(raw)).toBe(true);
      if (r.ok) expect(r.command).toEqual(raw);
    }
  });

  it('[F-026] rejects unknown keys at every level with a "schema: <path>" error', () => {
    const cases: Array<[unknown, RegExp]> = [
      [add({}, { extra: 1 }), /^schema: \$: Unrecognized key: "extra"/],
      [add({ priority: 'high' }), /^schema: item: Unrecognized key: "priority"/],
      [
        { v: 1, op: 'update', by: 'hermes', at: AT, id: 'a', patch: { status: 'done' } },
        /^schema: patch: Unrecognized key: "status"/,
      ],
      [
        {
          v: 1,
          op: 'update',
          by: 'hermes',
          at: AT,
          id: 'a',
          patch: { scheduledFor: '2026-09-19' },
        },
        /^schema: patch: Unrecognized key: "scheduledFor"/,
      ],
      [
        { v: 1, op: 'ping', by: 'hermes', at: AT, item: {} },
        /^schema: \$: Unrecognized key: "item"/,
      ],
    ];
    for (const [raw, pattern] of cases) {
      const r = validateInboxCommand(raw);
      expect(r.ok, JSON.stringify(raw)).toBe(false);
      if (!r.ok) expect(r.error).toMatch(pattern);
    }
  });

  it('[F-026] rejects a wrong version, unknown op, bad instant and missing/empty fields', () => {
    const cases: Array<[unknown, RegExp]> = [
      [add({}, { v: 2 }), /^schema: v: /],
      [add({}, { op: 'nuke' }), /^schema: op: /],
      [add({}, { at: '2026-09-18' }), /^schema: at: expected ISO 8601 instant/],
      [add({}, { by: '' }), /^schema: by: /],
      [add({ title: '' }), /^schema: item\.title: /],
      [add({ title: 'x'.repeat(201) }), /^schema: item\.title: /],
      [add({ due: '18.09.2026' }), /^schema: item\.due: expected YYYY-MM-DD/],
      [add({ estimateMin: 12.5 }), /^schema: item\.estimateMin: /],
      [add({ tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }), /^schema: item\.tags: /],
      [add({ dedupeKey: '' }), /^schema: item\.dedupeKey: /],
      [{ v: 1, op: 'add', by: 'hermes', at: AT }, /^schema: item: /],
      [{ v: 1, op: 'update', by: 'hermes', at: AT, id: 'a' }, /^schema: patch: /],
      [{ v: 1, op: 'done', by: 'hermes', at: AT, id: 'a' }, /^schema: baseUpdatedAt: /],
      [null, /^schema: \$: /],
      ['ping', /^schema: \$: /],
      [[], /^schema: /],
    ];
    for (const [raw, pattern] of cases) {
      const r = validateInboxCommand(raw);
      expect(r.ok, JSON.stringify(raw)).toBe(false);
      if (!r.ok) expect(r.error).toMatch(pattern);
    }
  });

  it('[F-026] update and done need an id or a dedupeKey', () => {
    const update = { v: 1, op: 'update', by: 'hermes', at: AT, patch: { tags: ['x'] } };
    const done = { v: 1, op: 'done', by: 'hermes', at: AT, baseUpdatedAt: NOW };
    for (const raw of [update, done]) {
      expect(validateInboxCommand(raw)).toEqual({
        ok: false,
        error: 'schema: id: either id or dedupeKey is required',
      });
      expect(validateInboxCommand({ ...raw, id: 'a' }).ok).toBe(true);
      expect(validateInboxCommand({ ...raw, dedupeKey: 'k' }).ok).toBe(true);
    }
  });

  it('[F-026] returns the parsed command typed as InboxCommand', () => {
    const r = validateInboxCommand(add({ dedupeKey: 'k' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const cmd: InboxCommand = r.command;
      expect(cmd.op).toBe('add');
      if (cmd.op === 'add') expect(cmd.item.dedupeKey).toBe('k');
    }
  });
});

describe('schema: INBOX_FILENAME', () => {
  it('[F-026] matches <UTC compact timestamp with ms>Z-<slug>.json and nothing else', () => {
    const good = [
      '20260918T070300000Z-issue-1.json',
      '20260918T070300000Z-a.json',
      `20260918T070300000Z-${'a'.repeat(40)}.json`,
      '20260918T070300000Z-reply-to-alice-2.json',
    ];
    const bad = [
      '20260918T070300000Z-Issue-1.json', // uppercase slug
      '20260918T070300000-issue-1.json', // missing Z
      '20260918T0703000Z-issue-1.json', // too few digits
      '20260918T070300000Z-issue_1.json', // underscore
      '20260918T070300000Z-.json', // empty slug
      `20260918T070300000Z-${'a'.repeat(41)}.json`, // slug too long
      '20260918T070300000Z-issue-1.JSON',
      '20260918T070300000Z-issue-1.json.txt',
      '../20260918T070300000Z-issue-1.json',
      'inbox/20260918T070300000Z-issue-1.json',
      '20260918T070300000Z-issue-1.json\n',
      'todos.json',
      '',
    ];
    for (const name of good) expect(INBOX_FILENAME.test(name), name).toBe(true);
    for (const name of bad) expect(INBOX_FILENAME.test(name), name).toBe(false);
  });
});

describe('schema: migrateTodos', () => {
  it('[F-004] treats a missing version as version 1 and stamps it', () => {
    const file = migrateTodos({ updatedAt: NOW, items: [validItem()] });
    expect(file.version).toBe(1);
    expect(file.items).toHaveLength(1);
  });

  it('[F-004] passes a current file through unchanged and is idempotent', () => {
    const raw = todosFile([validItem({ unknownKey: 'kept' })]);
    const once = migrateTodos(raw);
    expect(once).toEqual(raw);
    expect(migrateTodos(once)).toEqual(once);
  });

  it('[F-004] refuses a file written by a newer app version', () => {
    expect(() => migrateTodos(todosFile([], { version: TODOS_VERSION + 1 }))).toThrow(
      /^version: 2 is newer than supported 1/,
    );
    expect(() => migrateTodos(todosFile([], { version: 99 }))).toThrow(/newer than supported/);
  });

  it('[F-004] refuses a version with no migration step and non-object input', () => {
    expect(MIGRATIONS).toEqual([]);
    expect(() => migrateTodos(todosFile([], { version: 0 }))).toThrow(
      /^version: no migration from 0/,
    );
    expect(() => migrateTodos(null)).toThrow(/^\$: expected an object/);
    expect(() => migrateTodos([])).toThrow(/^\$: expected an object/);
    expect(() => migrateTodos('todos')).toThrow(/^\$: expected an object/);
    expect(() => migrateTodos(undefined)).toThrow(/^\$: expected an object/);
  });

  it('[F-004] validates after migrating, with the same path-first messages as parseTodosFile', () => {
    expect(() => migrateTodos({ updatedAt: NOW, items: [{ id: 'a' }] })).toThrow(
      /^items\[0\]\.title: /,
    );
    // a non-numeric version is normalised to 1 (the writer is always the app itself)
    expect(migrateTodos({ version: '1', updatedAt: NOW, items: [] }).version).toBe(1);
  });
});

describe('schema: the other file schemas', () => {
  it('[F-012] ScheduleSchema validates anchors and HH:MM bounds', () => {
    const ok = ScheduleSchema.safeParse({
      version: 1,
      dayStart: '08:00',
      dayEnd: '22:00',
      slackMinutes: 90,
      anchors: [{ name: 'Lecture A', days: ['mon', 'wed'], start: '10:00', end: '12:00' }],
    });
    expect(ok.success).toBe(true);
    const bad = ScheduleSchema.safeParse({
      version: 1,
      dayStart: '8:00',
      dayEnd: '22:00',
      slackMinutes: 90,
      anchors: [],
    });
    expect(bad.success).toBe(false);
    expect(
      ScheduleSchema.safeParse({
        version: 1,
        dayStart: '08:00',
        dayEnd: '22:00',
        slackMinutes: 0,
        anchors: [{ name: 'Lecture A', days: ['fun'], start: '10:00', end: '12:00' }],
      }).success,
    ).toBe(false);
  });

  it('[F-015] DayStateSchema accepts a null freshStartAt and rejects a bad one', () => {
    expect(
      DayStateSchema.safeParse({ date: '2026-09-18', freshStartAt: null, eveningRitualDone: false })
        .success,
    ).toBe(true);
    expect(
      DayStateSchema.safeParse({
        date: '2026-09-18',
        freshStartAt: '14:00',
        eveningRitualDone: true,
      }).success,
    ).toBe(true);
    expect(
      DayStateSchema.safeParse({
        date: '2026-09-18',
        freshStartAt: '24:00',
        eveningRitualDone: true,
      }).success,
    ).toBe(false);
  });

  it('[F-013] HistoryEventSchema accepts the reducer event shape incl. scope next_block_only', () => {
    expect(
      HistoryEventSchema.safeParse({
        ts: NOW,
        type: 'rescheduled',
        day: '2026-09-18',
        itemId: 'a',
        from: '10:00',
        to: '10:30',
        scope: 'next_block_only',
        auto: false,
        reason: 'overlap',
        detail: 'x',
        by: 'alice',
      }).success,
    ).toBe(true);
    expect(
      HistoryEventSchema.safeParse({
        ts: NOW,
        type: 'rescheduled',
        day: '2026-09-18',
        scope: 'all',
      }).success,
    ).toBe(false);
    expect(
      HistoryEventSchema.safeParse({ ts: NOW, type: 'teleported', day: '2026-09-18' }).success,
    ).toBe(false);
  });

  it('[F-006] SettingsSchema requires a padding factor of at least 1', () => {
    const base = {
      timezone: 'Europe/Berlin',
      dayStart: '08:00',
      dayEnd: '22:00',
      slackMinutes: 90,
      eveningRitualAt: '20:00',
      todayCap: 5,
      slipGraceMin: 10,
      defaultEstimateMin: 30,
      paddingFactor: 1.3,
    };
    expect(SettingsSchema.safeParse(base).success).toBe(true);
    expect(SettingsSchema.safeParse({ ...base, paddingFactor: 0.9 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...base, todayCap: 0 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...base, timezone: '' }).success).toBe(false);
  });
});

describe('schema: published JSON schemas', () => {
  const schemaDir = fileURLToPath(new URL('../../../schema/', import.meta.url));

  it('[F-026] schema/*.schema.json are up to date with the zod schemas (run `npm run schema:build`)', () => {
    for (const name of Object.keys(JSON_SCHEMAS) as JsonSchemaName[]) {
      const expected = `${JSON.stringify(buildJsonSchema(name), null, 2)}\n`;
      const committed = readFileSync(`${schemaDir}${name}.schema.json`, 'utf8');
      expect(committed, `${name}.schema.json is stale`).toBe(expected);
    }
  });

  it('[F-026] every published schema targets draft 2020-12 and carries an example.com $id', () => {
    for (const name of Object.keys(JSON_SCHEMAS) as JsonSchemaName[]) {
      const schema = buildJsonSchema(name);
      expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(schema.$id).toBe(`https://example.com/quickdo/schema/${name}.schema.json`);
    }
  });

  it('[F-026] the item schema allows unknown keys while the inbox command schema forbids them', () => {
    const item = buildJsonSchema('item');
    expect(item.additionalProperties).not.toBe(false);
    const inbox = buildJsonSchema('inbox-command') as {
      anyOf?: Array<Record<string, unknown>>;
      oneOf?: Array<Record<string, unknown>>;
    };
    const variants = inbox.anyOf ?? inbox.oneOf ?? [];
    expect(variants.length).toBe(4);
    for (const v of variants) expect(v.additionalProperties).toBe(false);
  });
});

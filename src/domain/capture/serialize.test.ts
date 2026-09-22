import { describe, expect, it } from 'vitest';
import { clock, item, settings } from '../testing/fixtures';
import { editPatchFromText, itemToText } from './serialize';

let n = 0;
const newId = () => `NEW${++n}`;

describe('edit round trip (F-036)', () => {
  it('[F-036] itemToText renders heading tokens, note lines and sub-todos in capture syntax', () => {
    const it0 = item({
      title: 'Prepare the thesis meeting',
      project: 'thesis',
      tags: ['uni'],
      estimateMin: 45,
      due: '2026-09-25',
      cue: 'after lunch',
      note: 'Bring the draft.\nAnd the figures.',
      subtasks: [
        { id: 's1', title: 'print the outline', done: false },
        { id: 's2', title: 'book the room', done: true },
      ],
    });
    expect(itemToText(it0)).toBe(
      'Prepare the thesis meeting #thesis +uni ~45m due 2026-09-25 when after lunch\nBring the draft.\nAnd the figures.\n- print the outline\n[x] book the room',
    );
    // unchanged text → empty patch
    expect(editPatchFromText(it0, itemToText(it0), clock, settings, newId)).toEqual({});
  });

  it('[F-036] only changed fields are patched; removed tokens clear; sub-todos keep ids and done state', () => {
    const it0 = item({
      title: 'Call alice',
      project: 'thesis',
      tags: [],
      note: 'old note',
      subtasks: [
        { id: 's1', title: 'prepare questions', done: true },
        { id: 's2', title: 'send the notes', done: false },
      ],
    });
    const p = editPatchFromText(
      it0,
      'Call alice about Friday ~10m\nnew note\n- prepare questions\n- write the summary',
      clock,
      settings,
      newId,
    );
    expect(p).toEqual({
      title: 'Call alice about Friday',
      note: 'new note',
      project: undefined, // #thesis removed
      estimateMin: 10,
      subtasks: [
        { id: 's1', title: 'prepare questions', done: true }, // kept, still done
        { id: 'NEW1', title: 'write the summary', done: false },
      ],
    });
    expect(editPatchFromText(it0, '   ', clock, settings, newId)).toBeNull();
    const moved = editPatchFromText(
      it0,
      'Call alice !today #thesis\nold note\n[x] prepare questions\n- send the notes',
      clock,
      settings,
      newId,
    );
    expect(moved).toEqual({ scheduledFor: '2026-09-18' });
  });
});

describe('ongoing round trip (F-037)', () => {
  it('[F-037] the heading carries !ongoing; removing it clears the flag; re-saving an ongoing item is not a move', () => {
    const it0 = item({
      title: 'Write the chapter',
      ongoing: true,
      ongoingSince: '2026-09-10',
      scheduledFor: '2026-09-18',
    });
    expect(itemToText(it0)).toBe('Write the chapter !ongoing');
    expect(editPatchFromText(it0, 'Write the chapter !ongoing', clock, settings, newId)).toEqual(
      {},
    );
    expect(editPatchFromText(it0, 'Write the chapter', clock, settings, newId)).toEqual({
      ongoing: undefined,
    });
    const plain = item({ title: 'Call alice' });
    expect(editPatchFromText(plain, 'Call alice !ongoing', clock, settings, newId)).toEqual({
      ongoing: true,
    });
  });
});

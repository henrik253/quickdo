import { useEffect } from 'react';
import { api } from './api';
import { Backlog } from './components/Backlog';
import { CaptureBar } from './components/CaptureBar';
import { DoneChart } from './components/DoneChart';
import { HabitsStrip } from './components/HabitsStrip';
import { KeyHelp } from './components/KeyHelp';
import { ProgressBar } from './components/ProgressBar';
import { StartingBanner } from './components/StartingBanner';
import { SyncBadge } from './components/SyncBadge';
import { TipBar } from './components/TipBar';
import { Toast } from './components/Toast';
import { TodayList } from './components/TodayList';
import { Upcoming } from './components/Upcoming';
import { type FocusAction, mapKey } from './focus';
import { useStore } from './store';
import { T } from './testids';

const CHORD_TIMEOUT_MS = 1500;

/** Global key handling for list mode; the capture bar and inline editors handle their own keys. */
export function useKeyboard() {
  useEffect(() => {
    let chordTimer: ReturnType<typeof setTimeout> | null = null;
    const dispatch = (a: FocusAction) => {
      const st = useStore.getState();
      switch (a.type) {
        case 'move':
          st.moveCursor(a.delta);
          return;
        case 'row':
          if (st.cursor) void st.rowAction(st.cursor, a.action);
          return;
        case 'inline':
          if (st.cursor) st.setInline({ id: st.cursor, kind: a.kind });
          return;
        case 'shiftBlock':
          if (st.cursor) void st.shiftBlock(st.cursor, a.minutes);
          return;
        case 'freshStart':
          void st.freshStart();
          return;
        case 'toggleView':
          st.toggleView();
          return;
        case 'toggleDetails':
          if (st.cursor) st.toggleExpanded(st.cursor);
          return;
        case 'toggleHelp':
          st.setHelpOpen(!st.helpOpen);
          return;
        case 'closeHelp':
          st.setHelpOpen(false);
          return;
        case 'chord':
          st.setPendingChord(a.key);
          if (chordTimer) clearTimeout(chordTimer);
          chordTimer = setTimeout(
            () => useStore.getState().setPendingChord(null),
            CHORD_TIMEOUT_MS,
          );
          return;
        case 'cancelChord':
          st.setPendingChord(null);
          return;
        case 'ritual':
          st.setPendingChord(null);
          st.showToast('evening ritual — coming in M3');
          return;
        case 'review':
          st.setPendingChord(null);
          st.showToast('Sunday review — coming in M3');
          return;
        case 'sync':
          st.setPendingChord(null);
          void st.forceSync();
          return;
        case 'enterCapture':
          if (a.insert) st.setDraft(st.draft + a.insert);
          st.setMode('capture');
          return;
        case 'enterList':
          st.setMode('list');
          return;
        default:
          return;
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const st = useStore.getState();
      if ((tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) && !st.helpOpen)
        return;
      const action = mapKey(
        {
          mode: st.mode === 'capture' ? 'list' : st.mode,
          pendingChord: st.pendingChord,
          inputEmpty: st.draft === '',
          helpOpen: st.helpOpen,
          inlineOpen: st.inline !== null,
        },
        { key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey },
      );
      if (action.type === 'none') return;
      e.preventDefault();
      dispatch(action);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (chordTimer) clearTimeout(chordTimer);
    };
  }, []);
}

export function App() {
  const state = useStore((s) => s.state);
  useKeyboard();

  useEffect(() => {
    const st = useStore.getState();
    api
      .state()
      .then((s) => useStore.getState().applyState(s))
      .catch(() => {
        /* the SSE stream / starting banner take over */
      });
    st.connect();
    return () => useStore.getState().disconnect();
  }, []);

  return (
    <div className="app" data-testid={T.app}>
      <header className="topbar">
        <span className="brand">Quickdo</span>
        <SyncBadge />
        <span className="spacer" />
        <span className="badge" title="keys">
          ?
        </span>
      </header>
      <StartingBanner />
      {state && state.problems.length > 0 && (
        <div className="problems" data-testid={T.problems} role="alert">
          {state.problems.join(' · ')}
        </div>
      )}
      <CaptureBar />
      <div className="layout">
        <div className="col-main">
          {state && <ProgressBar progress={state.derived.progress} />}
          <TodayList />
          <DoneChart />
          <HabitsStrip />
          <Upcoming />
          <Backlog />
        </div>
      </div>
      {state && (
        <TipBar context={{ slips: state.derived.slips.length, overCap: state.derived.overCap }} />
      )}
      <Toast />
      <KeyHelp />
    </div>
  );
}

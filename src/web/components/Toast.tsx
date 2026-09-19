import { useStore } from '../store';
import { T } from '../testids';

/** Chips for warnings, precondition failures and "Hermes added N". */
export function Toast() {
  const toast = useStore((s) => s.toast);
  const dismiss = useStore((s) => s.dismissToast);
  if (toast.length === 0) return null;
  return (
    <div className="toasts" data-testid={T.toast} aria-live="polite">
      {toast.map((t) => (
        <button
          type="button"
          key={t.id}
          className={`chip ${t.kind}`}
          data-testid={T.toastChip}
          data-kind={t.kind}
          onClick={() => dismiss(t.id)}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}

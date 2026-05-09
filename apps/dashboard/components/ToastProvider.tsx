'use client';

// Global toast surface. Consumers call `useToast().push({ ... })` to enqueue.
// Stack is bottom-right, auto-dismisses after `ttl` (default 4s), max 5 visible.
//
// API stability: `push` returns the toast id; callers can dismiss explicitly
// via `dismiss(id)` for in-flight operations that complete async.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastTone = 'ok' | 'warn' | 'crit' | 'muted';

export interface ToastInput {
  title: string;
  body?: string;
  tone?: ToastTone;
  ttl?: number;
}

export interface Toast extends Required<Pick<ToastInput, 'title'>> {
  id: string;
  body?: string;
  tone: ToastTone;
  ttl: number;
  leaving?: boolean;
}

interface ToastContextValue {
  push: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_VISIBLE = 5;
const DEFAULT_TTL_MS = 4_000;
const LEAVE_ANIM_MS = 180;

let toastCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string): void => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    // Two-phase removal so the leave animation runs before unmount.
    setToasts((prev) => prev.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, LEAVE_ANIM_MS);
  }, []);

  const push = useCallback(
    (input: ToastInput): string => {
      toastCounter += 1;
      const id = `t_${Date.now().toString(36)}_${toastCounter}`;
      const toast: Toast = {
        id,
        title: input.title,
        body: input.body,
        tone: input.tone ?? 'muted',
        ttl: input.ttl ?? DEFAULT_TTL_MS,
      };
      setToasts((prev) => {
        const next = [...prev, toast];
        // Cap visible toasts — drop the oldest, eagerly cancel its timer.
        if (next.length > MAX_VISIBLE) {
          const removed = next.splice(0, next.length - MAX_VISIBLE);
          for (const r of removed) {
            const t = timers.current.get(r.id);
            if (t) clearTimeout(t);
            timers.current.delete(r.id);
          }
        }
        return next;
      });
      const handle = setTimeout(() => dismiss(id), toast.ttl);
      timers.current.set(id, handle);
      return id;
    },
    [dismiss],
  );

  // Cleanup all pending timers on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast() must be used inside <ToastProvider>.');
  }
  return ctx;
}

function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-tone={t.tone} data-leaving={t.leaving ? 'true' : undefined} role="status">
          <div>
            <div className="toast-title">{t.title}</div>
            {t.body ? <div className="toast-body">{t.body}</div> : null}
          </div>
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

export interface Toast {
  id: number;
  icon?: ReactNode;
  text: string;
}

const TOAST_MS = 1800;

/**
 * Short confirmations for actions without an on-screen control in view (keyboard shortcuts, or
 * toggles while the sidebar is folded). A repeated message replaces the previous one.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, number>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending.values()) window.clearTimeout(t);
    };
  }, []);

  const show = useCallback((text: string, icon?: ReactNode) => {
    const id = ++nextId.current;
    setToasts((list) => [...list.filter((t) => t.text !== text).slice(-2), { id, text, icon }]);
    timers.current.set(
      id,
      window.setTimeout(() => {
        timers.current.delete(id);
        setToasts((list) => list.filter((t) => t.id !== id));
      }, TOAST_MS),
    );
  }, []);

  return { toasts, show };
}

export function ToastViewport({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toast-viewport" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            className="toast"
            initial={{ opacity: 0, y: -12, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 460, damping: 32 }}
          >
            {t.icon}
            <span>{t.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

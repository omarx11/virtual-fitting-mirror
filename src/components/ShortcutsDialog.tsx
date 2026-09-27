import { Keyboard } from 'lucide-react';
import { SHORTCUTS } from '../app/brand';
import { Modal } from './ui/Modal';

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" icon={<Keyboard size={20} />}>
      <dl className="shortcut-list">
        {SHORTCUTS.map((s) => (
          <div key={s.action} className="shortcut-row">
            <dt>
              {s.keys.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </dt>
            <dd>{s.action}</dd>
          </div>
        ))}
      </dl>
      <p className="hint">Shortcuts are ignored while you type in a field.</p>
    </Modal>
  );
}

import { Keyboard } from 'lucide-react';
import { SHORTCUTS } from '../app/brand';
import { useI18n } from '../i18n/I18nProvider';
import { Modal } from './ui/Modal';

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { m } = useI18n();
  return (
    <Modal open={open} onClose={onClose} title={m.common.keyboardShortcuts} icon={<Keyboard size={20} />}>
      <dl className="shortcut-list">
        {SHORTCUTS.map((s) => (
          <div key={s.id} className="shortcut-row">
            <dt>
              {s.keys.map((k) => (
                <kbd key={k}>{m.keys[k] ?? k}</kbd>
              ))}
            </dt>
            <dd>{m.shortcuts.actions[s.id]}</dd>
          </div>
        ))}
      </dl>
      <p className="hint">{m.shortcuts.hint}</p>
    </Modal>
  );
}

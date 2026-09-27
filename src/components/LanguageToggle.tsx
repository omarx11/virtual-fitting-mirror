import { Languages } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';

/**
 * Switches between English and Arabic. Shows the other language's name, written in that language, so a
 * shopper who cannot read the current one still finds it. `withIcon` adds the languages glyph where
 * there is room for it.
 */
export function LanguageToggle({
  className = 'icon-button ghost lang-toggle',
  withIcon = false,
}: {
  className?: string;
  withIcon?: boolean;
}) {
  const { m, toggleLocale } = useI18n();
  return (
    <button
      type="button"
      className={className}
      onClick={() => toggleLocale()}
      aria-label={m.language.switchLabel}
      title={m.language.switchLabel}
      data-testid="language-toggle"
    >
      {withIcon && <Languages aria-hidden size={16} />}
      <span lang={m.language.switchTextLang}>{m.language.switchText}</span>
    </button>
  );
}

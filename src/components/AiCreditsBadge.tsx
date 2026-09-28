import { Coins } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { AiViewState } from '../ai/controller';
import { useI18n } from '../i18n/I18nProvider';

/** At or below this many credits the badge turns amber. */
const LOW_CREDITS = 3;

/** The credits the current payer has left: the visitor's saved key, or the operator's. Null: unknown. */
function creditsLeft(state: AiViewState): { left: number; source: 'key' | 'server' } | null {
  if (!state.capabilities?.enabled) return null;
  if (state.userKey.saved) {
    return state.userKey.credits === null ? null : { left: state.userKey.credits, source: 'key' };
  }
  const server = state.serverCredits;
  if (!server) return null;
  // Both limits apply: today's cap (if any) and what the FASHN account still holds.
  const limits = [server.todayLeft, server.balance].filter((n): n is number => n !== null);
  return limits.length === 0 ? null : { left: Math.min(...limits), source: 'server' };
}

/** Corner badge on the AI stage: how many credits (previews) are left, updated after every change. */
export function AiCreditsBadge({ state }: { state: AiViewState }) {
  const { m } = useI18n();
  const b = m.ai.creditsBadge;
  const credits = creditsLeft(state);
  const server = state.serverCredits;
  const title =
    credits?.source === 'server' && server
      ? b.serverTitle(server.todayLeft, server.cap, server.balance)
      : b.keyTitle;
  const tone =
    credits === null ? 'ok' : credits.left <= 0 ? 'empty' : credits.left <= LOW_CREDITS ? 'low' : 'ok';
  return (
    <AnimatePresence>
      {credits && (
        <motion.div
          key="credits"
          className="ai-credits"
          data-tone={tone}
          title={title}
          role="status"
          data-testid="ai-credits"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        >
          <Coins aria-hidden size={15} />
          <span>{b.left(credits.left)}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

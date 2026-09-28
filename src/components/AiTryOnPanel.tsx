import { ImageUp, KeyRound, LogOut, TriangleAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { type FormEvent, useRef, useState } from 'react';
import type { AiTryOnController, AiViewState } from '../ai/controller';
import { AI_BACKEND_HOSTED } from '../ai/deployment';
import { AI_USER_KEY_PATTERN, type AiGarmentCategory, type AiGarmentPhotoType } from '../ai/types';
import { AI_GARMENTS } from '../garments/aiCatalogue';
import { aiGarmentText } from '../i18n/catalogue';
import { withCode } from '../i18n/format';
import { useI18n } from '../i18n/I18nProvider';
import { SelectedRing } from './GarmentPicker';

const CATEGORIES: readonly AiGarmentCategory[] = ['tops', 'bottoms', 'one-pieces'];
const PHOTO_TYPES: readonly AiGarmentPhotoType[] = ['auto', 'flat-lay', 'model'];
/** Where visitors create a FASHN API key. */
const FASHN_KEYS_URL = 'https://app.fashn.ai/api';

/**
 * The visitor's own FASHN API key: a form (open when no other key can pay, folded away when it is
 * optional), or a one-line note once a key is saved in this browser.
 */
function UserKeyForm({
  state,
  controller,
  required,
}: {
  state: AiViewState;
  controller: AiTryOnController;
  required: boolean;
}) {
  const { m } = useI18n();
  const [value, setValue] = useState('');
  const key = state.userKey;
  if (key.saved) {
    return (
      <p className="hint ai-access-ok" role="status" data-testid="ai-key-saved">
        <KeyRound aria-hidden size={14} />
        <span>
          {m.ai.key.saved}
          {key.credits !== null && ` · ${m.ai.key.credits(key.credits)}`}
        </span>
        <button type="button" className="text-button" onClick={() => controller.forgetUserKey()}>
          {m.ai.key.remove}
        </button>
      </p>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await controller.saveUserKey(value)) setValue('');
  };
  const form = (
    <form className="ai-access" onSubmit={submit} data-testid="ai-key">
      <label className="field-label" htmlFor="ai-user-key">
        <KeyRound aria-hidden size={14} /> {m.ai.key.title}
      </label>
      <p className="hint">
        {m.ai.key.hint}{' '}
        <a href={FASHN_KEYS_URL} target="_blank" rel="noreferrer">
          {m.ai.key.getKey}
        </a>
      </p>
      <div className="ai-access-row">
        <input
          id="ai-user-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={m.ai.key.placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={key.checking}
        />
        <button
          type="submit"
          className="button primary"
          disabled={!AI_USER_KEY_PATTERN.test(value.trim()) || key.checking}
        >
          {key.checking ? m.ai.key.checking : m.ai.key.save}
        </button>
      </div>
      {key.error && (
        <p className="error-text" role="alert">
          {m.ai.error(key.error.code, key.error.message)}
        </p>
      )}
    </form>
  );
  if (required) return form;
  return (
    <details className="ai-dev">
      <summary>{m.ai.key.optional}</summary>
      {form}
    </details>
  );
}

/**
 * Side-panel controls for AI mode: garment choice (product photos), operator setup when AI is
 * unavailable, developer test inputs, and End session. The capture/generate actions live on the stage.
 */
export function AiTryOnPanel({
  state,
  controller,
  onSelectGarment,
  onPhotoFile,
  onEndSession,
}: {
  state: AiViewState;
  controller: AiTryOnController;
  onSelectGarment: (id: string) => void;
  onPhotoFile: (file: File) => void;
  onEndSession: () => void;
}) {
  const { m } = useI18n();
  const photoRef = useRef<HTMLInputElement>(null);
  const garmentRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<AiGarmentCategory>('tops');
  const [photoType, setPhotoType] = useState<AiGarmentPhotoType>('auto');
  const generating = state.phase === 'submitting' || state.phase === 'queued' || state.phase === 'generating';
  const choice = state.garment;
  const caps = state.capabilities;
  const hasCustomerData = state.capture !== null || state.result !== null || state.consented;
  const [code, setCode] = useState('');
  const locked = caps?.enabled === true && controller.payment() === 'access';
  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    // The code is sent once and forgotten; the server keeps this browser unlocked with a cookie.
    if (await controller.unlock(code)) setCode('');
  };

  return (
    <div className="ai-panel">
      <p className="hint lead">{m.ai.panelLead}</p>

      {caps?.enabled && caps.keys.user && (
        <UserKeyForm state={state} controller={controller} required={!caps.keys.server} />
      )}

      {state.unavailable && (
        <div className="ai-unavailable" role="status" data-testid="ai-unavailable">
          <p>
            <TriangleAlert aria-hidden size={16} /> <strong>{m.ai.unavailableTitle}</strong>{' '}
            {withCode(m.ai.unavailableReason(state.unavailable.reason, state.unavailable.cause))}
          </p>
          {/* Kiosk setup steps; a hosted (Vercel) server is set up in the project settings instead. */}
          {state.unavailable.cause !== 'not-deployed' && !AI_BACKEND_HOSTED && (
            <details>
              <summary>{m.ai.setup}</summary>
              <ol>
                {m.ai.setupSteps.map((step) => (
                  <li key={step}>{withCode(step)}</li>
                ))}
              </ol>
              <p className="hint">{m.ai.setupKeepsWorking}</p>
            </details>
          )}
        </div>
      )}

      {locked && (
        <form className="ai-access" onSubmit={submitCode} data-testid="ai-access">
          <label className="field-label" htmlFor="ai-access-code">
            <KeyRound aria-hidden size={14} /> {m.ai.accessTitle}
          </label>
          <p className="hint">{m.ai.accessHint}</p>
          <div className="ai-access-row">
            <input
              id="ai-access-code"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={m.ai.accessPlaceholder}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={state.access.unlocking}
            />
            <button
              type="submit"
              className="button primary"
              disabled={!code.trim() || state.access.unlocking}
            >
              {state.access.unlocking ? m.ai.accessUnlocking : m.ai.accessUnlock}
            </button>
          </div>
          {state.access.error && (
            <p className="error-text" role="alert">
              {m.ai.error(state.access.error.code, state.access.error.message)}
            </p>
          )}
        </form>
      )}
      {caps?.keys.server && caps.access.required && caps.access.granted && !state.userKey.saved && (
        <p className="hint ai-access-ok" role="status">
          <KeyRound aria-hidden size={14} /> {m.ai.accessGranted}
        </p>
      )}

      <fieldset className="garments" disabled={generating}>
        <legend className="field-label">{m.ai.garmentPhoto}</legend>
        <div className="garment-grid" role="radiogroup" aria-label={m.ai.garmentGroup}>
          {AI_GARMENTS.map((g) => {
            const text = aiGarmentText(m, g);
            const checked = choice?.kind === 'catalogue' && choice.id === g.id;
            return (
              <motion.button
                key={g.id}
                type="button"
                role="radio"
                aria-checked={checked}
                className="garment"
                title={`${text.label} — ${text.description}`}
                onClick={() => onSelectGarment(g.id)}
                whileTap={{ scale: 0.95 }}
              >
                {checked && <SelectedRing layoutId="ai-garment-ring" />}
                <span className="garment-thumb photo">
                  <img src={`${import.meta.env.BASE_URL}${g.preview}`} alt="" width={72} height={72} />
                </span>
                <span className="garment-name">{text.label}</span>
                {g.demo && <span className="badge badge-flat">{m.ai.demo}</span>}
              </motion.button>
            );
          })}
        </div>
        {choice?.kind === 'upload' && <p className="hint">{m.ai.uploadedHint}</p>}
      </fieldset>

      {caps?.devUploads && (
        <details className="ai-dev">
          <summary>{m.ai.devInputs}</summary>
          <input
            ref={photoRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden
            data-testid="ai-photo-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onPhotoFile(file);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="button"
            onClick={() => photoRef.current?.click()}
            disabled={generating}
          >
            <ImageUp aria-hidden size={18} /> {m.ai.usePhoto}
          </button>
          <input
            ref={garmentRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden
            data-testid="ai-garment-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                controller.selectUploadedGarment(
                  file,
                  m.ai.uploadedLabel(file.name.slice(0, 40)),
                  category,
                  photoType,
                );
              e.target.value = '';
            }}
          />
          <div className="ai-dev-row">
            <label className="inline-select">
              <span>{m.ai.category}</span>
              <select value={category} onChange={(e) => setCategory(e.target.value as AiGarmentCategory)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {m.ai.categories[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-select">
              <span>{m.ai.photoType}</span>
              <select value={photoType} onChange={(e) => setPhotoType(e.target.value as AiGarmentPhotoType)}>
                {PHOTO_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {m.ai.photoTypes[t]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="button"
            onClick={() => garmentRef.current?.click()}
            disabled={generating}
          >
            <ImageUp aria-hidden size={18} /> {m.ai.uploadGarment}
          </button>
          <p className="hint">{m.ai.devHint}</p>
        </details>
      )}

      {hasCustomerData && (
        <button type="button" className="button" onClick={onEndSession} data-testid="ai-end-session">
          <LogOut aria-hidden size={18} className="rtl-flip" /> {m.common.endSession}
        </button>
      )}
    </div>
  );
}

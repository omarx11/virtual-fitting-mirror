import { ImageUp, LogOut, TriangleAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef, useState } from 'react';
import type { AiTryOnController, AiViewState } from '../ai/controller';
import type { AiGarmentCategory, AiGarmentPhotoType } from '../ai/types';
import { AI_GARMENTS, findAiGarment } from '../garments/aiCatalogue';
import { aiGarmentText } from '../i18n/catalogue';
import { withCode } from '../i18n/format';
import { useI18n } from '../i18n/I18nProvider';
import { SelectedRing } from './GarmentPicker';

const CATEGORIES: readonly AiGarmentCategory[] = ['tops', 'bottoms', 'one-pieces'];
const PHOTO_TYPES: readonly AiGarmentPhotoType[] = ['auto', 'flat-lay', 'model'];

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
  const selected = choice?.kind === 'catalogue' ? findAiGarment(choice.id) : null;
  const caps = state.capabilities;
  const hasCustomerData = state.capture !== null || state.result !== null || state.consented;

  return (
    <div className="ai-panel">
      <p className="hint lead">{m.ai.panelLead}</p>

      {state.unavailable && (
        <div className="ai-unavailable" role="status" data-testid="ai-unavailable">
          <p>
            <TriangleAlert aria-hidden size={16} /> <strong>{m.ai.unavailableTitle}</strong>{' '}
            {withCode(m.ai.unavailableReason(state.unavailable.reason, state.unavailable.backendDown))}
          </p>
          <details>
            <summary>{m.ai.setup}</summary>
            <ol>
              {m.ai.setupSteps.map((step) => (
                <li key={step}>{withCode(step)}</li>
              ))}
            </ol>
            <p className="hint">{m.ai.setupKeepsWorking}</p>
          </details>
        </div>
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
        {selected && <p className="hint">{aiGarmentText(m, selected).provenance}</p>}
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

      <p className="footnote">{m.ai.footnote}</p>
    </div>
  );
}

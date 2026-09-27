import { ImageUp, LogOut, TriangleAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef, useState } from 'react';
import type { AiTryOnController, AiViewState } from '../ai/controller';
import type { AiGarmentCategory, AiGarmentPhotoType } from '../ai/types';
import { AI_GARMENTS, findAiGarment } from '../garments/aiCatalogue';
import { SelectedRing } from './GarmentPicker';

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
      <p className="hint lead">
        Take a photo, choose a garment and generate one still image. This is not live, and not a size or fit
        guide: colours, logos and details may differ from the real product.
      </p>

      {state.unavailable && (
        <div className="ai-unavailable" role="status" data-testid="ai-unavailable">
          <p>
            <TriangleAlert aria-hidden size={16} /> <strong>AI preview is unavailable.</strong>{' '}
            {state.unavailable.reason}
          </p>
          <details>
            <summary>Setup (staff)</summary>
            <ol>
              <li>
                Copy <code>.env.example</code> to <code>.env</code> in the project folder.
              </li>
              <li>
                On this computer, set <code>FASHN_API_KEY</code> to your FASHN API key and{' '}
                <code>AI_ENABLED=true</code>. Never put the key in a <code>VITE_</code> variable.
              </li>
              <li>
                Restart with <code>npm run dev</code> (or <code>npm run build</code> then{' '}
                <code>npm start</code>).
              </li>
            </ol>
            <p className="hint">2D and 3D keep working without it.</p>
          </details>
        </div>
      )}

      <fieldset className="garments" disabled={generating}>
        <legend className="field-label">Garment photo</legend>
        <div className="garment-grid" role="radiogroup" aria-label="AI garment">
          {AI_GARMENTS.map((g) => (
            <motion.button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={choice?.kind === 'catalogue' && choice.id === g.id}
              className="garment"
              title={`${g.label} — ${g.description}`}
              onClick={() => onSelectGarment(g.id)}
              whileTap={{ scale: 0.95 }}
            >
              {choice?.kind === 'catalogue' && choice.id === g.id && (
                <SelectedRing layoutId="ai-garment-ring" />
              )}
              <span className="garment-thumb photo">
                <img src={`${import.meta.env.BASE_URL}${g.preview}`} alt="" width={72} height={72} />
              </span>
              <span className="garment-name">{g.label}</span>
              {g.demo && <span className="badge badge-flat">Demo</span>}
            </motion.button>
          ))}
        </div>
        {selected && <p className="hint">{selected.provenance}</p>}
        {choice?.kind === 'upload' && (
          <p className="hint">Uploaded garment photo — a technical test, not a validated shop product.</p>
        )}
      </fieldset>

      {caps?.devUploads && (
        <details className="ai-dev">
          <summary>Developer test inputs</summary>
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
            <ImageUp aria-hidden size={18} /> Use a photo instead of the camera
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
                  `Uploaded: ${file.name.slice(0, 40)}`,
                  category,
                  photoType,
                );
              e.target.value = '';
            }}
          />
          <div className="ai-dev-row">
            <label className="inline-select">
              <span>Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value as AiGarmentCategory)}>
                <option value="tops">Tops</option>
                <option value="bottoms">Bottoms</option>
                <option value="one-pieces">One-pieces</option>
              </select>
            </label>
            <label className="inline-select">
              <span>Photo</span>
              <select value={photoType} onChange={(e) => setPhotoType(e.target.value as AiGarmentPhotoType)}>
                <option value="auto">Auto</option>
                <option value="flat-lay">Flat-lay / ghost</option>
                <option value="model">On model</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            className="button"
            onClick={() => garmentRef.current?.click()}
            disabled={generating}
          >
            <ImageUp aria-hidden size={18} /> Upload a garment photo
          </button>
          <p className="hint">Test inputs only; uploads are validated by the server and never stored.</p>
        </details>
      )}

      {hasCustomerData && (
        <button type="button" className="button" onClick={onEndSession} data-testid="ai-end-session">
          <LogOut aria-hidden size={18} /> End session
        </button>
      )}

      <p className="footnote">
        AI mode is the only feature that uploads anything: the photo goes to the cloud service FASHN, only
        after you agree. 2D and 3D stay on this device.
      </p>
    </div>
  );
}

import { useId } from 'react';
import {
  DEFAULT_USER_FIT,
  USER_OFFSET_RANGE,
  USER_SCALE_RANGE,
  type UserFitAdjustment,
} from '../fitting/garmentFit';

export function FitControls({
  fit,
  onChange,
}: {
  fit: UserFitAdjustment;
  onChange: (fit: UserFitAdjustment) => void;
}) {
  const scaleId = useId();
  const offsetId = useId();
  const isDefault =
    fit.scale === DEFAULT_USER_FIT.scale && fit.verticalOffset === DEFAULT_USER_FIT.verticalOffset;
  return (
    <fieldset className="fit">
      <legend className="section-title">Adjust fit</legend>
      <div className="slider-row">
        <label htmlFor={scaleId}>Size</label>
        <input
          id={scaleId}
          type="range"
          min={USER_SCALE_RANGE.min}
          max={USER_SCALE_RANGE.max}
          step={0.01}
          value={fit.scale}
          onChange={(e) => onChange({ ...fit, scale: Number(e.target.value) })}
          aria-valuetext={`${Math.round(fit.scale * 100)} percent`}
        />
        <output htmlFor={scaleId}>{Math.round(fit.scale * 100)}%</output>
      </div>
      <div className="slider-row">
        <label htmlFor={offsetId}>Height</label>
        <input
          id={offsetId}
          type="range"
          min={USER_OFFSET_RANGE.min}
          max={USER_OFFSET_RANGE.max}
          step={0.01}
          value={-fit.verticalOffset}
          onChange={(e) => onChange({ ...fit, verticalOffset: -Number(e.target.value) })}
          aria-valuetext={fit.verticalOffset === 0 ? 'default' : fit.verticalOffset < 0 ? 'higher' : 'lower'}
        />
        <output htmlFor={offsetId}>
          {fit.verticalOffset === 0
            ? '0'
            : `${fit.verticalOffset < 0 ? '+' : '−'}${Math.round(Math.abs(fit.verticalOffset) * 100)}`}
        </output>
      </div>
      <button
        type="button"
        className="text-button"
        onClick={() => onChange(DEFAULT_USER_FIT)}
        disabled={isDefault}
      >
        Reset fit
      </button>
    </fieldset>
  );
}

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Check, Download, RefreshCw, RotateCcw, TriangleAlert } from 'lucide-react'
import { loadBlockTextures, useBlockTextures } from '../../lib/block-textures'
import {
  ACCENT_HEX,
  ACCENT_SWATCHES,
  BLOCKS,
  BLOCK_GROUPS,
  DEFAULT_CUSTOM_THEME,
  SURFACE_KEYS,
  SURFACE_LABELS,
  SURFACE_MODES,
  SURFACE_SWATCHES,
  THEME_PRESETS,
  accentVars,
  blockTexture,
  surfaceLayerStyle,
  type SurfaceKey,
  type ThemePreset,
} from '../../lib/custom-theme'
import type { AccentName, CustomThemeSettings, ThemeSurface } from '../../lib/types'
import { Button, Spinner, cx } from '../ui/primitives'

function cloneSurface(value: ThemeSurface): ThemeSurface {
  return { ...value }
}

/**
 * Settings → Appearance → Custom block theme.
 *
 * Textures come from the player's installed Minecraft client, so the studio
 * refuses to run without game files instead of showing placeholder art. Edits
 * only touch the local form; the Settings page saves and applies them.
 */
export function ThemeStudio({
  value,
  accent,
  onChange,
  onInstallRequest,
}: {
  value: CustomThemeSettings
  accent: AccentName
  onChange: (next: CustomThemeSettings) => void
  onInstallRequest: () => void
}) {
  const { status, loading, error } = useBlockTextures()
  const [surfaceKey, setSurfaceKey] = useState<SurfaceKey>('sidebar')
  const available = Boolean(status?.available)
  const textures = status?.textures ?? {}

  useEffect(() => {
    if (!status) void loadBlockTextures()
  }, [status])

  const availableBlocks = useMemo(() => BLOCKS.filter((block) => Boolean(textures[block.id])), [textures])
  const blockGroups = useMemo(
    () =>
      BLOCK_GROUPS.map((group) => ({
        group,
        blocks: availableBlocks.filter((block) => block.group === group),
      })).filter((entry) => entry.blocks.length > 0),
    [availableBlocks],
  )
  const availableIds = useMemo(() => new Set(availableBlocks.map((block) => block.id)), [availableBlocks])
  const presets = useMemo(
    () =>
      THEME_PRESETS.filter((preset) =>
        SURFACE_KEYS.every((key) => preset[key].mode !== 'block' || availableIds.has(preset[key].block)),
      ),
    [availableIds],
  )
  const fallbackBlock = availableBlocks[0]?.id ?? null

  // A profile change can remove the blocks an older theme used. Swap those
  // surfaces to a block the installed version actually ships.
  useEffect(() => {
    if (!fallbackBlock) return
    const patch: Partial<Record<SurfaceKey, ThemeSurface>> = {}
    for (const key of SURFACE_KEYS) {
      const surface = value[key]
      if (surface.mode === 'block' && !availableIds.has(surface.block)) {
        patch[key] = { ...surface, block: fallbackBlock }
      }
    }
    if (Object.keys(patch).length > 0) onChange({ ...value, ...patch })
  }, [availableIds, fallbackBlock, onChange, value])

  if (loading && !status) {
    return (
      <div className="theme-studio theme-studio--notice">
        <div className="theme-studio__loading">
          <Spinner />
          <span>Reading block textures from your Minecraft files…</span>
        </div>
      </div>
    )
  }

  if (!available || availableBlocks.length === 0 || !fallbackBlock) {
    return (
      <div className="theme-studio theme-studio--notice">
        <div className="callout callout--warning">
          <TriangleAlert />
          <div>
            <strong>Install Minecraft to use block themes</strong>
            <p>
              Custom themes use the block textures from an installed Minecraft version. Aqua does not bundle
              any game art, so this feature stays off until a version is installed.
            </p>
          </div>
        </div>
        {error ? <p className="theme-studio__hint">{error}</p> : null}
        {status && !status.available && status.versionId ? (
          <p className="theme-studio__hint">
            Minecraft {status.versionId} is installed, but its client jar has no readable block textures.
          </p>
        ) : null}
        <div className="theme-studio__notice-actions">
          <Button size="sm" variant="primary" icon={<Download />} onClick={onInstallRequest}>
            Open installations
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw />}
            loading={loading}
            onClick={() => void loadBlockTextures(true)}
          >
            Check again
          </Button>
        </div>
      </div>
    )
  }

  const surface = value[surfaceKey]
  const accentHex = value.accentMode === 'custom' ? value.accentColor : ACCENT_HEX[accent]
  const customAccentActive = (hex: string) =>
    value.accentMode === 'custom' && value.accentColor.toLowerCase() === hex
  // The colour input doubles as the "Custom" chip; keep it unmarked while the
  // chosen colour is one of the swatches shown beside it.
  const customChipActive =
    value.accentMode === 'custom' && !ACCENT_SWATCHES.includes(value.accentColor.toLowerCase())

  const patchSurface = (patch: Partial<ThemeSurface>) => {
    onChange({ ...value, [surfaceKey]: { ...surface, ...patch } })
  }

  const applyPreset = (preset: ThemePreset) => {
    onChange({
      ...value,
      sidebar: cloneSurface(preset.sidebar),
      titlebar: cloneSurface(preset.titlebar),
      backdrop: cloneSurface(preset.backdrop),
      accentMode: 'custom',
      accentColor: preset.accent,
    })
  }

  const activePreset = THEME_PRESETS.find(
    (preset) =>
      preset.sidebar.mode === value.sidebar.mode &&
      preset.titlebar.mode === value.titlebar.mode &&
      preset.backdrop.mode === value.backdrop.mode &&
      preset.sidebar.block === value.sidebar.block &&
      preset.titlebar.block === value.titlebar.block &&
      preset.backdrop.block === value.backdrop.block &&
      preset.accent.toLowerCase() === value.accentColor.toLowerCase(),
  )

  const reset = () => {
    onChange({
      ...DEFAULT_CUSTOM_THEME,
      enabled: true,
      sidebar: cloneSurface(DEFAULT_CUSTOM_THEME.sidebar),
      titlebar: cloneSurface(DEFAULT_CUSTOM_THEME.titlebar),
      backdrop: cloneSurface(DEFAULT_CUSTOM_THEME.backdrop),
    })
  }

  return (
    <div className="theme-studio">
      {presets.length > 0 ? (
        <div className="theme-studio__presets">
          <span className="theme-studio__label">Presets</span>
          <div className="theme-preset-row">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={cx('theme-preset', activePreset?.id === preset.id && 'is-selected')}
                onClick={() => applyPreset(preset)}
                aria-pressed={activePreset?.id === preset.id}
              >
                <span
                  className="theme-preset__swatch"
                  style={{ backgroundImage: `url("${blockTexture(preset.sidebar.block)}")` }}
                  aria-hidden="true"
                />
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div
        className="theme-preview"
        style={accentVars(accentHex) as CSSProperties}
        role="img"
        aria-label="Preview of the custom block theme"
      >
        <div className="theme-preview__backdrop" aria-hidden="true">
          <span className="theme-preview__layer" style={surfaceLayerStyle(value.backdrop)} />
        </div>
        <div className="theme-preview__titlebar" aria-hidden="true">
          <span className="theme-preview__layer" style={surfaceLayerStyle(value.titlebar)} />
          <span className="theme-preview__brand">
            <span className="theme-preview__icon" />
            Aqua
          </span>
          <span className="theme-preview__controls">
            <span />
            <span />
            <span />
          </span>
        </div>
        <div className="theme-preview__body" aria-hidden="true">
          <div className="theme-preview__sidebar">
            <span className="theme-preview__layer" style={surfaceLayerStyle(value.sidebar)} />
            <span className="theme-preview__nav is-active" />
            <span className="theme-preview__nav" />
            <span className="theme-preview__nav" />
            <span className="theme-preview__nav" />
          </div>
          <div className="theme-preview__main">
            <span className="theme-preview__heading" />
            <span className="theme-preview__line" />
            <span className="theme-preview__line theme-preview__line--short" />
            <span className="theme-preview__button">Play</span>
          </div>
        </div>
      </div>

      <div className="theme-studio__tabs" role="tablist" aria-label="Surface to customise">
        {SURFACE_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`theme-surface-tab-${key}`}
            aria-selected={surfaceKey === key}
            aria-controls="theme-surface-editor"
            className={cx('theme-studio__tab', surfaceKey === key && 'is-active')}
            onClick={() => setSurfaceKey(key)}
          >
            {SURFACE_LABELS[key].label}
            <small>{SURFACE_LABELS[key].hint}</small>
          </button>
        ))}
      </div>

      <div
        className="theme-studio__editor"
        id="theme-surface-editor"
        role="tabpanel"
        aria-labelledby={`theme-surface-tab-${surfaceKey}`}
      >
        <div
          className="segmented theme-studio__modes"
          role="radiogroup"
          aria-label={`${SURFACE_LABELS[surfaceKey].label} paint`}
        >
          {SURFACE_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={surface.mode === mode.value}
              className={cx(surface.mode === mode.value && 'is-active')}
              onClick={() => patchSurface({ mode: mode.value })}
              title={mode.hint}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {surface.mode === 'block' ? (
          <div className="block-picker">
            {blockGroups.map((group) => (
              <div className="block-picker__group" key={group.group}>
                <span className="block-picker__label">{group.group}</span>
                <div className="block-picker__grid">
                  {group.blocks.map((block) => (
                    <button
                      key={block.id}
                      type="button"
                      className={cx('block-tile', surface.block === block.id && 'is-selected')}
                      onClick={() => patchSurface({ block: block.id })}
                      aria-label={block.label}
                      aria-pressed={surface.block === block.id}
                      title={block.label}
                    >
                      <span
                        className="block-tile__texture"
                        style={{ backgroundImage: `url("${blockTexture(block.id)}")` }}
                        aria-hidden="true"
                      />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {surface.mode === 'color' ? (
          <div className="theme-color">
            <input
              type="color"
              className="theme-color__input"
              value={surface.color}
              onChange={(event) => patchSurface({ color: event.target.value })}
              aria-label="Surface colour"
            />
            <div className="theme-color__swatches">
              {SURFACE_SWATCHES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className={cx('theme-color__swatch', surface.color === hex && 'is-selected')}
                  style={{ background: hex }}
                  onClick={() => patchSurface({ color: hex })}
                  aria-label={`Colour ${hex}`}
                  aria-pressed={surface.color === hex}
                  title={hex}
                />
              ))}
            </div>
            <span className="theme-color__hex">{surface.color}</span>
          </div>
        ) : null}

        {surface.mode !== 'off' ? (
          <div className="theme-slider">
            <div className="field__label">
              <span>Opacity</span>
              <span className="field__label-note">{surface.opacity}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={surface.opacity}
              onChange={(event) => patchSurface({ opacity: Number(event.target.value) })}
              style={{ '--range-fill': `${surface.opacity}%` } as CSSProperties}
              aria-label={`${SURFACE_LABELS[surfaceKey].label} opacity`}
            />
          </div>
        ) : null}

        {surface.mode === 'block' ? (
          <div className="theme-slider">
            <div className="field__label">
              <span>Tile size</span>
              <span className="field__label-note">{surface.pixelSize}px</span>
            </div>
            <input
              type="range"
              min={16}
              max={128}
              step={8}
              value={surface.pixelSize}
              onChange={(event) => patchSurface({ pixelSize: Number(event.target.value) })}
              style={{ '--range-fill': `${((surface.pixelSize - 16) / 112) * 100}%` } as CSSProperties}
              aria-label={`${SURFACE_LABELS[surfaceKey].label} tile size`}
            />
          </div>
        ) : null}
      </div>

      <div className="theme-studio__accent">
        <div className="field__label">
          <span>Accent colour</span>
          <span className="field__label-note">Buttons, links, highlights</span>
        </div>
        <div className="accent-row" role="radiogroup" aria-label="Custom theme accent">
          <button
            type="button"
            role="radio"
            aria-checked={value.accentMode === 'theme'}
            className={cx('accent-choice', value.accentMode === 'theme' && 'is-selected')}
            onClick={() => onChange({ ...value, accentMode: 'theme' })}
            title="Use the accent chosen above"
          >
            <span className="accent-choice__dot" style={{ background: ACCENT_HEX[accent] }} />
            Theme accent
            {value.accentMode === 'theme' ? <Check /> : null}
          </button>
          {ACCENT_SWATCHES.map((hex) => (
            <button
              key={hex}
              type="button"
              className={cx('accent-swatch', customAccentActive(hex) && 'is-selected')}
              onClick={() => onChange({ ...value, accentMode: 'custom', accentColor: hex })}
              aria-label={`Accent colour ${hex}`}
              aria-pressed={customAccentActive(hex)}
              title={hex}
            >
              <span style={{ background: hex }} aria-hidden="true" />
            </button>
          ))}
          <label
            className={cx('accent-custom', customChipActive && 'is-selected')}
            title="Pick any accent colour"
          >
            <input
              type="color"
              value={value.accentColor}
              onChange={(event) =>
                onChange({ ...value, accentMode: 'custom', accentColor: event.target.value })
              }
              aria-label="Custom accent colour"
            />
            <span className="accent-choice__dot" style={{ background: value.accentColor }} aria-hidden="true" />
            Custom
          </label>
        </div>
      </div>

      <div className="theme-studio__footer">
        <span className="theme-studio__hint">
          {availableBlocks.length} block texture{availableBlocks.length === 1 ? '' : 's'} read from Minecraft{' '}
          {status?.versionId ?? 'game files'} — nothing is bundled.
        </span>
        <div className="theme-studio__footer-actions">
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw />}
            loading={loading}
            onClick={() => void loadBlockTextures(true)}
          >
            Reload textures
          </Button>
          <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={reset}>
            Reset
          </Button>
        </div>
      </div>
    </div>
  )
}

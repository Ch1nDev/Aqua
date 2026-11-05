import type { CSSProperties } from 'react'
import { cx } from '../ui/primitives'

const TEXTURE_SIZE = 64
const FACE = { x: 8, y: 8, size: 8 }
const FACE_OVERLAY = { x: 40, y: 8, size: 8 }
// Head/body front faces, plus the classic arm and leg fronts of a 64×64 skin.
const FIGURE = {
  head: { x: 8, y: 8, width: 8, height: 8 },
  headOverlay: { x: 40, y: 8, width: 8, height: 8 },
  body: { x: 20, y: 20, width: 8, height: 12 },
  rightArm: { x: 44, y: 20, width: 4, height: 12 },
  leftArm: { x: 36, y: 52, width: 4, height: 12 },
  rightLeg: { x: 4, y: 20, width: 4, height: 12 },
  leftLeg: { x: 20, y: 52, width: 4, height: 12 },
}

/**
 * The head is 8 texture pixels square, so the whole 64-pixel sheet drawn at
 * 800% shows exactly one region; the percentage keeps any avatar size crisp.
 */
function faceLayer(texture: string, source: { x: number; y: number; size: number }): CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    backgroundImage: `url("${texture}")`,
    backgroundSize: '800% 800%',
    backgroundPosition: `${(-source.x / (TEXTURE_SIZE - source.size)) * 100}% ${(-source.y / (TEXTURE_SIZE - source.size)) * 100}%`,
    backgroundRepeat: 'no-repeat',
    imageRendering: 'pixelated',
  }
}

/** One texture rectangle drawn at a scaled position inside a skin figure. */
function partStyle(
  texture: string,
  scale: number,
  source: { x: number; y: number; width: number; height: number },
  left: number,
  top: number,
): CSSProperties {
  return {
    position: 'absolute',
    left: `${left * scale}px`,
    top: `${top * scale}px`,
    width: `${source.width * scale}px`,
    height: `${source.height * scale}px`,
    backgroundImage: `url("${texture}")`,
    backgroundSize: `${TEXTURE_SIZE * scale}px ${TEXTURE_SIZE * scale}px`,
    backgroundPosition: `${-source.x * scale}px ${-source.y * scale}px`,
    backgroundRepeat: 'no-repeat',
    imageRendering: 'pixelated',
  }
}

/**
 * The 8×8 face of a skin texture, drawn straight from the PNG so offline
 * profiles and library skins look like themselves without a render service.
 */
export function SkinFace({
  texture,
  size = 44,
  className,
}: {
  texture: string
  size?: number
  className?: string
}) {
  return (
    <span className={cx('skin-face', className)} style={{ width: size, height: size }} aria-hidden="true">
      <span className="skin-face__layer" style={faceLayer(texture, FACE)} />
      <span className="skin-face__layer" style={faceLayer(texture, FACE_OVERLAY)} />
    </span>
  )
}

/** A flat front view of the whole player, sized from the skin's own pixels. */
export function SkinFigure({
  texture,
  model = 'classic',
  scale = 4,
  className,
}: {
  texture: string
  model?: 'classic' | 'slim'
  scale?: number
  className?: string
}) {
  const armWidth = model === 'slim' ? 3 : 4
  const headLeft = armWidth
  return (
    <span
      className={cx('skin-figure', className)}
      style={{ width: (8 + armWidth * 2) * scale, height: 32 * scale }}
      aria-hidden="true"
    >
      <span style={partStyle(texture, scale, FIGURE.head, headLeft, 0)} />
      <span style={partStyle(texture, scale, FIGURE.headOverlay, headLeft, 0)} />
      <span style={partStyle(texture, scale, FIGURE.body, headLeft, 8)} />
      <span style={partStyle(texture, scale, { ...FIGURE.rightArm, width: armWidth }, 0, 8)} />
      <span style={partStyle(texture, scale, { ...FIGURE.leftArm, width: armWidth }, headLeft + 8, 8)} />
      <span style={partStyle(texture, scale, FIGURE.rightLeg, headLeft, 20)} />
      <span style={partStyle(texture, scale, FIGURE.leftLeg, headLeft + 4, 20)} />
    </span>
  )
}

/** Avatar-sized head that matches the profile's chosen skin. */
export function SkinAvatar({
  name,
  texture,
  size = 'md',
  className,
}: {
  name?: string | null
  texture: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}) {
  const sizeClass = size === 'md' ? '' : `avatar--${size}`
  return (
    <span
      className={cx('avatar', 'avatar--skin', sizeClass, className)}
      title={name || undefined}
      aria-hidden="true"
    >
      <span
        className="avatar__skin"
        style={{
          backgroundImage: `url("${texture}")`,
          backgroundSize: '800% 800%',
          backgroundPosition: '-14.2857% -14.2857%',
        }}
      />
      <span
        className="avatar__skin"
        style={{
          backgroundImage: `url("${texture}")`,
          backgroundSize: '800% 800%',
          backgroundPosition: '-71.4286% -14.2857%',
        }}
      />
    </span>
  )
}

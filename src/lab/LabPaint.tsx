import { useId } from 'react'
import roundPaint from './assets/paint-round-splat-mask.svg'
import splashPaint from './assets/paint-splash-mask.svg'

type LabPaintProps = {
  shape: 'round' | 'splash'
  palette?: 'pink' | 'cyan' | 'rainbow'
  className?: string
}

type Pigment = {
  colors: readonly string[]
  edge: string
  light: string
}

const PIGMENTS: Record<NonNullable<LabPaintProps['palette']>, Pigment> = {
  pink: {
    colors: ['#ffb8df', '#ff69bc', '#f52191', '#c50c70', '#710b49'],
    edge: '#630337',
    light: '#fff3fb',
  },
  cyan: {
    colors: ['#b3fff5', '#38edee', '#08bfcf', '#087ba5', '#14376b'],
    edge: '#063c59',
    light: '#effffd',
  },
  rainbow: {
    colors: ['#79f5df', '#21c7eb', '#6960ec', '#e52db0', '#ff608c', '#ffc468'],
    edge: '#3d104f',
    light: '#fff7ff',
  },
}

/**
 * A static material treatment over the original human-made paint silhouettes.
 * Outline credits remain in assets/SOURCES.md; the SVG lighting is OSA styling.
 */
export function LabPaint({ shape, palette = 'pink', className }: LabPaintProps) {
  const instanceId = `lab-paint-${useId().replace(/:/g, '')}`
  const silhouetteId = `${instanceId}-silhouette`
  const pigmentId = `${instanceId}-pigment`
  const sheenId = `${instanceId}-sheen`
  const finishId = `${instanceId}-finish`
  const pigment = PIGMENTS[palette]

  return (
    <svg
      className={className}
      viewBox="0 0 300 300"
      width="100%"
      height="100%"
      aria-hidden="true"
      focusable="false"
      pointerEvents="none"
    >
      <defs>
        <mask
          id={silhouetteId}
          x="0"
          y="0"
          width="300"
          height="300"
          maskUnits="userSpaceOnUse"
          maskContentUnits="userSpaceOnUse"
          style={{ maskType: 'alpha' }}
        >
          <image
            href={shape === 'round' ? roundPaint : splashPaint}
            x="12"
            y="12"
            width="276"
            height="276"
            preserveAspectRatio="xMidYMid meet"
          />
        </mask>

        <linearGradient id={pigmentId} x1="13%" y1="7%" x2="82%" y2="94%">
          {pigment.colors.map((color, index) => (
            <stop
              key={color}
              offset={`${(index / (pigment.colors.length - 1)) * 100}%`}
              stopColor={color}
            />
          ))}
        </linearGradient>

        <radialGradient
          id={sheenId}
          cx="35%"
          cy="27%"
          r="54%"
          gradientTransform="translate(0 .09) scale(1 .72)"
        >
          <stop offset="0%" stopColor={pigment.light} stopOpacity="0.28" />
          <stop offset="37%" stopColor={pigment.light} stopOpacity="0.08" />
          <stop offset="100%" stopColor={pigment.light} stopOpacity="0" />
        </radialGradient>

        <filter
          id={finishId}
          x="0"
          y="0"
          width="300"
          height="300"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          {/* The parent group is already masked, so lighting follows paint edges. */}
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.5" result="surface" />
          <feSpecularLighting
            in="surface"
            surfaceScale="2.5"
            specularConstant="0.38"
            specularExponent="22"
            lightingColor={pigment.light}
            result="rimLight"
          >
            <feDistantLight azimuth="225" elevation="52" />
          </feSpecularLighting>
          <feComposite in="rimLight" in2="SourceAlpha" operator="in" result="clippedLight" />
          <feBlend in="SourceGraphic" in2="clippedLight" mode="screen" result="litPigment" />

          <feOffset in="SourceAlpha" dx="0.6" dy="2" result="thickness" />
          <feFlood floodColor={pigment.edge} floodOpacity="0.85" result="edgeColor" />
          <feComposite in="edgeColor" in2="thickness" operator="in" result="paintEdge" />

          <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="shadowBlur" />
          <feOffset in="shadowBlur" dx="0" dy="5" result="shadowOffset" />
          <feFlood floodColor="#020107" floodOpacity="0.58" result="shadowColor" />
          <feComposite in="shadowColor" in2="shadowOffset" operator="in" result="paintShadow" />

          <feMerge>
            <feMergeNode in="paintShadow" />
            <feMergeNode in="paintEdge" />
            <feMergeNode in="litPigment" />
          </feMerge>
        </filter>
      </defs>

      {/* Keep the filter outside the mask: cast shadows extend past the pigment. */}
      <g filter={`url(#${finishId})`}>
        <g mask={`url(#${silhouetteId})`}>
          <rect width="300" height="300" fill={`url(#${pigmentId})`} />
          <rect width="300" height="300" fill={`url(#${sheenId})`} />
        </g>
      </g>
    </svg>
  )
}

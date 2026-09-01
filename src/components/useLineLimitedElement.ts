import {
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'

const DESCRIPTION_LINE_LIMIT = 5

type LineLimitedElementOptions = {
  value: string
  autoSize: boolean
  lines?: number
}

function pixels(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function elementLineHeight(styles: CSSStyleDeclaration) {
  const lineHeight = pixels(styles.lineHeight)
  return lineHeight || pixels(styles.fontSize) * 1.2
}

/** Measure actual wrapped DOM content, including updates caused by width changes. */
export function useLineLimitedElement<T extends HTMLElement>({
  value,
  autoSize,
  lines = DESCRIPTION_LINE_LIMIT,
}: LineLimitedElementOptions): {
  ref: RefObject<T | null>
  hasOverflow: boolean
  expanded: boolean
  setExpanded: Dispatch<SetStateAction<boolean>>
} {
  const ref = useRef<T>(null)
  const [hasOverflow, setHasOverflow] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) {
      setHasOverflow(false)
      return
    }

    let resetExpandedFrame = 0
    const measure = () => {
      const styles = window.getComputedStyle(element)
      const lineHeight = elementLineHeight(styles)
      const padding = pixels(styles.paddingTop) + pixels(styles.paddingBottom)
      const border = pixels(styles.borderTopWidth) + pixels(styles.borderBottomWidth)
      const collapsedBorderHeight = (lineHeight * lines) + padding + border

      if (autoSize) element.style.height = 'auto'
      const naturalBorderHeight = Math.ceil(element.scrollHeight + border)
      const nextHasOverflow = naturalBorderHeight > Math.ceil(collapsedBorderHeight) + 1

      if (autoSize) {
        const minimumHeight = pixels(styles.minHeight)
        const requestedHeight = expanded
          ? naturalBorderHeight
          : Math.min(naturalBorderHeight, collapsedBorderHeight)
        const nextHeight = `${Math.ceil(Math.max(minimumHeight, requestedHeight))}px`
        if (element.style.height !== nextHeight) element.style.height = nextHeight
      } else {
        const nextMaxHeight = expanded ? 'none' : `${Math.ceil(lineHeight * lines)}px`
        if (element.style.maxHeight !== nextMaxHeight) element.style.maxHeight = nextMaxHeight
      }

      setHasOverflow((current) => current === nextHasOverflow ? current : nextHasOverflow)
      if (!nextHasOverflow && expanded) {
        window.cancelAnimationFrame(resetExpandedFrame)
        resetExpandedFrame = window.requestAnimationFrame(() => setExpanded(false))
      }
    }

    measure()

    let observedWidth = element.getBoundingClientRect().width
    let observedLineHeight = elementLineHeight(window.getComputedStyle(element))
    let measureFrame = 0
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(measureFrame)
      measureFrame = window.requestAnimationFrame(measure)
    }
    const resizeObserver = new ResizeObserver(([entry]) => {
      const nextWidth = entry?.contentRect.width ?? element.getBoundingClientRect().width
      const nextLineHeight = elementLineHeight(window.getComputedStyle(element))
      if (
        Math.abs(nextWidth - observedWidth) < 0.5
        && Math.abs(nextLineHeight - observedLineHeight) < 0.1
      ) return
      observedWidth = nextWidth
      observedLineHeight = nextLineHeight
      scheduleMeasure()
    })
    resizeObserver.observe(element)
    window.addEventListener('resize', scheduleMeasure)

    let cancelled = false
    void document.fonts?.ready.then(() => {
      if (!cancelled) scheduleMeasure()
    })

    return () => {
      cancelled = true
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
      window.cancelAnimationFrame(measureFrame)
      window.cancelAnimationFrame(resetExpandedFrame)
    }
  }, [autoSize, expanded, lines, value])

  return { ref, hasOverflow, expanded, setExpanded }
}

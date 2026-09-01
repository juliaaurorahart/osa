import { useId } from 'react'
import { useLineLimitedElement } from './useLineLimitedElement'
import './AssemblyDescription.css'

type AssemblyDescriptionProps = {
  text: string
  title: string
  className?: string
}

/** Read-only Assembly description with a measured five-line disclosure. */
export function AssemblyDescription({
  text,
  title,
  className = '',
}: AssemblyDescriptionProps) {
  const descriptionId = useId()
  const {
    ref,
    hasOverflow,
    expanded,
    setExpanded,
  } = useLineLimitedElement<HTMLParagraphElement>({
    value: text,
    autoSize: false,
  })

  return (
    <div className="assembly-description">
      <p
        id={descriptionId}
        ref={ref}
        className={`${className}${expanded ? ' is-expanded' : ' is-collapsed'}`}
      >
        {text}
      </p>
      {hasOverflow ? (
        <button
          className="assembly-description__toggle text-action"
          type="button"
          aria-controls={descriptionId}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Show less of' : 'Show more of'} ${title} description`}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'less…' : 'more…'}
        </button>
      ) : null}
    </div>
  )
}

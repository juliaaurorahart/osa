import { OSA_PROPERTY } from '../graph/osaData'
import type { TextFlowNode } from '../graph/textNode'
import { nodeTitle } from './assemblyProjection'
import {
  ASSEMBLY_INDEX_CARD_ID,
  transparentInput,
} from './assemblyViewPresentation'
import './AssemblyIndexCard.css'

export type AssemblyInstructionSummary = {
  operation: TextFlowNode
  before: TextFlowNode[]
  after: TextFlowNode | null
  stepCount: number
  toolCount: number
  completedCount: number
}

type AssemblyIndexCardProps = {
  assembly: TextFlowNode
  instructionSummaries: AssemblyInstructionSummary[]
  readOnly: boolean
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  onFocusCard: (cardId: string) => void
  onOpenOperation: (operationId: string) => void
  onNameChange: (nodeId: string, name: string) => void
  onMoveOperation: (operationId: string, position: number) => void
  onRemoveOperation: (operationId: string) => void
  onAddCard: () => void
}

/** The Assembly title and ordered table-of-contents card. */
export function AssemblyIndexCard({
  assembly,
  instructionSummaries,
  readOnly,
  isOpen,
  onOpen,
  onClose,
  onFocusCard,
  onOpenOperation,
  onNameChange,
  onMoveOperation,
  onRemoveOperation,
  onAddCard,
}: AssemblyIndexCardProps) {
  const operations = instructionSummaries.map(({ operation }) => operation)

  return (
    <article
      className={`assembly-card assembly-index-card${isOpen ? ' is-focused is-open' : ' is-summary'}`}
      aria-label="assembly index card"
    >
      {isOpen ? (
        <>
          <div className="assembly-card__focus-controls">
            <button
              className="assembly-card__close-button"
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onClose()
              }}
            >
              Done
            </button>
          </div>

          <input
            aria-label="assembly title"
            placeholder="assembly title"
            value={assembly.data.name}
            readOnly={readOnly}
            onFocus={() => onFocusCard(ASSEMBLY_INDEX_CARD_ID)}
            onChange={(event) => {
              if (!readOnly) onNameChange(assembly.id, event.target.value)
            }}
            style={{
              ...transparentInput,
              marginBottom: 'clamp(18px, 3vw, 34px)',
              fontSize: 'clamp(1.8rem, 4vw, 3.25rem)',
              lineHeight: 1.08,
            }}
          />
          <div className="assembly-index-card__title-list">
            <div style={{ display: 'grid', alignContent: 'start', gap: 8 }}>
              <ol className="assembly-index-card__organize-list">
                {operations.length ? operations.map((operation, operationIndex) => (
                  <li key={operation.id}>
                    {readOnly ? (
                      <button
                        className="assembly-index-card__organize-open"
                        type="button"
                        onClick={() => onOpenOperation(operation.id)}
                      >
                        {nodeTitle(operation)}
                      </button>
                    ) : (
                      <div className="assembly-index-card__organize-row">
                        <span className="assembly-index-card__organize-number">{operationIndex + 1}</span>
                        <input
                          className="assembly-index-card__organize-name"
                          aria-label={`Card ${nodeTitle(operation)} name`}
                          value={operation.data.name}
                          placeholder="card name"
                          onClick={(event) => event.stopPropagation()}
                          onFocus={() => onFocusCard(operation.id)}
                          onChange={(event) => onNameChange(operation.id, event.target.value)}
                          style={transparentInput}
                        />
                        <select
                          className="assembly-index-card__organize-position"
                          aria-label={`Move ${nodeTitle(operation)} to position`}
                          value={operationIndex + 1}
                          onChange={(event) => onMoveOperation(operation.id, Number(event.currentTarget.value))}
                        >
                          {operations.map((_, positionIndex) => (
                            <option value={positionIndex + 1} key={positionIndex + 1}>
                              {positionIndex + 1}
                            </option>
                          ))}
                        </select>
                        <button
                          className="text-action"
                          type="button"
                          onClick={() => onOpenOperation(operation.id)}
                        >
                          edit
                        </button>
                        <button
                          className="text-action"
                          type="button"
                          aria-label={`remove ${nodeTitle(operation)} card`}
                          title="Remove card"
                          onClick={(event) => {
                            event.stopPropagation()
                            onRemoveOperation(operation.id)
                          }}
                          style={{ paddingInline: 4 }}
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </li>
                )) : <li style={{ color: 'var(--osa-muted)' }}>add the first instruction card.</li>}
              </ol>
              {!readOnly ? (
                <button
                  className="text-action"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onAddCard()
                  }}
                  style={{ justifySelf: 'start' }}
                >
                  + instruction
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <div className="assembly-card__summary assembly-index-card__summary">
          <div className="assembly-index-card__summary-header">
            <button
              className="assembly-index-card__summary-title-button"
              type="button"
              aria-label={`Edit ${nodeTitle(assembly)} summary`}
              onClick={onOpen}
            >
              <strong className="assembly-card__summary-title">{nodeTitle(assembly)}</strong>
            </button>
            {operations.length ? (
              <span className="assembly-index-card__summary-total">
                {operations.length} {operations.length === 1 ? 'instruction' : 'instructions'}
              </span>
            ) : null}
          </div>
          {operations.length ? (
            <ol className="assembly-index-card__summary-index" aria-label="instruction cards">
              {instructionSummaries.map((summary, operationIndex) => {
                const {
                  operation,
                  before,
                  after,
                  stepCount,
                  toolCount,
                  completedCount,
                } = summary
                const operationTitle = nodeTitle(operation)
                const beforeImage = before.find((part) => (
                  part.data.properties[OSA_PROPERTY.assetImage]?.trim()
                ))
                const beforeImageSource = beforeImage
                  ?.data.properties[OSA_PROPERTY.assetImage]?.trim()
                const afterImageSource = after
                  ?.data.properties[OSA_PROPERTY.assetImage]?.trim()

                return (
                  <li key={operation.id}>
                    <button
                      className="assembly-index-card__summary-step"
                      type="button"
                      aria-label={`Edit ${operationTitle} instruction`}
                      onClick={() => onOpenOperation(operation.id)}
                    >
                      <span className="assembly-index-card__summary-marker" aria-hidden="true">
                        {operationIndex + 1}
                      </span>
                      <span className="assembly-index-card__summary-step-title">
                        {operationTitle}
                      </span>
                    </button>
                    <div
                      className="assembly-index-card__summary-info"
                      aria-label={`${operationTitle} overview`}
                    >
                      <div className="assembly-index-card__summary-object">
                        {beforeImageSource ? (
                          <img
                            className="assembly-index-card__summary-thumbnail"
                            src={beforeImageSource}
                            alt={beforeImage?.data.properties[OSA_PROPERTY.assetImageAlt]?.trim()
                              || nodeTitle(beforeImage!)}
                            loading="lazy"
                            decoding="async"
                          />
                        ) : null}
                        <span className="assembly-index-card__summary-object-copy">
                          <span className="assembly-index-card__summary-label">Before</span>
                          <span
                            className="assembly-index-card__summary-value"
                            aria-label={`${operationTitle} before`}
                          >
                            {before.length ? before.map(nodeTitle).join(', ') : '—'}
                          </span>
                        </span>
                      </div>
                      <span className="assembly-index-card__summary-flow-arrow" aria-hidden="true">→</span>
                      <div className="assembly-index-card__summary-object">
                        {afterImageSource ? (
                          <img
                            className="assembly-index-card__summary-thumbnail"
                            src={afterImageSource}
                            alt={after?.data.properties[OSA_PROPERTY.assetImageAlt]?.trim()
                              || nodeTitle(after!)}
                            loading="lazy"
                            decoding="async"
                          />
                        ) : null}
                        <span className="assembly-index-card__summary-object-copy">
                          <span className="assembly-index-card__summary-label">After</span>
                          <span
                            className="assembly-index-card__summary-value"
                            aria-label={`${operationTitle} after`}
                          >
                            {after ? nodeTitle(after) : '—'}
                          </span>
                        </span>
                      </div>
                      <dl className="assembly-index-card__summary-metrics">
                        <div>
                          <dt>steps</dt>
                          <dd aria-label={`${operationTitle} steps`}>{stepCount}</dd>
                        </div>
                        <div>
                          <dt>tools</dt>
                          <dd aria-label={`${operationTitle} tools`}>{toolCount}</dd>
                        </div>
                        <div>
                          <dt>complete</dt>
                          <dd aria-label={`${operationTitle} complete`}><b>{completedCount}</b> complete</dd>
                        </div>
                      </dl>
                    </div>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="assembly-index-card__empty">No instructions yet.</p>
          )}
          {!readOnly ? (
            <button className="text-action assembly-index-card__summary-add" type="button" onClick={onAddCard}>
              + instruction
            </button>
          ) : null}
        </div>
      )}
    </article>
  )
}

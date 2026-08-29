import type { TextFlowNode } from '../graph/textNode'
import { nodeTitle } from './assemblyProjection'
import {
  ASSEMBLY_INDEX_CARD_ID,
  cardFocusStyle,
  cardKeyDown,
  cardShell,
  transparentInput,
} from './assemblyViewPresentation'
import './AssemblyIndexCard.css'

type AssemblyIndexCardProps = {
  assembly: TextFlowNode
  operations: TextFlowNode[]
  readOnly: boolean
  isOpen: boolean
  isLocked: boolean
  onOpen: () => void
  onClose: () => void
  onToggleLock: () => void
  onFocusCard: (cardId: string) => void
  onNameChange: (nodeId: string, name: string) => void
  onReorderOperation: (operationId: string, direction: 'up' | 'down') => void
  onRemoveOperation: (operationId: string) => void
  onAddCard: () => void
}

/** The Assembly title and ordered table-of-contents card. */
export function AssemblyIndexCard({
  assembly,
  operations,
  readOnly,
  isOpen,
  isLocked,
  onOpen,
  onClose,
  onToggleLock,
  onFocusCard,
  onNameChange,
  onReorderOperation,
  onRemoveOperation,
  onAddCard,
}: AssemblyIndexCardProps) {
  return (
    <article
      className={`assembly-card assembly-index-card${isOpen ? ' is-focused is-open' : ' is-summary'}`}
      style={{ ...cardShell, ...(isOpen ? {} : { padding: 0 }), ...cardFocusStyle(isOpen) }}
      tabIndex={0}
      aria-label="assembly index card"
      onClick={() => {
        if (!isOpen) onOpen()
      }}
      onKeyDown={(event) => cardKeyDown(event, onOpen)}
    >
      {isOpen ? (
        <>
          <div className="assembly-card__focus-controls">
            <button
              className="assembly-card__lock-button"
              type="button"
              aria-pressed={isLocked}
              aria-label={isLocked
                ? 'unlock Assembly index and show all cards'
                : 'lock Assembly index in a single-card view'}
              onClick={(event) => {
                event.stopPropagation()
                onToggleLock()
              }}
            >
              {isLocked ? 'unlock card view' : 'lock this card'}
            </button>
            <button
              className="assembly-card__close-button"
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onClose()
              }}
            >
              close details
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
              fontSize: 'clamp(1.5rem, 4vw, 3.1rem)',
              lineHeight: 1.08,
            }}
          />
          <div className="assembly-index-card__title-list">
            <div style={{ display: 'grid', alignContent: 'start', gap: 8 }}>
              <ol style={{ margin: 0, paddingLeft: '1.45em', fontSize: 'clamp(0.8rem, 1.8vw, 1.35rem)', lineHeight: 1.55 }}>
                {operations.length ? operations.map((operation, operationIndex) => (
                  <li key={operation.id}>
                    {readOnly ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onFocusCard(operation.id)
                        }}
                        style={{ padding: 0, border: 0, background: 'transparent', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer' }}
                      >
                        {nodeTitle(operation)}
                      </button>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, width: '100%', minWidth: 0 }}>
                        <input
                          aria-label={`Card ${nodeTitle(operation)} name`}
                          value={operation.data.name}
                          placeholder="card name"
                          onClick={(event) => event.stopPropagation()}
                          onFocus={() => onFocusCard(operation.id)}
                          onChange={(event) => onNameChange(operation.id, event.target.value)}
                          style={{ ...transparentInput, flex: '1 1 auto', minWidth: 0, font: 'inherit' }}
                        />
                        <span style={{ display: 'inline-flex', gap: 2 }}>
                          <button
                            className="text-action"
                            type="button"
                            aria-label={`move ${nodeTitle(operation)} card up`}
                            title="Move card up"
                            disabled={operationIndex === 0}
                            onClick={(event) => {
                              event.stopPropagation()
                              onReorderOperation(operation.id, 'up')
                            }}
                          >
                            ↑
                          </button>
                          <button
                            className="text-action"
                            type="button"
                            aria-label={`move ${nodeTitle(operation)} card down`}
                            title="Move card down"
                            disabled={operationIndex === operations.length - 1}
                            onClick={(event) => {
                              event.stopPropagation()
                              onReorderOperation(operation.id, 'down')
                            }}
                          >
                            ↓
                          </button>
                        </span>
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
                      </span>
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
                  + card
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <button
          className="assembly-card__summary"
          type="button"
          aria-label={`Open ${nodeTitle(assembly)} details`}
          aria-expanded={false}
          onClick={onOpen}
        >
          <strong className="assembly-card__summary-title">{nodeTitle(assembly)}</strong>
          {operations.length ? (
            <ol className="assembly-index-card__summary-index" aria-label="instruction cards">
              {operations.map((operation) => (
                <li key={operation.id}>{nodeTitle(operation)}</li>
              ))}
            </ol>
          ) : null}
        </button>
      )}
    </article>
  )
}

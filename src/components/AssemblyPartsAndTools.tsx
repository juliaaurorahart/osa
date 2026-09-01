import { appearanceAccentColor } from '../graph/osaData'
import type { TextFlowNode } from '../graph/textNode'
import type { AssemblyToolDraft } from './assemblyViewState'
import { nodeTitle } from './assemblyProjection'
import {
  NEW_PART_OPTION,
  NEW_TOOL_OPTION,
  PLACEHOLDER_TOOL_OPTION,
  semanticAccentStyle,
  transparentInput,
} from './assemblyViewPresentation'
import './AssemblyPartsAndTools.css'

type AssemblyPartsAndToolsProps = {
  operation: TextFlowNode
  inputParts: TextFlowNode[]
  tools: TextFlowNode[]
  availableParts: TextFlowNode[]
  toolInventory: TextFlowNode[]
  focused: boolean
  readOnly: boolean
  toolDraft: string
  toolDraftFor: AssemblyToolDraft | null
  onInspectNode: (nodeId: string) => void
  onLinkPart: (operationId: string, partId: string) => void
  onLinkPartInput?: (operationId: string, partId: string) => void
  onUnlinkPartInput?: (operationId: string, partId: string) => void
  onCreatePartForOperation?: (operationId: string, direction: 'input' | 'output') => string
  onCreateTool: (
    operationId: string,
    name: string,
    options?: { placeholder?: boolean },
  ) => string
  onLinkTool?: (operationId: string, toolId: string) => void
  onUnlinkTool?: (operationId: string, toolId: string) => void
  onToolDraftChange: (value: string) => void
  onToolDraftForChange: (value: AssemblyToolDraft | null) => void
}

/** Linked input parts and tools, including the focused-card authoring controls. */
export function AssemblyPartsAndTools({
  operation,
  inputParts,
  tools,
  availableParts,
  toolInventory,
  focused,
  readOnly,
  toolDraft,
  toolDraftFor,
  onInspectNode,
  onLinkPart,
  onLinkPartInput,
  onUnlinkPartInput,
  onCreatePartForOperation,
  onCreateTool,
  onLinkTool,
  onUnlinkTool,
  onToolDraftChange,
  onToolDraftForChange,
}: AssemblyPartsAndToolsProps) {
  if (readOnly && inputParts.length === 0 && tools.length === 0) return null

  return (
    <section
      className="assembly-parts-tools"
      aria-label={`${nodeTitle(operation)} parts and tools`}
    >
      <div className={`assembly-parts-tools__field${inputParts.length ? '' : ' is-empty'}`}>
        {inputParts.length ? <span className="assembly-parts-tools__field-label">parts</span> : null}
        <div style={{ minWidth: 0 }}>
          <div className="assembly-linked-object-list">
            {inputParts.length
              ? inputParts.map((part) => (
                <span className="assembly-object-chip" key={part.id}>
                  <button
                    className={appearanceAccentColor(part)
                      ? 'assembly-object-link assembly-object-link--accented'
                      : 'assembly-object-link'}
                    type="button"
                    style={semanticAccentStyle(part)}
                    onClick={(event) => {
                      event.stopPropagation()
                      onInspectNode(part.id)
                    }}
                  >
                    {nodeTitle(part)}
                  </button>
                  {focused && !readOnly && onUnlinkPartInput ? (
                    <button
                      className="assembly-object-unlink"
                      type="button"
                      title="remove from this instruction's in list"
                      aria-label={`remove ${nodeTitle(part)} from this instruction's in list`}
                      onClick={(event) => {
                        event.stopPropagation()
                        onUnlinkPartInput(operation.id, part.id)
                      }}
                    >
                      <span aria-hidden="true">×</span> remove
                    </button>
                  ) : null}
                </span>
              ))
              : null}
          </div>
          {focused && !readOnly ? (
            <select
              className="assembly-parts-tools__add-select"
              aria-label="link or add a part coming into this instruction"
              defaultValue=""
              onChange={(event) => {
                const partId = event.currentTarget.value
                event.currentTarget.value = ''
                if (partId === NEW_PART_OPTION) {
                  onCreatePartForOperation?.(operation.id, 'input')
                  return
                }
                if (partId) (onLinkPartInput ?? onLinkPart)(operation.id, partId)
              }}
              style={{
                ...transparentInput,
                marginTop: 5,
                borderBottom: '1px solid var(--osa-border)',
                color: 'var(--osa-muted)',
              }}
            >
              <option value="">+ part</option>
              {availableParts.map((part) => {
                const isLinked = inputParts.some((linkedPart) => linkedPart.id === part.id)
                return (
                  <option value={part.id} disabled={isLinked} key={part.id}>
                    {isLinked
                      ? `${nodeTitle(part)} · already in this instruction`
                      : nodeTitle(part)}
                  </option>
                )
              })}
              {onCreatePartForOperation ? (
                <optgroup label="create">
                  <option value={NEW_PART_OPTION}>+ add a part placeholder…</option>
                </optgroup>
              ) : null}
            </select>
          ) : null}
        </div>
      </div>

      <div className={`assembly-parts-tools__field${tools.length ? '' : ' is-empty'}`}>
        {tools.length ? <span className="assembly-parts-tools__field-label">tools</span> : null}
        <div style={{ minWidth: 0 }}>
          <div className="assembly-linked-object-list">
            {tools.length
              ? tools.map((tool) => (
                <span className="assembly-object-chip" key={tool.id}>
                  <button
                    className={appearanceAccentColor(tool)
                      ? 'assembly-object-link assembly-object-link--accented'
                      : 'assembly-object-link'}
                    type="button"
                    style={semanticAccentStyle(tool)}
                    onClick={(event) => {
                      event.stopPropagation()
                      onInspectNode(tool.id)
                    }}
                  >
                    {nodeTitle(tool)}
                  </button>
                  {focused && !readOnly && onUnlinkTool ? (
                    <button
                      className="assembly-object-unlink"
                      type="button"
                      title="remove from this instruction's tools list"
                      aria-label={`remove ${nodeTitle(tool)} from this instruction's tools list`}
                      onClick={(event) => {
                        event.stopPropagation()
                        onUnlinkTool(operation.id, tool.id)
                      }}
                    >
                      <span aria-hidden="true">×</span> remove
                    </button>
                  ) : null}
                </span>
              ))
              : null}
          </div>
          {focused && !readOnly ? (
            <select
              className="assembly-parts-tools__add-select"
              aria-label="link or add a tool for this instruction"
              defaultValue=""
              onChange={(event) => {
                const selectedValue = event.currentTarget.value
                event.currentTarget.value = ''
                if (selectedValue === NEW_TOOL_OPTION || selectedValue === PLACEHOLDER_TOOL_OPTION) {
                  onToolDraftForChange({
                    operationId: operation.id,
                    placeholder: selectedValue === PLACEHOLDER_TOOL_OPTION,
                  })
                  onToolDraftChange('')
                  return
                }
                if (selectedValue) onLinkTool?.(operation.id, selectedValue)
              }}
              style={{
                ...transparentInput,
                marginTop: 5,
                borderBottom: '1px solid var(--osa-border)',
                color: 'var(--osa-muted)',
              }}
            >
              <option value="">+ tool</option>
              {toolInventory.length ? (
                <optgroup label="tool inventory">
                  {toolInventory.map((tool) => {
                    const isLinked = tools.some((linkedTool) => linkedTool.id === tool.id)
                    return (
                      <option value={tool.id} disabled={isLinked} key={tool.id}>
                        {isLinked ? `${nodeTitle(tool)} · already in this instruction` : nodeTitle(tool)}
                      </option>
                    )
                  })}
                </optgroup>
              ) : null}
              <optgroup label="create">
                <option value={NEW_TOOL_OPTION}>+ add a tool…</option>
                <option value={PLACEHOLDER_TOOL_OPTION}>+ placeholder tool…</option>
              </optgroup>
            </select>
          ) : null}
          {toolDraftFor && !readOnly ? (
            <form
              style={{ display: 'flex', gap: 8, marginTop: 5 }}
              onSubmit={(event) => {
                event.preventDefault()
                const name = toolDraft.trim()
                if (!name) return
                onCreateTool(operation.id, name, {
                  placeholder: toolDraftFor.placeholder,
                })
                onToolDraftChange('')
                onToolDraftForChange(null)
              }}
            >
              <input
                aria-label={toolDraftFor.placeholder ? 'new tool placeholder' : 'new linked tool'}
                placeholder={toolDraftFor.placeholder ? 'tool to determine' : 'tool name'}
                value={toolDraft}
                onChange={(event) => onToolDraftChange(event.target.value)}
                style={{ ...transparentInput, borderBottom: '1px solid var(--osa-border)' }}
              />
              <button className="text-action" type="submit">add</button>
              <button
                className="text-action"
                type="button"
                onClick={() => {
                  onToolDraftChange('')
                  onToolDraftForChange(null)
                }}
              >
                cancel
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </section>
  )
}

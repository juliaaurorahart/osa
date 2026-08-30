import { useContext, useState, type ChangeEvent, type DragEvent } from 'react'
import './PropertiesPanel.css'
import type { TextFlowNode } from '../graph/textNode'
import { storeImageFile } from '../graph/imageAsset'
import { ImageStorageContext } from '../graph/ImageStorageContext'
import { NODE_KINDS } from '../graph/nodeKinds'
import {
  appearanceAccentColor,
  isContainableOsaObject,
  isManagedOsaProperty,
  isPartLike,
  OSA_PROPERTY,
  osaRole,
} from '../graph/osaData'
import { nodeTitle, type InclusionRelationship } from './assemblyProjection'

type PropertiesPanelProps = {
  node: TextFlowNode
  spaces: TextFlowNode[]
  includedIn: InclusionRelationship[]
  availableContainers: TextFlowNode[]
  onNameChange: (nodeId: string, name: string) => void
  onTextChange: (nodeId: string, text: string) => void
  onSpaceIdsChange: (nodeId: string, spaceIds: string[]) => void
  onIncludeInContainer: (containerId: string, itemId: string) => void
  onRemoveInclusionRelationship: (edgeId: string) => void
  onPropertyChange: (nodeId: string, propertyName: string, value: string) => void
  onPropertyRename: (nodeId: string, oldName: string, newName: string) => void
  onPropertyRemove: (nodeId: string, propertyName: string) => void
  onPropertyAdd: (nodeId: string) => void
  /**
   * Visual canvases owned by the selected part, assembly, or tool. The host
   * derives this from durable graph relationships; this panel only displays
   * and opens them.
   */
  ownedVisuals?: TextFlowNode[]
  /** Creates one empty reusable Visual canvas owned by the selected object. */
  onCreateOwnedVisualCanvas?: (ownerId: string) => void
  /** Opens the selected reusable Visual canvas in the host's chosen editor. */
  onOpenOwnedVisual?: (visualId: string) => void
  /**
   * Detaches a Visual canvas from this owner only. The Visual object and its
   * image remain available for another part, tool, or Assembly placement.
   */
  onRemoveOwnedVisualCanvas?: (ownerId: string, visualId: string) => void
}

/**
 * Edits durable key/value data for the one node selected in the graph.
 *
 * This component renders controls only. App.tsx owns the graph state and
 * supplies callbacks that make each edit immutable and saveable.
 */
export function PropertiesPanel({
  node,
  spaces,
  includedIn,
  availableContainers,
  onNameChange,
  onTextChange,
  onSpaceIdsChange,
  onIncludeInContainer,
  onRemoveInclusionRelationship,
  onPropertyChange,
  onPropertyRename,
  onPropertyRemove,
  onPropertyAdd,
  ownedVisuals,
  onCreateOwnedVisualCanvas,
  onOpenOwnedVisual,
  onRemoveOwnedVisualCanvas,
}: PropertiesPanelProps) {
  const imageBoardId = useContext(ImageStorageContext)
  const [imageImportError, setImageImportError] = useState<string | null>(null)
  const propertyEntries = Object.entries(node.data.properties)
  const accentColor = appearanceAccentColor(node)
  const assetImage = node.data.properties[OSA_PROPERTY.assetImage] ?? ''
  const assetImageAlt = node.data.properties[OSA_PROPERTY.assetImageAlt] ?? ''
  const isAssetProperty = (name: string) => (
    name === OSA_PROPERTY.assetImage || name === OSA_PROPERTY.assetImageAlt
  )
  // Semantic color is a canonical object field with its own color-picker
  // control below. Do not make someone hunt for it among arbitrary strings.
  const isAppearanceProperty = (name: string) => (
    name === OSA_PROPERTY.appearanceAccentColor
  )
  // Image data can be a large data URL. Keep it in the dedicated Image area,
  // rather than rendering that long value in the general property editor.
  const properties = propertyEntries.filter(([name]) => (
    !isManagedOsaProperty(name) && !isAssetProperty(name) && !isAppearanceProperty(name)
  ))
  const managedProperties = propertyEntries.filter(([name]) => (
    isManagedOsaProperty(name) && !isAssetProperty(name)
  ))
  const role = osaRole(node)
  const kindLabel = NODE_KINDS.find((kind) => kind.id === node.data.kind)?.label ?? node.data.kind
  const nodeName = node.data.name.trim()
  const nodeLabel = nodeName ? `${kindLabel} ${nodeName}` : `${kindLabel} #${node.id}`
  const isVisual = role === 'visual' || node.data.kind === 'visual'
  const canOwnVisualCanvases = isPartLike(node) || node.data.kind === 'tool' || role === 'tool'
  // Keep this panel backward-compatible while App.tsx gains the durable
  // owner-to-Visual graph relationship. Once the host supplies either value,
  // an eligible part/tool gets the concise canvas section below.
  const showsOwnedVisualCanvases = canOwnVisualCanvases && (
    ownedVisuals !== undefined
    || onCreateOwnedVisualCanvas !== undefined
    || onOpenOwnedVisual !== undefined
    || onRemoveOwnedVisualCanvas !== undefined
  )

  /** Assign one image file as this object's durable visual/canvas content. */
  const setAssetImageFromFile = async (file: File) => {
    setImageImportError(null)
    let imageData: string
    try {
      imageData = await storeImageFile(file, imageBoardId)
    } catch (error) {
      setImageImportError(error instanceof Error ? error.message : 'The image could not be imported.')
      return
    }
    onPropertyChange(node.id, OSA_PROPERTY.assetImage, imageData)

    // A filename is a useful starting description, but remains editable
    // immediately below for a better description of the visual.
    if (!assetImageAlt.trim()) {
      onPropertyChange(
        node.id,
        OSA_PROPERTY.assetImageAlt,
        file.name.replace(/\.[^.]+$/, ''),
      )
    }
  }

  const onImageFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    // Allow selecting the same image again after replacement.
    event.currentTarget.value = ''
    if (file) void setAssetImageFromFile(file)
  }

  const onImageDrop = (event: DragEvent<HTMLElement>) => {
    // Prevent an image dropped on the panel from becoming a browser navigation.
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (file) void setAssetImageFromFile(file)
  }

  return (
    <section className="properties-panel">
      <div className="properties-panel__type-summary">
        <p className="properties-panel__eyebrow">Type</p>
        <h2>{kindLabel}</h2>
      </div>

      <fieldset className="properties-panel__section properties-panel__content">
        <legend>Content</legend>
        <label>
          <span>Name</span>
          <input
            aria-label="Node name in inspector"
            value={node.data.name}
            onChange={(event) => onNameChange(node.id, event.target.value)}
          />
        </label>
        <label>
          <span>Text</span>
          <textarea
            aria-label="Node text in inspector"
            value={node.data.text}
            onChange={(event) => onTextChange(node.id, event.target.value)}
          />
        </label>
      </fieldset>

      <fieldset className="properties-panel__section properties-panel__appearance">
        <legend>Appearance</legend>
        <label className="properties-panel__accent-control">
          <span>Accent</span>
          <input
            type="color"
            aria-label={`Accent color for ${nodeLabel}`}
            // The picker needs a valid color even while this object has no
            // accent. Its value does not become durable until it changes.
            value={accentColor ?? '#9b59d0'}
            onChange={(event) => onPropertyChange(
              node.id,
              OSA_PROPERTY.appearanceAccentColor,
              event.target.value,
            )}
          />
          <output>{accentColor ?? 'none'}</output>
          {accentColor ? (
            <button
              className="board-button"
              type="button"
              onClick={() => onPropertyChange(node.id, OSA_PROPERTY.appearanceAccentColor, '')}
            >
              clear
            </button>
          ) : null}
        </label>
      </fieldset>

      {node.data.kind !== 'space' ? (
        <fieldset className="properties-panel__section properties-panel__spaces">
          <legend>Spaces</legend>
          {spaces.length === 0 ? (
            <p className="properties-panel__empty">No Spaces have been created.</p>
          ) : spaces.map((space) => (
            <label key={space.id}>
              <input
                type="checkbox"
                checked={node.data.spaceIds.includes(space.id)}
                onChange={(event) => onSpaceIdsChange(
                  node.id,
                  event.target.checked
                    ? [...node.data.spaceIds, space.id]
                    : node.data.spaceIds.filter((spaceId) => spaceId !== space.id),
                )}
              />
              <span>{space.data.name.trim() || `Space #${space.id}`}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {node.data.kind !== 'space' ? (
        <fieldset
          className="properties-panel__section properties-panel__asset-image"
          onDragOver={(event) => event.preventDefault()}
          onDrop={onImageDrop}
        >
          <legend>{isVisual ? 'Canvas image' : 'Image'}</legend>
          <p className="properties-panel__asset-help">
            {isVisual
              ? 'This image is this Visual’s canvas content. Every placed reference updates when it changes.'
              : 'Attach one picture to this object. It can be used by an Assembly card or a reusable Visual canvas.'}
          </p>
          {imageImportError ? <p role="alert">{imageImportError}</p> : null}

          {assetImage ? (
            <figure className="properties-panel__asset-preview">
              <img
                src={assetImage}
                alt={assetImageAlt || `Image attached to ${nodeLabel}`}
              />
              <figcaption>{isVisual ? 'canvas content' : 'attached to this object'}</figcaption>
            </figure>
          ) : (
            <p className="properties-panel__empty">
              {isVisual ? 'No canvas image attached yet.' : 'No image attached yet.'}
            </p>
          )}

          <div className="properties-panel__asset-actions">
            <label className="board-file-button">
              {assetImage ? 'replace image' : 'choose image'}
              <input
                type="file"
                accept="image/*"
                aria-label={`Choose an image for ${nodeLabel}`}
                onChange={onImageFileChange}
              />
            </label>
            <label className="board-file-button">
              take photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                aria-label={`Take a photo for ${nodeLabel}`}
                onChange={onImageFileChange}
              />
            </label>
            {assetImage ? (
              <button
                className="board-button properties-panel__asset-remove"
                type="button"
                aria-label={`Remove the image from ${nodeLabel}`}
                onClick={() => {
                  onPropertyChange(node.id, OSA_PROPERTY.assetImage, '')
                  onPropertyChange(node.id, OSA_PROPERTY.assetImageAlt, '')
                }}
              >
                remove image
              </button>
            ) : null}
          </div>

          <p className="properties-panel__asset-dropzone" aria-label="Drop an image here">
            drop an image here
          </p>

          <label className="properties-panel__asset-alt">
            Image description
            <input
              aria-label={`Image description for ${nodeLabel}`}
              value={assetImageAlt}
              placeholder="What does this image show?"
              onChange={(event) => onPropertyChange(
                node.id,
                OSA_PROPERTY.assetImageAlt,
                event.target.value,
              )}
            />
          </label>
        </fieldset>
      ) : null}

      {showsOwnedVisualCanvases ? (
        <fieldset className="properties-panel__section properties-panel__owned-visuals">
          <legend>Visual canvases</legend>
          <p className="properties-panel__asset-help">
            Each canvas is a reusable Visual owned by this object. Place it deliberately in any Assembly canvas.
          </p>
          {ownedVisuals?.length ? (
            <ul className="properties-panel__owned-visual-list">
              {ownedVisuals.map((visual) => {
                const visualName = visual.data.name.trim() || `Visual #${visual.id}`
                return (
                  <li key={visual.id}>
                    <button
                      className="properties-panel__owned-visual-link"
                      type="button"
                      disabled={!onOpenOwnedVisual}
                      onClick={() => onOpenOwnedVisual?.(visual.id)}
                    >
                      {visualName}
                    </button>
                    <button
                      className="properties-panel__owned-visual-remove"
                      type="button"
                      disabled={!onRemoveOwnedVisualCanvas}
                      aria-label={`Remove ${visualName} canvas from ${nodeLabel}`}
                      onClick={() => onRemoveOwnedVisualCanvas?.(node.id, visual.id)}
                    >
                      remove canvas
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="properties-panel__empty">No visual canvases yet.</p>
          )}
          <button
            className="board-button"
            type="button"
            disabled={!onCreateOwnedVisualCanvas}
            onClick={() => onCreateOwnedVisualCanvas?.(node.id)}
          >
            + create visual canvas
          </button>
        </fieldset>
      ) : null}

      {isContainableOsaObject(node) ? (
        <fieldset className="properties-panel__section properties-panel__included-in">
          <legend>Included in</legend>
          {includedIn.length ? (
            <ul className="properties-panel__container-list">
              {includedIn.map((inclusion) => (
                <li key={inclusion.edgeId}>
                  <span className="properties-panel__container-copy">
                    <strong>{nodeTitle(inclusion.container)}</strong>
                    <small>{inclusion.relationship}</small>
                  </span>
                  <button
                    className="properties-panel__container-remove"
                    type="button"
                    aria-label={`Remove ${inclusion.relationship} relationship from ${nodeTitle(inclusion.container)} to ${nodeLabel}`}
                    onClick={() => onRemoveInclusionRelationship(inclusion.edgeId)}
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="properties-panel__empty">Not included in another object or card.</p>
          )}
          {availableContainers.length ? (
            <select
              aria-label={`Choose where to include ${nodeLabel}`}
              defaultValue=""
              onChange={(event) => {
                if (!event.target.value) return
                onIncludeInContainer(event.target.value, node.id)
                event.target.value = ''
              }}
            >
              <option value="">add to…</option>
              {availableContainers.map((container) => (
                <option key={container.id} value={container.id}>
                  {nodeTitle(container)}
                </option>
              ))}
            </select>
          ) : null}
        </fieldset>
      ) : null}

      <fieldset className="properties-panel__section properties-panel__properties">
        <legend>Properties</legend>
        {properties.length ? (
          <div className="properties-panel__property-headings" aria-hidden="true">
            <span>Property</span>
            <span>Value</span>
            <span />
          </div>
        ) : null}
        <div className="properties-panel__rows">
          {properties.length === 0 ? (
            <p className="properties-panel__empty">No properties yet.</p>
          ) : properties.map(([name, value]) => (
            <div className="property-row" key={name}>
              <input
                aria-label={`${name} property name`}
                defaultValue={name}
                onBlur={(event) => onPropertyRename(node.id, name, event.target.value)}
              />
              <input
                aria-label={`${name} property value`}
                value={value}
                onChange={(event) => onPropertyChange(node.id, name, event.target.value)}
              />
              <button
                className="property-row__remove"
                type="button"
                aria-label={`Remove ${name}`}
                onClick={() => onPropertyRemove(node.id, name)}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <button className="board-button" type="button" onClick={() => onPropertyAdd(node.id)}>
          + add property
        </button>
      </fieldset>

      {managedProperties.length ? (
        <details className="properties-panel__managed-data properties-panel__details-section">
          <summary>
            View hints
            <span>{managedProperties.length}</span>
          </summary>
          <dl>
            {managedProperties.map(([name, value]) => (
              <div className="managed-property-row" key={name}>
                <dt>{name}</dt>
                <dd>{value || '—'}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </section>
  )
}

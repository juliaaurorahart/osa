import { NODE_KINDS } from '../graph/nodeKinds'
import './SpaceToolbar.css'
import {
  NO_SPACE_FILTER,
  type NodeConnectionFilter,
  type NodeKindFilter,
} from '../graph/space'
import type { TextFlowNode } from '../graph/textNode'

type SpaceToolbarProps = {
  spaces: TextFlowNode[]
  selectedSpaceId: string
  kindFilter: NodeKindFilter
  connectionFilter: NodeConnectionFilter
  onSpaceChange: (spaceId: string) => void
  onKindChange: (kind: NodeKindFilter) => void
  onConnectionChange: (connection: NodeConnectionFilter) => void
}

/** Three plain-looking combo boxes that filter the Space canvas. */
export function SpaceToolbar({
  spaces,
  selectedSpaceId,
  kindFilter,
  connectionFilter,
  onSpaceChange,
  onKindChange,
  onConnectionChange,
}: SpaceToolbarProps) {
  return (
    <div className="space-toolbar" aria-label="Filter Space">
      <label className="space-toolbar__control">
        <select
          aria-label="Space"
          value={selectedSpaceId}
          onChange={(event) => onSpaceChange(event.target.value)}
        >
          <option value="">Space</option>
          <option value={NO_SPACE_FILTER}>No space</option>
          {spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.data.name.trim() || `Space #${space.id}`}
            </option>
          ))}
        </select>
      </label>

      <label className="space-toolbar__control">
        <select
          aria-label="Types"
          value={kindFilter}
          onChange={(event) => onKindChange(event.target.value as NodeKindFilter)}
        >
          <option value="all">Types</option>
          {NODE_KINDS.map((kind) => (
            <option key={kind.id} value={kind.id}>{kind.label}</option>
          ))}
        </select>
      </label>

      <label className="space-toolbar__control">
        <select
          aria-label="Connections"
          value={connectionFilter}
          onChange={(event) => onConnectionChange(event.target.value as NodeConnectionFilter)}
        >
          <option value="all">Connections</option>
          <option value="connected">Connected</option>
          <option value="dangling">Dangling</option>
        </select>
      </label>
    </div>
  )
}

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Background,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeMouseHandler,
  type OnConnectEnd,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { TextNode } from './components/TextNode'
import { PropertiesPanel } from './components/PropertiesPanel'
import { FocusedNodeInspector } from './components/FocusedNodeInspector'
import { EdgePropertiesPanel } from './components/EdgePropertiesPanel'
import { EdgeHoverCard } from './components/EdgeHoverCard'
import { GraphTablePanel } from './components/GraphTablePanel'
import {
  AssemblyView,
  type AssemblyViewActions,
} from './components/AssemblyView'
import { AssemblyInstructionsView } from './components/AssemblyInstructionsView'
import {
  createAssemblyViewUiState,
  type AssemblyViewUiState,
} from './components/assemblyViewState'
import { inclusionRelationshipsFor } from './components/assemblyProjection'
import { NotebookView } from './components/NotebookView'
import { ProjectsView } from './components/ProjectsView'
import { PointerToolPalette, type PointerToolAction } from './components/PointerToolPalette'
import { SpaceToolbar } from './components/SpaceToolbar'
import { WorkspaceSettingsMenu } from './components/WorkspaceSettingsMenu'
import { VisualCanvasEditor } from './components/VisualCanvas'
import {
  createGraphEdge,
  type GraphEdge,
  type TextConnectionAnchor,
} from './graph/graphEdge'
import { updateTextAnchorAfterEdit } from './graph/textAnchor'
import { annotationTargetsForNodes } from './graph/sketchAnnotation'
import {
  cloneSketchDocument,
  createTextNode,
  notebookAfterKindChange,
  type NodeExpansion,
  type NodeLayout,
  type SketchDocument,
  type TextFlowNode,
} from './graph/textNode'
import { migrateLegacyCanvasBackgroundImages } from './graph/legacyCanvasImages'
import { migrateLegacyOperationSourceVisuals } from './graph/legacySourceVisuals'
import { isInlineImage, storeInlineImage } from './graph/imageAsset'
import type { NodeKind } from './graph/nodeKinds'
import {
  defaultVisualEmbedPlacement,
  canOwnOsaVisual,
  containmentWouldCreateCycle,
  isContainableOsaObject,
  isImmutableVisual,
  isManagedOsaProperty,
  isPartLike,
  normalizeVisualEmbedPlacement,
  OSA_PROPERTY,
  OSA_RELATION,
  osaRole,
  visualIdentity,
} from './graph/osaData'
import {
  isVisualEmbedEdge,
  isVisualNode,
  visualDraftEmbedsForCanvas,
  visualEmbedsForVersion,
  visualEmbedWouldCreateCycle,
  visualOwnerFor,
  type VisualEmbedInstance,
} from './graph/visualEmbed'
import {
  cloneVisualVersionState,
  type VisualVersionRecord,
} from './graph/visualVersion'
import {
  mergeOsaImportPlan,
  parseOsaImportPackage,
  planOsaImport,
  type OsaImportPlan,
} from './graph/osaImport'
import {
  NO_SPACE_FILTER,
  addNodeToSpace,
  edgesWithinNodes,
  filterGraphNodes,
  nodesInSpace,
  spaceIdsForNewNode,
  spaceNodes,
  type NodeConnectionFilter,
  type NodeKindFilter,
} from './graph/space'
import {
  boardDocumentFingerprint,
  createBoardSnapshot,
  restoreBoardSnapshot,
} from './graph/boardSnapshot'
import {
  createProjectTaskEdge,
  hasProjectTaskLink,
  nodeTitle,
  projectNodes as selectProjectNodes,
  taskNodes as selectTaskNodes,
} from './graph/taskProject'
import {
  BoardAccessError,
  BoardConflictError,
  BoardUnavailableError,
  archiveBoardSummary,
  createAssemblyShare,
  fetchBoard,
  fetchBoardCollaborators,
  fetchBoardSummaries,
  fetchSharedAssembly,
  restoreBoardSummary,
  removeBoardCollaborator,
  saveBoard,
  saveBoardCollaborator,
  SharedAssemblyUnavailableError,
  type BoardAccess,
  type BoardCollaborator,
  type CollaboratorRole,
  type SavedBoard,
  type BoardSummary,
} from './graph/boardStorage'
import {
  sharedAssemblyReferenceFromLocation,
  sharedAssemblyUrl,
  suggestedAssemblyShareSlug,
} from './graph/sharedAssemblyRoute'
import { downloadBoardSnapshot, readBoardSnapshotFile } from './app/boardFile'
import {
  CLOUD_AUTOSAVE_DELAY_MS,
  CLOUD_REFRESH_INTERVAL_MS,
  boardNeedsSyncBeforeLoad,
  boardNameAlreadyInUse,
  boardSummary,
  isAcknowledgedAutomaticCloudCreate,
  prepareBoardForLoad,
  shouldCreateCloudBoardAutomatically,
  syncCurrentBoardBeforeLoad,
} from './app/boardSession'
import {
  readLocalDraft,
  readSelectedAssemblyId,
  writeSelectedAssemblyId,
} from './app/browserSession'
import {
  useCanvasLabLocation,
  useOsaTheme,
  useWorkspaceView,
} from './app/useBrowserSession'
import { useLocalDraftPersistence } from './app/useLocalDraftPersistence'
import { useAssemblyGraphActions } from './app/useAssemblyGraphActions'
import { bundledStarter } from './starters'
import './App.css'

/** React Flow uses this map to choose the component for `type: 'text'` nodes. */
const nodeTypes = { text: TextNode }

// The editor comparison is intentionally split out of the normal OSA bundle.
// It loads only from the temporary dev-only Canvas Lab entry point.
const CanvasLab = lazy(async () => {
  const module = await import('./components/CanvasLab')
  return { default: module.CanvasLab }
})

/** Starting graph: nodes and edges that appear when the app first loads. */
const initialNodes: TextFlowNode[] = [
  createTextNode({
    id: '1',
    position: { x: 220, y: 20 },
    name: '#1',
    text: 'Write in this node.',
    kind: 'note',
  }),
]

const initialEdges: GraphEdge[] = []
const ALL_NODES_SPACE_FILTER_KEY = '\u0000all\u0000all'

type SelectedItem =
  | { type: 'node'; id: string }
  | { type: 'edge'; id: string }

type HoveredEdgeState = {
  edge: GraphEdge
  x: number
  y: number
}

type PointerPaletteState = {
  x: number
  y: number
  flowPosition: { x: number; y: number }
  sourceNodeId: string | null
}

/** A public share reference is either a friendly name or an old opaque token. */
function readSharedAssemblyReference() {
  return sharedAssemblyReferenceFromLocation(window.location)
}

function localDay(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * App placement policy for nodes made with the canvas-level Add Node button.
 * Replace this function later to try a grid, collision avoidance, or a layout
 * algorithm without changing how nodes themselves are created.
 */
function getNextNodePosition(nodes: TextFlowNode[]) {
  const lowestNodeY = nodes.reduce(
    (lowestY, node) => Math.max(lowestY, node.position.y),
    20,
  )

  return {
    x: 220 + ((nodes.length % 3) - 1) * 20,
    y: lowestNodeY + 200,
  }
}

/** Parts and tools use the inspector instead of the larger inline node editor. */
function opensInInspectorOnly(node: TextFlowNode) {
  return isPartLike(node) || node.data.kind === 'tool' || osaRole(node) === 'tool'
}

function ownedVisualsFor(
  owner: TextFlowNode,
  nodes: TextFlowNode[],
  edges: GraphEdge[],
) {
  const visualIds = new Set(edges
    .filter((edge) => (
      edge.source === owner.id
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
    ))
    .map((edge) => edge.target))
  return nodes.filter((node) => visualIds.has(node.id))
}

/** Owns the live React Flow node/edge state and responds to user actions. */
function Flow() {
  const [startupDraft] = useState(readLocalDraft)
  const [sharedAssemblyReference] = useState(readSharedAssemblyReference)
  const isSharedAssembly = sharedAssemblyReference !== null
  const { theme, toggleTheme } = useOsaTheme()
  const { workspaceView, setWorkspaceView } = useWorkspaceView(isSharedAssembly)
  const { canvasLabVisible, openCanvasLab, closeCanvasLab } = useCanvasLabLocation()
  const bundledStarterImportPlan = useMemo(
    () => bundledStarter.createImportPlan(),
    [],
  )
  const startupGraph = useMemo(() => startupDraft
    ? restoreBoardSnapshot(startupDraft.snapshot)
    : { nodes: initialNodes, edges: initialEdges }, [startupDraft])
  // LIVE GRAPH STATE: React Flow displays these two arrays.
  const [nodes, setNodes, onNodesChange] = useNodesState<TextFlowNode>(startupGraph.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<GraphEdge>(startupGraph.edges)
  const nodeDragActive = nodes.some((node) => node.dragging === true)
  const latestNodes = useRef(nodes)
  const latestEdges = useRef(edges)
  latestNodes.current = nodes
  latestEdges.current = edges
  const latestNodeText = useRef(new Map(nodes.map((node) => [node.id, node.data.text])))
  latestNodeText.current = new Map(nodes.map((node) => [node.id, node.data.text]))
  // UI state: this is not saved as part of the board itself.
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null)
  const [focusedInspectorNodeId, setFocusedInspectorNodeId] = useState<string | null>(null)
  const [expandedNode, setExpandedNode] = useState<{
    id: string
    text: boolean
    details: boolean
  } | null>(null)
  // Local preview uses the same component as a shared team link, but stays
  // entirely inside this authoring session until someone explicitly shares it.
  const [assemblyInstructionsPreview, setAssemblyInstructionsPreview] = useState(false)
  const [workspaceMenuVisible, setWorkspaceMenuVisible] = useState(true)
  // Assembly's focus, lock, drawing, and draft controls are presentation
  // state. Keep them mounted here so switching to Actions or Space and back
  // returns the builder to the exact card state they deliberately left.
  // This is not included in BoardSnapshot or local-board saves.
  const [assemblyViewState, setAssemblyViewState] = useState<AssemblyViewUiState>(
    createAssemblyViewUiState,
  )
  const [pointerPalette, setPointerPalette] = useState<PointerPaletteState | null>(null)
  // The combined Actions workspace always begins with the local Today list.
  const [taskViewDay] = useState(localDay)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedAssemblyId, setSelectedAssemblyId] = useState<string | null>(readSelectedAssemblyId)
  const [selectedNotebookPageId, setSelectedNotebookPageId] = useState<string | null>(null)
  const [nodeKindFilter, setNodeKindFilter] = useState<NodeKindFilter>('all')
  const [nodeSpaceFilter, setNodeSpaceFilter] = useState('')
  const [nodeConnectionFilter, setNodeConnectionFilter] = useState<NodeConnectionFilter>('all')
  const lastCenteredSpaceFilterKey = useRef<string | null>(null)
  const [showTable, setShowTable] = useState(false)
  const [tablePeek, setTablePeek] = useState(false)
  // A selected object always gets an inspector. The person can close it, but
  // selecting another object deliberately opens it again.
  const [inspectorExpanded, setInspectorExpanded] = useState(true)
  // Hover position belongs to the temporary browser UI, never the saved graph.
  const [hoveredEdge, setHoveredEdge] = useState<HoveredEdgeState | null>(null)
  const pendingHoveredEdge = useRef<HoveredEdgeState | null>(null)
  const hoveredEdgeFrame = useRef<number | null>(null)
  // Pickers keep only compact cloud metadata. A full snapshot is fetched
  // only when opening or refreshing that one board.
  const [savedBoards, setSavedBoards] = useState<BoardSummary[]>([])
  // A successful list read proves this origin has the authenticated board
  // API. Plain Vite localhost deliberately stays local-first instead of
  // accidentally writing through to the deployed production database.
  const [cloudBoardListReady, setCloudBoardListReady] = useState(false)
  // Archived boards stay separate from the normal picker. They are only
  // shown when someone deliberately opens the archive, and can be restored.
  const [archivedBoards, setArchivedBoards] = useState<BoardSummary[]>([])
  const [showingArchivedBoards, setShowingArchivedBoards] = useState(false)
  const [boardId, setBoardId] = useState<string>(() => startupDraft?.id ?? crypto.randomUUID())
  const [boardName, setBoardName] = useState(startupDraft?.name ?? 'Untitled board')
  const [selectedBoardId, setSelectedBoardId] = useState('')
  const [storageStatus, setStorageStatus] = useState('Loading saved boards…')
  const [draftStatus, setDraftStatus] = useState(
    startupDraft ? 'Local draft restored' : '',
  )
  // A revision exists after D1 creates or loads the board. Fresh/imported
  // boards begin locally, then receive a cloud record automatically whenever
  // this origin proves the private board API is available.
  const [cloudRevision, setCloudRevision] = useState<number | null>(() => startupDraft?.revision ?? null)
  const cloudRevisionRef = useRef<number | null>(cloudRevision)
  cloudRevisionRef.current = cloudRevision
  // The database returns this role with every saved board. A fresh local
  // draft has no remote role yet, so it stays editable while cloud creation
  // is pending or unavailable.
  const [boardAccess, setBoardAccess] = useState<BoardAccess>(() => startupDraft?.access ?? 'owner')
  const boardAccessRef = useRef<BoardAccess>(boardAccess)
  boardAccessRef.current = boardAccess
  const [boardCollaborators, setBoardCollaborators] = useState<BoardCollaborator[]>([])
  const [collaborationStatus, setCollaborationStatus] = useState('')
  const [cloudDirty, setCloudDirty] = useState(() => startupDraft?.cloudDirty ?? false)
  const cloudDirtyRef = useRef(cloudDirty)
  cloudDirtyRef.current = cloudDirty
  // A dirty recovery draft has an unknown remote baseline after a reload.
  // Keep its explicit recovery flag until a one-board cloud comparison proves
  // it already matches, rather than clearing it from rehydration alone.
  const startupDirtyDraft = useRef(Boolean(startupDraft?.cloudDirty))
  // This is the last exact board document acknowledged by D1. It deliberately
  // includes the board name because renaming is also a cloud edit.
  const cloudBaselineRef = useRef<string | null>(
    startupDraft?.revision
      ? boardDocumentFingerprint(startupDraft.name, startupDraft.snapshot)
      : null,
  )
  const [cloudSyncStatus, setCloudSyncStatus] = useState(() => (
    startupDraft?.revision
      ? startupDraft.cloudDirty ? 'Saved locally' : 'Synced'
      : ''
  ))
  const [cloudConflictBoard, setCloudConflictBoard] = useState<SavedBoard | null>(null)
  const cloudConflictRef = useRef<SavedBoard | null>(cloudConflictBoard)
  cloudConflictRef.current = cloudConflictBoard
  const cloudSaveInFlight = useRef(false)
  // Board switching awaits this completion instead of mistaking an active
  // autosave for a failed save and replacing its source document too early.
  const cloudSaveCompletion = useRef<Promise<void> | null>(null)
  const boardLoadInFlight = useRef(false)
  // React StrictMode may run an effect twice. Keep creation idempotent in the
  // browser as well as relying on D1's create-only ID guard.
  const automaticCloudCreationAttempt = useRef<string | null>(null)
  // Each legacy base64 image is moved at most once during this browser
  // session. Once its URL reaches the graph, ordinary autosave persists the
  // small board document while the pixels remain in R2.
  const inlineAssetMigrationAttempts = useRef(new Set<string>())
  const [cloudSaveCycle, setCloudSaveCycle] = useState(0)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [shareStatus, setShareStatus] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [shareSlug, setShareSlug] = useState('')
  const shareSlugAssemblyId = useRef<string | null>(null)
  // A public link starts by loading. This prevents a slow phone from briefly
  // showing “unavailable” before the public board response arrives.
  const [sharedAssemblyLoadState, setSharedAssemblyLoadState] = useState<
    'idle' | 'loading' | 'ready' | 'unavailable'
  >(() => sharedAssemblyReference ? 'loading' : 'idle')
  const latestBoardId = useRef(boardId)
  latestBoardId.current = boardId
  const latestBoardName = useRef(boardName)
  latestBoardName.current = boardName
  const { screenToFlowPosition, setCenter } = useReactFlow()
  const nextId = useRef(Math.max(
    1,
    ...(startupGraph?.nodes ?? initialNodes)
      .map((node) => Number(node.id))
      .filter((id) => Number.isFinite(id)),
  ) + 1)
  const nextEdgeId = useRef(Math.max(
    0,
    ...(startupGraph?.edges ?? initialEdges)
      .map((edge) => Number(edge.id.replace('edge-', '')))
      .filter((id) => Number.isFinite(id)),
  ) + 1)
  const pointerPalettePress = useRef<{
    pointerId: number
    x: number
    y: number
    timer: number
    opened: boolean
  } | null>(null)
  const suppressPointerPaletteClickUntil = useRef(0)
  const suppressPointerContextMenuUntil = useRef(0)

  useLocalDraftPersistence({
    // React Flow publishes temporary position frames while a node is moving.
    // Save the final frame instead of rebuilding the whole document mid-drag.
    enabled: !isSharedAssembly && !nodeDragActive,
    boardId,
    boardName,
    nodes,
    edges,
    cloudRevision,
    boardAccess,
    cloudDirty,
    setDraftStatus,
  })

  // Starter-specific upgrades remain behind the generic starter contract.
  // Generic Visual migrations run between its preparation and graph passes
  // so older project data keeps the same upgrade order it had before this
  // code was extracted from App.tsx.
  useEffect(() => {
    if (nodeDragActive) return

    const refreshedNodes = bundledStarter.refreshImportedNodes(
      nodes,
      bundledStarterImportPlan,
    )
    const migratedSourceVisuals = migrateLegacyOperationSourceVisuals(refreshedNodes, edges)
    const migratedStarterGraph = bundledStarter.migrateLegacyGraph(
      migratedSourceVisuals.nodes,
      migratedSourceVisuals.edges,
    )
    // Old editable canvases stored uploaded images as untouchable background
    // pixels. Promote those images to their own immutable Visual objects so
    // they become normal, selectable placements in the parent canvas.
    const migratedCanvasImages = migrateLegacyCanvasBackgroundImages(
      migratedStarterGraph.nodes,
      migratedStarterGraph.edges,
    )
    if (migratedCanvasImages.nodes !== nodes) setNodes(migratedCanvasImages.nodes)
    if (migratedCanvasImages.edges !== edges) setEdges(migratedCanvasImages.edges)
  }, [bundledStarterImportPlan, edges, nodeDragActive, nodes, setEdges, setNodes])

  // Older boards embedded camera data directly in their graph JSON. Move
  // those source pixels to object storage as the board is opened, without
  // changing the picture or asking someone to re-upload it. This deliberately
  // skips shared/read-only views: only the board author can update canonical
  // links.
  useEffect(() => {
    const migrationAttempts = inlineAssetMigrationAttempts.current
    if (
      nodeDragActive
      || isSharedAssembly
      || cloudRevision === null
      || boardAccess === 'viewer'
    ) return

    const candidates = new Map<string, Array<{ id: string; image: string }>>()
    nodes.forEach((node) => {
      const image = node.data.properties[OSA_PROPERTY.assetImage]
      if (!isInlineImage(image)) return
      const attemptKey = `${boardId}\u0000${node.id}\u0000${image}`
      if (migrationAttempts.has(attemptKey)) return
      migrationAttempts.add(attemptKey)
      const grouped = candidates.get(image) ?? []
      grouped.push({ id: node.id, image })
      candidates.set(image, grouped)
    })
    if (!candidates.size) return

    let cancelled = false
    const attemptKeys = [...candidates.values()].flatMap((owners) => owners.map(({ id, image }) => (
      `${boardId}\u0000${id}\u0000${image}`
    )))
    setCloudSyncStatus('Moving existing photos…')
    void (async () => {
      const replacements = new Map<string, string>()
      let hadFailure = false

      for (const [image, owners] of candidates) {
        try {
          const url = await storeInlineImage(image)
          owners.forEach(({ id, image: previous }) => {
            replacements.set(`${id}\u0000${previous}`, url)
          })
        } catch {
          hadFailure = true
        }
      }

      if (cancelled || latestBoardId.current !== boardId) {
        // A graph migration or board switch can invalidate this effect while
        // uploads are still running. R2 writes are content-addressed and safe
        // to repeat, so release these guards and let the current graph retry
        // instead of leaving uploaded pixels embedded in the board forever.
        attemptKeys.forEach((key) => migrationAttempts.delete(key))
        return
      }
      if (replacements.size) {
        setNodes((currentNodes) => currentNodes.map((node) => {
          const image = node.data.properties[OSA_PROPERTY.assetImage]
          const replacement = image
            ? replacements.get(`${node.id}\u0000${image}`)
            : undefined
          return replacement
            ? {
                ...node,
                data: {
                  ...node.data,
                  properties: { ...node.data.properties, [OSA_PROPERTY.assetImage]: replacement },
                },
              }
            : node
        }))
      }
      if (hadFailure) setCloudSyncStatus('Some existing photos could not be moved yet.')
    })()

    return () => {
      cancelled = true
      attemptKeys.forEach((key) => migrationAttempts.delete(key))
    }
  }, [boardAccess, boardId, cloudRevision, isSharedAssembly, nodeDragActive, nodes, setNodes])

  // React Flow and the Assembly editor both edit the same node/edge state.
  // Compare it with the last D1 acknowledgement rather than treating an
  // effect run as an edit. React StrictMode intentionally runs mount effects
  // twice in development, and a remote load should remain clean on both runs.
  useEffect(() => {
    if (nodeDragActive) return
    if (isSharedAssembly) return
    if (cloudRevisionRef.current === null) return
    if (startupDirtyDraft.current) return

    const currentDocument = boardDocumentFingerprint(
      boardName,
      createBoardSnapshot(nodes, edges),
    )
    const baseline = cloudBaselineRef.current
    // Old local drafts have a revision but no fingerprint. Their restored
    // document is the baseline until a later cloud read tells us otherwise.
    if (baseline === null) {
      cloudBaselineRef.current = currentDocument
      return
    }

    const changed = currentDocument !== baseline
    if (cloudDirtyRef.current === changed) return
    cloudDirtyRef.current = changed
    setCloudDirty(changed)
    setCloudSyncStatus(changed ? 'Saved locally' : 'Synced')
  }, [boardId, boardName, edges, isSharedAssembly, nodeDragActive, nodes])

  const suppressPaneCollapseUntil = useRef(0)
  const refreshSavedBoards = useCallback(async () => {
    setCloudBoardListReady(false)
    setStorageStatus('Loading saved boards…')
    try {
      const boards = await fetchBoardSummaries()
      setNeedsSignIn(false)
      automaticCloudCreationAttempt.current = null
      setCloudBoardListReady(true)
      setSavedBoards(boards)
      setSelectedBoardId((currentId) => (
        boards.some((board) => board.id === currentId)
          ? currentId
          : (boards[0]?.id ?? '')
      ))
      setStorageStatus(boards.length ? `${boards.length} saved board${boards.length === 1 ? '' : 's'}` : 'No saved boards yet')
    } catch (error) {
      setCloudBoardListReady(false)
      setNeedsSignIn(error instanceof BoardAccessError)
      setStorageStatus(error instanceof BoardUnavailableError
        ? ''
        : error instanceof Error ? error.message : 'Unable to load saved boards.')
    }
  }, [])

  /** Opens the separate recoverable archive; it never mingles with active boards. */
  const showArchivedBoardList = useCallback(async () => {
    setStorageStatus('Loading archive…')
    try {
      const boards = await fetchBoardSummaries({ archived: true })
      setNeedsSignIn(false)
      setArchivedBoards(boards)
      setShowingArchivedBoards(true)
      setSelectedBoardId((currentId) => (
        boards.some((board) => board.id === currentId)
          ? currentId
          : (boards[0]?.id ?? '')
      ))
      setStorageStatus(boards.length
        ? `${boards.length} archived board${boards.length === 1 ? '' : 's'}`
        : 'Archive is empty')
    } catch (error) {
      setNeedsSignIn(error instanceof BoardAccessError)
      setStorageStatus(error instanceof BoardUnavailableError
        ? ''
        : error instanceof Error ? error.message : 'Unable to load the archive.')
    }
  }, [])

  const showActiveBoardList = useCallback(() => {
    setShowingArchivedBoards(false)
    setSelectedBoardId((currentId) => (
      savedBoards.some((board) => board.id === currentId)
        ? currentId
        : (savedBoards[0]?.id ?? '')
    ))
    setStorageStatus(savedBoards.length
      ? `${savedBoards.length} saved board${savedBoards.length === 1 ? '' : 's'}`
      : 'No saved boards yet')
  }, [savedBoards])

  useEffect(() => {
    if (isSharedAssembly) {
      setStorageStatus('Shared assembly')
      return
    }
    void refreshSavedBoards()
  }, [isSharedAssembly, refreshSavedBoards])

  /** Creates uniquely named edges without hiding the ID counter in a callback. */
  const makeEdge = useCallback((source: string, target: string) => {
    const id = `edge-${nextEdgeId.current}`
    nextEdgeId.current += 1
    return createGraphEdge({ id, source, target })
  }, [])

  // USER ACTION: typing changes the data of one existing node.
  const onTextChange = useCallback((id: string, text: string) => {
    const previousText = latestNodeText.current.get(id)
    latestNodeText.current.set(id, text)
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === id ? { ...node, data: { ...node.data, text } } : node
    )))
    if (previousText === undefined || previousText === text) return

    setEdges((currentEdges) => currentEdges.map((edge) => {
      if (edge.source !== id || edge.data.sourceAnchor?.kind !== 'text') return edge
      const sourceAnchor = updateTextAnchorAfterEdit(
        edge.data.sourceAnchor,
        previousText,
        text,
      )
      return {
        ...edge,
        data: { ...edge.data, sourceAnchor },
      }
    }))
  }, [setEdges, setNodes])

  const onSketchChange = useCallback((id: string, sketch: SketchDocument) => {
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === id ? { ...node, data: { ...node.data, sketch } } : node
    )))
  }, [setNodes])

  const onLayoutChange = useCallback((id: string, layoutChange: Partial<NodeLayout>) => {
    setNodes((currentNodes) => currentNodes.map((node) => {
      if (node.id !== id) return node
      const layout = { ...node.data.layout, ...layoutChange }
      if (
        layout.width === node.data.layout.width
        && layout.textHeight === node.data.layout.textHeight
        && layout.sketchHeight === node.data.layout.sketchHeight
      ) return node
      return { ...node, data: { ...node.data, layout } }
    }))
  }, [setNodes])

  const onNameChange = useCallback((id: string, name: string) => {
    const ownedStepVisualIds = new Set(edges
      .filter((edge) => (
        edge.source === id
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
      ))
      .map((edge) => edge.target))

    setNodes((currentNodes) => {
      const renamedNode = currentNodes.find((node) => node.id === id)
      const stepOwnsVisuals = renamedNode !== undefined && osaRole(renamedNode) === 'step'

      return currentNodes.map((node) => {
        if (node.id === id) return { ...node, data: { ...node.data, name } }
        // A step canvas is named after its step. Keeping the two names in
        // lockstep makes a later canvas list or shared instruction view
        // immediately legible without a second manual naming step.
        if (stepOwnsVisuals && ownedStepVisualIds.has(node.id)) {
          return { ...node, data: { ...node.data, name } }
        }
        return node
      })
    })
  }, [edges, setNodes])

  const onSpaceIdsChange = useCallback((id: string, spaceIds: string[]) => {
    setNodes((currentNodes) => {
      const targetNode = currentNodes.find((node) => node.id === id)
      if (!targetNode || targetNode.data.kind === 'space') return currentNodes
      const validSpaceIds = new Set(
        currentNodes
          .filter((node) => node.data.kind === 'space')
          .map((node) => node.id),
      )
      const normalizedSpaceIds = [...new Set(spaceIds)].filter((spaceId) => validSpaceIds.has(spaceId))
      return currentNodes.map((node) => (
        node.id === id
          ? { ...node, data: { ...node.data, spaceIds: normalizedSpaceIds } }
          : node
      ))
    })
  }, [setNodes])

  const onTextInteractionStart = useCallback(() => {
    const finishInteraction = () => {
      suppressPaneCollapseUntil.current = performance.now() + 300
      window.removeEventListener('pointerup', finishInteraction, true)
      window.removeEventListener('pointercancel', finishInteraction, true)
    }

    window.addEventListener('pointerup', finishInteraction, true)
    window.addEventListener('pointercancel', finishInteraction, true)
  }, [])

  const onKindChange = useCallback((id: string, kind: NodeKind) => {
    setNodes((currentNodes) => {
      const wasSpace = currentNodes.some((node) => node.id === id && node.data.kind === 'space')
      return currentNodes.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              kind,
              spaceIds: kind === 'space' ? [] : node.data.spaceIds,
              notebook: notebookAfterKindChange(node.data.notebook, kind),
              task: node.data.task ?? (
                kind === 'action' ? { day: null, completedAt: null } : null
              ),
            },
          }
        }
        if (!wasSpace || !node.data.spaceIds.includes(id)) return node
        return {
          ...node,
          data: {
            ...node.data,
            spaceIds: node.data.spaceIds.filter((spaceId) => spaceId !== id),
          },
        }
      })
    })
    setEdges((currentEdges) => currentEdges.map((edge) => {
      const projectTaskLinkIsActive = edge.data.relationKind !== 'project-task' || (
        (edge.source !== id || kind === 'project')
        && (edge.target !== id || kind === 'action')
      )
      if (projectTaskLinkIsActive) return edge
      return {
        ...edge,
        data: {
          ...edge.data,
          relationKind: 'related',
          relationship: edge.data.relationship === 'has task' || edge.data.relationship === 'has action'
            ? 'relates to'
            : edge.data.relationship,
        },
      }
    }))
    setNodeKindFilter((currentFilter) => (
      currentFilter === 'all' || currentFilter === kind ? currentFilter : 'all'
    ))
    setNodeSpaceFilter((currentSpaceId) => (
      kind === 'space' || currentSpaceId === id ? '' : currentSpaceId
    ))
  }, [setEdges, setNodes])

  const onNodesDelete = useCallback((deletedNodes: TextFlowNode[]) => {
    const deletedSpaceIds = new Set(
      deletedNodes.filter((node) => node.data.kind === 'space').map((node) => node.id),
    )
    if (deletedSpaceIds.size === 0) return

    setNodes((currentNodes) => currentNodes.map((node) => {
      const spaceIds = node.data.spaceIds.filter((spaceId) => !deletedSpaceIds.has(spaceId))
      return spaceIds.length === node.data.spaceIds.length
        ? node
        : { ...node, data: { ...node.data, spaceIds } }
    }))
    setNodeSpaceFilter((currentSpaceId) => deletedSpaceIds.has(currentSpaceId) ? '' : currentSpaceId)
  }, [setNodes])

  const onTaskDayChange = useCallback((id: string, day: string | null) => {
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === id && node.data.task
        ? { ...node, data: { ...node.data, task: { ...node.data.task, day } } }
        : node
    )))
  }, [setNodes])

  const onTaskCompletionChange = useCallback((id: string, complete: boolean) => {
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === id && node.data.task
        ? {
            ...node,
            data: {
              ...node.data,
              task: {
                ...node.data.task,
                completedAt: complete ? new Date().toISOString() : null,
              },
            },
          }
        : node
    )))
  }, [setNodes])

  /** Changes one durable text value inside a node's properties record. */
  const onPropertyChange = useCallback((id: string, propertyName: string, value: string) => {
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === id
        ? {
            ...node,
            data: {
              ...node.data,
              properties: { ...node.data.properties, [propertyName]: value },
            },
          }
        : node
    )))
  }, [setNodes])

  /** Renames a property key after its name input loses focus. */
  const onPropertyRename = useCallback((id: string, oldName: string, newName: string) => {
    const cleanedName = newName.trim()
    if (
      !cleanedName
      || cleanedName === oldName
      || isManagedOsaProperty(oldName)
      || isManagedOsaProperty(cleanedName)
    ) return

    setNodes((currentNodes) => currentNodes.map((node) => {
      if (node.id !== id) return node

      const { [oldName]: value, ...remainingProperties } = node.data.properties
      return {
        ...node,
        data: {
          ...node.data,
          properties: { ...remainingProperties, [cleanedName]: value },
        },
      }
    }))
  }, [setNodes])

  /** Removes a single durable property without deleting its node. */
  const onPropertyRemove = useCallback((id: string, propertyName: string) => {
    if (isManagedOsaProperty(propertyName)) return
    setNodes((currentNodes) => currentNodes.map((node) => {
      if (node.id !== id) return node

      const remainingProperties = { ...node.data.properties }
      delete remainingProperties[propertyName]
      return { ...node, data: { ...node.data, properties: remainingProperties } }
    }))
  }, [setNodes])

  /** Adds a blank property with a unique default name. */
  const onPropertyAdd = useCallback((id: string) => {
    setNodes((currentNodes) => currentNodes.map((node) => {
      if (node.id !== id) return node

      const properties = node.data.properties
      let propertyNumber = Object.keys(properties).length + 1
      let propertyName = `property${propertyNumber}`
      while (propertyName in properties) {
        propertyNumber += 1
        propertyName = `property${propertyNumber}`
      }

      return {
        ...node,
        data: {
          ...node.data,
          properties: { ...properties, [propertyName]: '' },
        },
      }
    }))
  }, [setNodes])

  /** Changes the durable relationship label on one edge. */
  const onEdgeRelationshipChange = useCallback((id: string, relationship: string) => {
    setEdges((currentEdges) => currentEdges.map((edge) => (
      edge.id === id ? { ...edge, data: { ...edge.data, relationship } } : edge
    )))
  }, [setEdges])

  /** Removes only the durable edge represented by one Included-in row. */
  const onRemoveInclusionRelationship = useCallback((edgeId: string) => {
    setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== edgeId))
    setSelectedItem((current) => (
      current?.type === 'edge' && current.id === edgeId ? null : current
    ))
  }, [setEdges])

  const onEdgePropertyChange = useCallback((id: string, propertyName: string, value: string) => {
    setEdges((currentEdges) => currentEdges.map((edge) => (
      edge.id === id
        ? { ...edge, data: { ...edge.data, properties: { ...edge.data.properties, [propertyName]: value } } }
        : edge
    )))
  }, [setEdges])

  const onEdgePropertyRename = useCallback((id: string, oldName: string, newName: string) => {
    const cleanedName = newName.trim()
    if (
      !cleanedName
      || cleanedName === oldName
      || isManagedOsaProperty(oldName)
      || isManagedOsaProperty(cleanedName)
    ) return

    setEdges((currentEdges) => currentEdges.map((edge) => {
      if (edge.id !== id) return edge
      const { [oldName]: value, ...remainingProperties } = edge.data.properties
      return {
        ...edge,
        data: { ...edge.data, properties: { ...remainingProperties, [cleanedName]: value } },
      }
    }))
  }, [setEdges])

  const onEdgePropertyRemove = useCallback((id: string, propertyName: string) => {
    if (isManagedOsaProperty(propertyName)) return
    setEdges((currentEdges) => currentEdges.map((edge) => {
      if (edge.id !== id) return edge
      const remainingProperties = { ...edge.data.properties }
      delete remainingProperties[propertyName]
      return { ...edge, data: { ...edge.data, properties: remainingProperties } }
    }))
  }, [setEdges])

  const onEdgePropertyAdd = useCallback((id: string) => {
    setEdges((currentEdges) => currentEdges.map((edge) => {
      if (edge.id !== id) return edge
      const properties = edge.data.properties
      let propertyNumber = Object.keys(properties).length + 1
      let propertyName = `property${propertyNumber}`
      while (propertyName in properties) {
        propertyNumber += 1
        propertyName = `property${propertyNumber}`
      }
      return {
        ...edge,
        data: { ...edge.data, properties: { ...properties, [propertyName]: '' } },
      }
    }))
  }, [setEdges])

  const onNodeClick: NodeMouseHandler<TextFlowNode> = useCallback((event, node) => {
    if (performance.now() < suppressPointerPaletteClickUntil.current) return
    setSelectedItem({ type: 'node', id: node.id })
    setInspectorExpanded(true)
    if (node.data.notebook) {
      setSelectedNotebookPageId(node.id)
    }

    const sectionElement = (event.target as HTMLElement).closest<HTMLElement>('[data-node-section]')
    const section = sectionElement?.dataset.nodeSection as NodeExpansion | undefined
    if (section !== 'text' && section !== 'details') return

    setExpandedNode((currentNode) => {
      const nextNode = currentNode?.id === node.id
        ? { ...currentNode, [section]: !currentNode[section] }
        : { id: node.id, text: section === 'text', details: section === 'details' }
      return nextNode.text || nextNode.details ? nextNode : null
    })
  }, [])

  const onEdgeClick: EdgeMouseHandler<GraphEdge> = useCallback((_event, edge) => {
    setSelectedItem({ type: 'edge', id: edge.id })
    setInspectorExpanded(true)
  }, [])

  const updateHoveredEdge: EdgeMouseHandler<GraphEdge> = useCallback((event, edge) => {
    pendingHoveredEdge.current = { edge, x: event.clientX, y: event.clientY }
    if (hoveredEdgeFrame.current !== null) return
    hoveredEdgeFrame.current = window.requestAnimationFrame(() => {
      hoveredEdgeFrame.current = null
      setHoveredEdge(pendingHoveredEdge.current)
    })
  }, [])

  const onEdgeMouseLeave = useCallback(() => {
    pendingHoveredEdge.current = null
    if (hoveredEdgeFrame.current !== null) {
      window.cancelAnimationFrame(hoveredEdgeFrame.current)
      hoveredEdgeFrame.current = null
    }
    setHoveredEdge(null)
  }, [])

  useEffect(() => () => {
    if (hoveredEdgeFrame.current !== null) {
      window.cancelAnimationFrame(hoveredEdgeFrame.current)
    }
  }, [])

  const selectedNode = selectedItem?.type === 'node'
    ? nodes.find((node) => node.id === selectedItem.id)
    : undefined
  const focusedInspectorNode = focusedInspectorNodeId
    ? nodes.find((node) => node.id === focusedInspectorNodeId)
    : undefined
  const selectedEdge = selectedItem?.type === 'edge'
    ? edges.find((edge) => edge.id === selectedItem.id)
    : undefined
  // Flow-node previews resolve annotations from the full canonical graph, not
  // just the Space's currently filtered subset of rendered nodes.
  const annotationTargets = useMemo(() => annotationTargetsForNodes(nodes), [nodes])

  const allSpaces = useMemo(() => spaceNodes(nodes), [nodes])
  const selectedSpaceId = nodeSpaceFilter === NO_SPACE_FILTER
    || allSpaces.some((space) => space.id === nodeSpaceFilter)
    ? nodeSpaceFilter
    : ''
  const canvasContextNodes = useMemo(
    () => nodesInSpace(nodes, selectedSpaceId),
    [nodes, selectedSpaceId],
  )
  const canvasContextEdges = useMemo(
    () => edgesWithinNodes(canvasContextNodes, edges),
    [canvasContextNodes, edges],
  )
  const visibleNodes = useMemo(
    () => filterGraphNodes(canvasContextNodes, canvasContextEdges, nodeKindFilter, nodeConnectionFilter),
    [canvasContextEdges, canvasContextNodes, nodeConnectionFilter, nodeKindFilter],
  )
  const visibleNodeIdsKey = visibleNodes.map((node) => node.id).join('\u0000')
  const visibleNodeIds = useMemo(
    () => new Set(visibleNodeIdsKey ? visibleNodeIdsKey.split('\u0000') : []),
    [visibleNodeIdsKey],
  )
  const visibleEdges = useMemo(
    () => edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
    [edges, visibleNodeIds],
  )
  // These are shared objects, not private records owned by one view. Assembly
  // adopts the selected Space as its working context, so Space -> Assembly is
  // a direct navigation path rather than a second filtering chore.
  const tasks = useMemo(() => selectTaskNodes(nodes), [nodes])
  const projects = useMemo(() => selectProjectNodes(nodes).sort((left, right) => {
    // Assembly instructions are a project-level context too. Put those
    // composed, buildable objects first; keep each category's saved order.
    return Number(osaRole(right) === 'assembly') - Number(osaRole(left) === 'assembly')
  }), [nodes])
  const allAssemblies = useMemo(
    () => nodes.filter((node) => osaRole(node) === 'assembly'),
    [nodes],
  )
  const allContainers = useMemo(
    () => nodes.filter(isContainableOsaObject),
    [nodes],
  )
  const assemblies = useMemo(() => {
    // An Assembly is a part-like object with internal structure, not a second
    // project-shaped record. The role keeps old saved Project-kind assemblies
    // visible while new ones are created as ordinary Part-kind objects.
    if (selectedSpaceId === '') return allAssemblies
    if (selectedSpaceId === NO_SPACE_FILTER) {
      return allAssemblies.filter((assembly) => assembly.data.spaceIds.length === 0)
    }
    return allAssemblies.filter((assembly) => assembly.data.spaceIds.includes(selectedSpaceId))
  }, [allAssemblies, selectedSpaceId])
  const operations = tasks
  const notebookPages = useMemo(
    () => nodes.filter((node) => node.data.notebook !== null),
    [nodes],
  )
  const activeProjectId = selectedProjectId && projects.some((project) => project.id === selectedProjectId)
    ? selectedProjectId
    : (projects[0]?.id ?? null)
  const activeAssemblyId = selectedAssemblyId
    && assemblies.some((assembly) => assembly.id === selectedAssemblyId)
    ? selectedAssemblyId
    : (assemblies[0]?.id ?? null)
  const activeAssembly = assemblies.find((assembly) => assembly.id === activeAssemblyId) ?? null

  useEffect(() => {
    writeSelectedAssemblyId(activeAssemblyId)
  }, [activeAssemblyId])

  // Each Assembly begins with a readable link name derived from its title.
  // Switching Assemblies must not carry the previous card's public name over.
  useEffect(() => {
    if (isSharedAssembly) return
    if (shareSlugAssemblyId.current === activeAssemblyId) return
    shareSlugAssemblyId.current = activeAssemblyId
    setShareSlug(activeAssembly ? suggestedAssemblyShareSlug(nodeTitle(activeAssembly)) : '')
    setShareStatus('')
    setShareUrl('')
  }, [activeAssembly, activeAssemblyId, isSharedAssembly])

  const activeNotebookPageId = selectedNotebookPageId
    && notebookPages.some((page) => page.id === selectedNotebookPageId)
    ? selectedNotebookPageId
    : (notebookPages[0]?.id ?? null)

  /**
   * The inspector projects visual-canvas ownership from ordinary edges. A
   * Visual remains a normal graph object: this list never duplicates its
   * image/canvas data into the owning Part or Tool.
   */
  const selectedOwnedVisuals = useMemo(() => {
    if (!selectedNode) return []
    return ownedVisualsFor(selectedNode, nodes, edges)
  }, [edges, nodes, selectedNode])
  const focusedInspectorOwnedVisuals = useMemo(() => {
    if (!focusedInspectorNode) return []
    return ownedVisualsFor(focusedInspectorNode, nodes, edges)
  }, [edges, focusedInspectorNode, nodes])
  const selectedInclusions = useMemo(() => (
    selectedNode ? inclusionRelationshipsFor(selectedNode.id, nodes, edges) : []
  ), [edges, nodes, selectedNode])
  const focusedInclusions = useMemo(() => (
    focusedInspectorNode
      ? inclusionRelationshipsFor(focusedInspectorNode.id, nodes, edges)
      : []
  ), [edges, focusedInspectorNode, nodes])
  const selectedAvailableContainers = useMemo(() => {
    if (!selectedNode) return []
    const includedIds = new Set(selectedInclusions.map((inclusion) => inclusion.container.id))
    return allContainers.filter((container) => (
      container.id !== selectedNode.id
      && !includedIds.has(container.id)
      && !containmentWouldCreateCycle(container.id, selectedNode.id, edges)
    ))
  }, [allContainers, edges, selectedInclusions, selectedNode])
  const focusedAvailableContainers = useMemo(() => {
    if (!focusedInspectorNode) return []
    const includedIds = new Set(focusedInclusions.map((inclusion) => inclusion.container.id))
    return allContainers.filter((container) => (
      container.id !== focusedInspectorNode.id
      && !includedIds.has(container.id)
      && !containmentWouldCreateCycle(container.id, focusedInspectorNode.id, edges)
    ))
  }, [allContainers, edges, focusedInclusions, focusedInspectorNode])

  // A visible connection to a Space should never disagree with membership.
  // This also repairs direct node-to-Space edges saved before that gesture
  // learned to update `spaceIds` itself. Removing the edge later does not
  // silently remove membership; connections and organization stay independent.
  useEffect(() => {
    setNodes((currentNodes) => {
      let reconciledNodes = currentNodes
      for (const edge of edges) {
        const sourceNode = reconciledNodes.find((node) => node.id === edge.source)
        const targetNode = reconciledNodes.find((node) => node.id === edge.target)
        if (sourceNode?.data.kind === 'space' && targetNode && targetNode.data.kind !== 'space') {
          reconciledNodes = addNodeToSpace(reconciledNodes, targetNode.id, sourceNode.id)
        } else if (targetNode?.data.kind === 'space' && sourceNode && sourceNode.data.kind !== 'space') {
          reconciledNodes = addNodeToSpace(reconciledNodes, sourceNode.id, targetNode.id)
        }
      }
      return reconciledNodes
    })
  }, [edges, setNodes])

  /** Creates one canonical object which every view reads from the graph. */
  const createObjectNode = useCallback((
    title: string,
    kind: NodeKind,
    day: string | null = null,
    text = '',
    position?: { x: number; y: number },
    properties: Record<string, string> = {},
    explicitSpaceIds?: string[],
  ) => {
    const id = String(nextId.current)
    nextId.current += 1
    setNodes((currentNodes) => {
      const selectedCanvasSpaceId = workspaceView === 'nodes' ? nodeSpaceFilter : ''
      return [...currentNodes, createTextNode({
        id,
        position: position ?? getNextNodePosition(currentNodes),
        name: title || `#${id}`,
        text,
        kind,
        spaceIds: explicitSpaceIds
          ?? spaceIdsForNewNode(currentNodes, selectedCanvasSpaceId, kind),
        task: kind === 'action' ? { day, completedAt: null } : null,
        properties,
      })]
    })
    return id
  }, [nodeSpaceFilter, setNodes, workspaceView])

  const connectFromTextSelection = useCallback((
    sourceId: string,
    sourceAnchor: TextConnectionAnchor,
    targetId: string,
  ) => {
    const id = `edge-${nextEdgeId.current}`
    nextEdgeId.current += 1
    setEdges((currentEdges) => [
      ...currentEdges,
      createGraphEdge({
        id,
        source: sourceId,
        target: targetId,
        relationship: 'branches to',
        sourceAnchor,
      }),
    ])
  }, [setEdges])

  const createFromTextSelection = useCallback((
    sourceId: string,
    sourceAnchor: TextConnectionAnchor,
    kind: 'note' | 'action' | 'project',
  ) => {
    const targetId = createObjectNode(
      '',
      kind,
      null,
      sourceAnchor.quote,
    )
    connectFromTextSelection(sourceId, sourceAnchor, targetId)
  }, [connectFromTextSelection, createObjectNode])

  const linkTaskToProject = useCallback((taskId: string, projectId: string) => {
    setEdges((currentEdges) => {
      if (hasProjectTaskLink(projectId, taskId, currentEdges)) return currentEdges
      const id = `edge-${nextEdgeId.current}`
      nextEdgeId.current += 1
      return [...currentEdges, createProjectTaskEdge(id, projectId, taskId)]
    })
  }, [setEdges])

  const unlinkTaskFromProject = useCallback((taskId: string, projectId: string) => {
    setEdges((currentEdges) => currentEdges.filter((edge) => !(
      edge.data.relationKind === 'project-task'
      && edge.source === projectId
      && edge.target === taskId
    )))
  }, [setEdges])

  const createTask = useCallback((text: string, day: string | null) => {
    createObjectNode('', 'action', day, text)
  }, [createObjectNode])

  const createTaskForProject = useCallback((projectId: string, text: string, day: string | null) => {
    const taskId = createObjectNode('', 'action', day, text)
    linkTaskToProject(taskId, projectId)
  }, [createObjectNode, linkTaskToProject])

  const handleAssemblyCreated = useCallback((assemblyId: string) => {
    setSelectedAssemblyId(assemblyId)
  }, [])

  /** Clears only screen state that referred to a removed instruction card. */
  const handleAssemblyOperationRemoved = useCallback((operationId: string) => {
    setSelectedItem((current) => (
      current?.type === 'node' && current.id === operationId ? null : current
    ))
    setAssemblyViewState((current) => {
      const remainingHiddenFilters = Object.fromEntries(
        Object.entries(current.hiddenVisualOwnerIdsByOperation ?? {})
          .filter(([cardId]) => cardId !== operationId),
      )
      return {
        ...current,
        focusedCardId: current.focusedCardId === operationId
          ? 'assembly-index'
          : current.focusedCardId,
        openCardId: current.openCardId === operationId ? null : current.openCardId,
        lockedCardId: current.lockedCardId === operationId ? null : current.lockedCardId,
        editingVisualId: current.editingOperationId === operationId
          ? null
          : current.editingVisualId,
        editingOperationId: current.editingOperationId === operationId
          ? null
          : current.editingOperationId,
        hiddenVisualOwnerIdsByOperation: remainingHiddenFilters,
      }
    })
  }, [])

  /** Closes the Visual editor if its Step and owned canvas were removed. */
  const handleAssemblyStepCanvasRemoved = useCallback((visualId: string | null) => {
    setAssemblyViewState((current) => (
      visualId && current.editingVisualId === visualId
        ? { ...current, editingVisualId: null, editingOperationId: null }
        : current
    ))
  }, [])

  const assemblyGraphActions = useAssemblyGraphActions({
    nodes,
    edges,
    operations,
    latestNodes,
    latestEdges,
    setNodes,
    setEdges,
    nextEdgeIdRef: nextEdgeId,
    createObjectNode,
    onAssemblyCreated: handleAssemblyCreated,
    onOperationRemoved: handleAssemblyOperationRemoved,
    onStepCanvasRemoved: handleAssemblyStepCanvasRemoved,
  })

  const assemblyViewActions = useMemo<AssemblyViewActions>(() => ({
    ...assemblyGraphActions,
    onNameChange,
    onTextChange,
    onPropertyChange,
  }), [assemblyGraphActions, onNameChange, onPropertyChange, onTextChange])

  /**
   * Creates one blank, reusable Visual canvas owned by a real Part, Assembly,
   * Tool, or instruction Step. Its content is intentionally separate from an
   * Assembly card: cards later reference this Visual without becoming its owner.
   */
  const createOwnedVisualCanvas = useCallback((ownerId: string) => {
    const owner = nodes.find((node) => node.id === ownerId)
    if (!owner || !canOwnOsaVisual(owner)) return ''

    const ownerIsStep = osaRole(owner) === 'step'
    if (ownerIsStep) {
      const existingVisualId = edges.find((edge) => (
        edge.source === ownerId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
      ))?.target
      const existingVisual = existingVisualId
        ? nodes.find((node) => node.id === existingVisualId)
        : undefined
      if (existingVisual && isVisualNode(existingVisual)) {
        setSelectedItem({ type: 'node', id: existingVisual.id })
        setInspectorExpanded(true)
        return existingVisual.id
      }
    }

    const visualId = createObjectNode(
      ownerIsStep ? owner.data.name.trim() || `#${owner.id}` : 'canvas',
      'visual',
      null,
      '',
      undefined,
      {
        [OSA_PROPERTY.role]: 'visual',
        [OSA_PROPERTY.visualContent]: 'canvas',
        // Existing callers explicitly create an OSA drawing canvas. The new
        // operation-level creator below is the only path that starts untyped.
        [OSA_PROPERTY.visualIdentity]: 'osa-draw',
      },
      owner.data.spaceIds,
    )
    const edgeId = `edge-${nextEdgeId.current}`
    nextEdgeId.current += 1
    setEdges((currentEdges) => [
      // A Step gets one canvas only. Other owner kinds can intentionally own
      // many canvases, so only normalize this one special invariant here.
      ...currentEdges.filter((edge) => !(
        ownerIsStep
        && edge.source === ownerId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
      )),
      createGraphEdge({
        id: edgeId,
        source: ownerId,
        target: visualId,
        relationship: 'owns visual',
        properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.objectVisual },
      }),
    ])
    setSelectedItem({ type: 'node', id: visualId })
    setInspectorExpanded(true)
    return visualId
  }, [createObjectNode, edges, nodes, setEdges])

  /**
   * Detaches a Visual from its owning object without deleting either the
   * Visual, its image/canvas content, or any card placement that references
   * it. This makes "remove canvas" safe and reversible by relinking later.
   */
  const removeOwnedVisualCanvas = useCallback((ownerId: string, visualId: string) => {
    setEdges((currentEdges) => currentEdges.filter((edge) => !(
      edge.source === ownerId
      && edge.target === visualId
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
    )))
  }, [setEdges])

  /**
   * Publishes one editable canvas's direct Visual placements.
   *
   * The canvas editor keeps its own draft while unlocked. Locking calls this
   * once, which reconciles only `visual-embed` edges from that parent. The
   * child Visuals remain independent graph objects, so deleting a placement
   * never destroys a photo, source slide, drawing, or another canvas.
   */
  const saveVisualEmbeds = useCallback((
    parentVisualId: string,
    requestedEmbeds: VisualEmbedInstance[],
  ) => {
    const parent = latestNodes.current.find((node) => node.id === parentVisualId)
    if (!parent || !isVisualNode(parent) || isImmutableVisual(parent)) return

    // A placement is an edge, not a property on the child Visual. Preserve
    // deliberate repeated placements of the same child, while still rejecting
    // a malformed duplicate placement id from a stale editor draft.
    const requestedByPlacementId = new Map<string, VisualEmbedInstance>()
    requestedEmbeds.forEach((embed) => {
      if (
        embed.visual.id !== parentVisualId
        && isVisualNode(embed.visual)
        && !requestedByPlacementId.has(embed.id)
      ) {
        requestedByPlacementId.set(embed.id, embed)
      }
    })
    const requestedPlacements = [...requestedByPlacementId.values()]

    // Imported File/photo items exist only in the editor draft until this
    // point. Add them as ordinary Visual nodes before creating their links.
    setNodes((currentNodes) => {
      const knownIds = new Set(currentNodes.map((node) => node.id))
      const additions = requestedPlacements.reduce<TextFlowNode[]>((current, embed) => {
        if (!knownIds.has(embed.visual.id)) {
          knownIds.add(embed.visual.id)
          current.push(embed.visual)
        }
        return current
      }, [])
      return additions.length ? [...currentNodes, ...additions] : currentNodes
    })

    setEdges((currentEdges) => {
      const oldEmbeds = currentEdges.filter((edge) => isVisualEmbedEdge(edge, parentVisualId))
      const oldByPlacementId = new Map(oldEmbeds.map((edge) => [edge.id, edge]))
      // The proposed outgoing edges replace this one parent's existing
      // placements. Cycle checking ignores those old outgoing edges, then
      // follows every other already-durable Visual relationship.
      const retainedEdges = currentEdges.filter((edge) => !isVisualEmbedEdge(edge, parentVisualId))
      const usedEdgeIds = new Set(retainedEdges.map((edge) => edge.id))
      const acceptedEmbeds = requestedPlacements.filter((embed) => (
        !visualEmbedWouldCreateCycle(parentVisualId, embed.visual.id, retainedEdges)
      ))

      const nextEdges = acceptedEmbeds.map((embed, index) => {
        const existing = oldByPlacementId.get(embed.id)
        // Keep a freshly pasted placement id durable. This means the editor
        // can keep it selected after React re-renders, while a rare collision
        // still falls back to an ordinary fresh edge id.
        const edgeId = existing?.id
          ?? (usedEdgeIds.has(embed.id) ? `edge-${nextEdgeId.current++}` : embed.id)
        usedEdgeIds.add(edgeId)
        const placement = normalizeVisualEmbedPlacement(
          embed.placement,
          defaultVisualEmbedPlacement(index),
        )
        const properties: Record<string, string> = {
          ...(existing?.data.properties ?? {}),
          [OSA_PROPERTY.relationRole]: OSA_RELATION.visualEmbed,
          [OSA_PROPERTY.visualEmbedX]: String(placement.x),
          [OSA_PROPERTY.visualEmbedY]: String(placement.y),
          [OSA_PROPERTY.visualEmbedWidth]: String(placement.width),
          [OSA_PROPERTY.visualEmbedHeight]: String(placement.height),
          [OSA_PROPERTY.visualEmbedAspectRatioLocked]: String(Boolean(placement.aspectRatioLocked)),
        }
        if (placement.groupId) {
          properties[OSA_PROPERTY.visualEmbedGroupId] = placement.groupId
        } else {
          // A placement update can ungroup a Visual. Do not leave an old edge
          // property behind after the UI intentionally clears it.
          delete properties[OSA_PROPERTY.visualEmbedGroupId]
        }
        if (placement.crop) {
          properties[OSA_PROPERTY.visualEmbedCrop] = JSON.stringify(placement.crop)
        } else {
          delete properties[OSA_PROPERTY.visualEmbedCrop]
        }
        if (placement.semanticShade) {
          properties[OSA_PROPERTY.visualEmbedSemanticShade] = 'true'
        } else {
          // Semantic shading belongs to this parent-side placement. Clearing
          // it must remove an inherited/stale edge property rather than tint
          // another occurrence of the same reusable Visual.
          delete properties[OSA_PROPERTY.visualEmbedSemanticShade]
        }
        return createGraphEdge({
          id: edgeId,
          source: parentVisualId,
          target: embed.visual.id,
          relationship: 'includes visual',
          relationKind: existing?.data.relationKind ?? 'related',
          sourceAnchor: existing?.data.sourceAnchor ?? null,
          properties,
        })
      })
      return [...retainedEdges, ...nextEdges]
    })
  }, [setEdges, setNodes])

  /**
   * Creates a separate OSA drawing from one existing canvas without copying
   * its child Visual objects. The new canvas owns a cloned drawing document
   * and cloned direct placements, while photos/canvases inside it remain the
   * same reusable project objects. A selected parent-side placement can then
   * switch to this clone without affecting any other place using the source.
   */
  const createIndependentVisualCopy = useCallback((sourceVisualId: string): TextFlowNode | null => {
    const source = latestNodes.current.find((node) => node.id === sourceVisualId)
    if (
      !source
      || !isVisualNode(source)
      || isImmutableVisual(source)
      || visualIdentity(source) !== 'osa-draw'
    ) return null

    // Canonical visuals retain their semantic owner. A clone is not a child
    // of the canvas that happens to display it; it belongs to the same Part,
    // Tool, or Assembly that owned the drawing it started from.
    const ownerId = latestEdges.current.find((edge) => (
      edge.target === sourceVisualId
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
    ))?.source
    const owner = ownerId
      ? latestNodes.current.find((node) => node.id === ownerId)
      : undefined
    // A Step has exactly one owned canvas. A copied canvas would create a
    // second one, so a Step-owned drawing must be copied only after it is
    // deliberately reassigned to another project object.
    if (!owner || !canOwnOsaVisual(owner) || osaRole(owner) === 'step') return null

    const id = String(nextId.current)
    nextId.current += 1
    const properties = { ...source.data.properties }
    // OSA drawings do not own a background image. Imported photos are their
    // own immutable Visual assets and stay as child placements instead.
    delete properties[OSA_PROPERTY.assetImage]
    delete properties[OSA_PROPERTY.assetImageAlt]
    properties[OSA_PROPERTY.role] = 'visual'
    properties[OSA_PROPERTY.visualContent] = 'canvas'
    properties[OSA_PROPERTY.visualIdentity] = 'osa-draw'
    properties[OSA_PROPERTY.visualImmutable] = 'false'

    const copy = createTextNode({
      id,
      position: {
        x: source.position.x + 40,
        y: source.position.y + 40,
      },
      name: `${source.data.name.trim() || 'canvas'} copy`,
      text: source.data.text,
      kind: 'visual',
      spaceIds: source.data.spaceIds,
      notebook: source.data.notebook,
      task: source.data.task,
      sketch: cloneSketchDocument(source.data.sketch),
      layout: source.data.layout,
      properties,
      sourcePosition: source.sourcePosition,
      targetPosition: source.targetPosition,
    })

    // Copy direct placements with new edge identities. Each child remains a
    // shared graph object, but this new canvas can now arrange/remove them
    // independently from the source drawing.
    const sourceEmbedEdges = latestEdges.current.filter((edge) => (
      isVisualEmbedEdge(edge, sourceVisualId)
    ))
    const sourceEmbedEdgesById = new Map(sourceEmbedEdges.map((edge) => [edge.id, edge]))
    const copiedEmbeds = visualDraftEmbedsForCanvas(
      sourceVisualId,
      latestNodes.current,
      latestEdges.current,
    )

    setNodes((currentNodes) => [...currentNodes, copy])
    setEdges((currentEdges) => {
      const ownershipEdge = createGraphEdge({
        id: `edge-${nextEdgeId.current++}`,
        source: owner.id,
        target: copy.id,
        relationship: 'owns visual',
        properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.objectVisual },
      })
      const copiedEmbedEdges = copiedEmbeds.map((embed, index) => {
        const sourceEdge = sourceEmbedEdgesById.get(embed.id)
        const placement = normalizeVisualEmbedPlacement(
          embed.placement,
          defaultVisualEmbedPlacement(index),
        )
        const properties: Record<string, string> = {
          ...(sourceEdge?.data.properties ?? {}),
          [OSA_PROPERTY.relationRole]: OSA_RELATION.visualEmbed,
          [OSA_PROPERTY.visualEmbedX]: String(placement.x),
          [OSA_PROPERTY.visualEmbedY]: String(placement.y),
          [OSA_PROPERTY.visualEmbedWidth]: String(placement.width),
          [OSA_PROPERTY.visualEmbedHeight]: String(placement.height),
          [OSA_PROPERTY.visualEmbedAspectRatioLocked]: String(Boolean(placement.aspectRatioLocked)),
        }
        if (placement.groupId) {
          properties[OSA_PROPERTY.visualEmbedGroupId] = placement.groupId
        } else {
          delete properties[OSA_PROPERTY.visualEmbedGroupId]
        }
        if (placement.crop) {
          properties[OSA_PROPERTY.visualEmbedCrop] = JSON.stringify(placement.crop)
        } else {
          delete properties[OSA_PROPERTY.visualEmbedCrop]
        }
        if (placement.semanticShade) {
          properties[OSA_PROPERTY.visualEmbedSemanticShade] = 'true'
        } else {
          delete properties[OSA_PROPERTY.visualEmbedSemanticShade]
        }
        return createGraphEdge({
          id: `edge-${nextEdgeId.current++}`,
          source: copy.id,
          target: embed.visual.id,
          relationship: sourceEdge?.data.relationship ?? 'includes visual',
          relationKind: sourceEdge?.data.relationKind ?? 'related',
          sourceAnchor: sourceEdge?.data.sourceAnchor ?? null,
          properties,
        })
      })
      return [...currentEdges, ownershipEdge, ...copiedEmbedEdges]
    })
    return copy
  }, [setEdges, setNodes])

  /**
   * Captures the live canvas draft as a durable record. A record holds only
   * content (drawing plus direct child placements): the Visual's name,
   * identity, owner, and project relationships remain canonical graph data.
   */
  const captureVisualVersion = useCallback((
    visualId: string,
    kind: 'draft' | 'official',
  ) => {
    setNodes((currentNodes) => {
      const visual = currentNodes.find((node) => node.id === visualId)
      if (!visual || !isVisualNode(visual) || isImmutableVisual(visual)) return currentNodes

      const capturedAt = new Date()
      const record: VisualVersionRecord = {
        id: `visual-version:${crypto.randomUUID()}`,
        label: capturedAt.toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }),
        createdAt: capturedAt.toISOString(),
        kind,
        sketch: cloneSketchDocument(visual.data.sketch),
        // A saved record freezes the direct placements, but never duplicates
        // the referenced objects. The same photo/canvas can still be reused.
        embeds: visualDraftEmbedsForCanvas(visualId, currentNodes, latestEdges.current)
          .map((embed) => ({
            id: embed.id,
            visualId: embed.visual.id,
            placement: { ...embed.placement },
          })),
      }

      return currentNodes.map((node) => {
        if (node.id !== visualId) return node
        const previous = cloneVisualVersionState(node.data.visualVersions) ?? {
          officialId: null,
          records: [],
        }
        const records = kind === 'official'
          ? [
              ...previous.records.map((candidate) => (
                candidate.kind === 'official'
                  ? { ...candidate, kind: 'history' as const }
                  : candidate
              )),
              record,
            ]
          : [...previous.records, record]
        return {
          ...node,
          data: {
            ...node.data,
            visualVersions: {
              officialId: kind === 'official' ? record.id : previous.officialId,
              records,
            },
          },
        }
      })
    })
  }, [setNodes])

  /**
   * Reopens a saved record as the live editable draft. The prior official
   * record remains untouched until the person deliberately makes a new one.
   */
  const restoreVisualVersionAsDraft = useCallback((visualId: string, versionId: string) => {
    const visual = latestNodes.current.find((node) => node.id === visualId)
    const record = visual?.data.visualVersions?.records.find((candidate) => candidate.id === versionId)
    if (!visual || !record || !isVisualNode(visual) || isImmutableVisual(visual)) return

    const embeds = visualEmbedsForVersion(
      visualId,
      record,
      latestNodes.current,
      latestEdges.current,
      new Set(),
      'draft',
    )
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === visualId
        ? { ...node, data: { ...node.data, sketch: cloneSketchDocument(record.sketch) } }
        : node
    )))
    saveVisualEmbeds(visualId, embeds)
  }, [saveVisualEmbeds, setNodes])

  /** Opens a part/tool-owned Visual over the current node card for editing. */
  const openOwnedVisualCanvas = useCallback((visualId: string) => {
    setAssemblyViewState((current) => ({
      ...current,
      editingVisualId: visualId,
      editingOperationId: null,
    }))
  }, [])

  const createNotebookPage = useCallback((kind: 'note' | 'sketch') => {
    const pageId = createObjectNode('', kind)
    setSelectedNotebookPageId(pageId)
    setSelectedItem({ type: 'node', id: pageId })
  }, [createObjectNode])

  const selectNotebookPage = useCallback((pageId: string) => {
    setSelectedNotebookPageId(pageId)
    setSelectedItem({ type: 'node', id: pageId })
  }, [])

  const openNodeInSpace = useCallback((nodeId: string) => {
    const node = nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return
    // A direct "open" action should always reveal its target. Canvas filters
    // are useful browsing tools, but they should never make navigation fail.
    // The targeted center below owns this navigation. Do not let the normal
    // all-Space filter focus race it back to the first object on the board.
    lastCenteredSpaceFilterKey.current = ALL_NODES_SPACE_FILTER_KEY
    setNodeSpaceFilter('')
    setNodeKindFilter('all')
    setNodeConnectionFilter('all')
    setWorkspaceView('nodes')
    setSelectedItem({ type: 'node', id: nodeId })
    setInspectorExpanded(true)
    setExpandedNode({ id: nodeId, text: true, details: false })
    window.requestAnimationFrame(() => {
      setCenter(
        node.position.x + node.data.layout.width / 2,
        node.position.y + 80,
        { zoom: 0.9, duration: 450 },
      )
    })
  }, [nodes, setCenter, setWorkspaceView])

  /** Opens any table row as a focused editor without losing table position. */
  const inspectNodeFromTable = useCallback((nodeId: string) => {
    if (!nodes.some((node) => node.id === nodeId)) return
    setSelectedItem({ type: 'node', id: nodeId })
    setInspectorExpanded(false)
    setFocusedInspectorNodeId(nodeId)
  }, [nodes])

  /**
   * Shrinks the table and reveals its selected node in the canvas below.
   * The vertical offset deliberately places the node in the newly open area
   * instead of centering it underneath the table itself.
   */
  const revealNodeFromTable = useCallback((nodeId: string) => {
    const node = nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return

    const zoom = 0.9
    const verticalOffset = window.innerHeight * 0.22 / zoom
    lastCenteredSpaceFilterKey.current = ALL_NODES_SPACE_FILTER_KEY
    setNodeSpaceFilter('')
    setNodeKindFilter('all')
    setNodeConnectionFilter('all')
    setWorkspaceView('nodes')
    setSelectedItem({ type: 'node', id: nodeId })
    setInspectorExpanded(false)
    setFocusedInspectorNodeId(null)
    setExpandedNode({ id: nodeId, text: true, details: false })
    setTablePeek(true)
    window.requestAnimationFrame(() => {
      void setCenter(
        node.position.x + node.data.layout.width / 2,
        node.position.y + 80 - verticalOffset,
        { zoom, duration: 450 },
      )
    })
  }, [nodes, setCenter, setWorkspaceView])

  const openFocusedNodeInspector = useCallback((nodeId: string) => {
    const node = nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return
    if (!opensInInspectorOnly(node)) {
      openNodeInSpace(nodeId)
      return
    }
    setFocusedInspectorNodeId(nodeId)
  }, [nodes, openNodeInSpace])

  const openNotebookPage = useCallback((nodeId: string) => {
    const node = nodes.find((candidate) => candidate.id === nodeId)
    if (!node?.data.notebook) return
    // A stored notebook page is ordinary graph data. Until there is a clearly
    // defined dedicated view for it, open it in Space with every other object.
    openNodeInSpace(nodeId)
  }, [nodes, openNodeInSpace])

  const openPointerPalette = useCallback((
    x: number,
    y: number,
    sourceNodeId: string | null = null,
  ) => {
    setPointerPalette({
      x,
      y,
      flowPosition: screenToFlowPosition({ x, y }),
      sourceNodeId,
    })
  }, [screenToFlowPosition])

  const closePointerPalette = useCallback(() => setPointerPalette(null), [])

  const createFromPointerPalette = useCallback((kind: 'note' | 'sketch' | 'action' | 'project' | 'space') => {
    if (!pointerPalette) return
    const sourceNode = pointerPalette.sourceNodeId
      ? nodes.find((node) => node.id === pointerPalette.sourceNodeId)
      : undefined
    const position = sourceNode
      ? {
          x: sourceNode.position.x + 40,
          y: sourceNode.position.y + Math.max(200, sourceNode.data.layout.textHeight + 110),
        }
      : pointerPalette.flowPosition
    const targetId = createObjectNode('', kind, null, '', position)

    // Creation on the canvas should never leave the new object hidden by the
    // canvas filters. A Space itself cannot belong to the Space being viewed.
    if (kind === 'space') setNodeSpaceFilter('')
    setNodeKindFilter('all')
    setNodeConnectionFilter('all')

    if (sourceNode) {
      if (sourceNode.data.kind === 'project' && kind === 'action') {
        linkTaskToProject(targetId, sourceNode.id)
      } else if (sourceNode.data.kind === 'action' && kind === 'project') {
        linkTaskToProject(sourceNode.id, targetId)
      } else {
        setEdges((currentEdges) => [...currentEdges, makeEdge(sourceNode.id, targetId)])
      }
    }

    setSelectedItem({ type: 'node', id: targetId })
    setExpandedNode(null)
    if (kind === 'note' || kind === 'sketch') setSelectedNotebookPageId(targetId)
    setPointerPalette(null)
  }, [createObjectNode, linkTaskToProject, makeEdge, nodes, pointerPalette, setEdges])

  const pointerPaletteActions = useMemo<PointerToolAction[]>(() => {
    if (!pointerPalette) return []
    const createActions: PointerToolAction[] = [
      { id: 'note', label: 'Note', accent: '#5bcefa', onSelect: () => createFromPointerPalette('note') },
      { id: 'sketch', label: 'Sketch', accent: '#f5a9b8', onSelect: () => createFromPointerPalette('sketch') },
      { id: 'action', label: 'Action', accent: '#ff8c00', onSelect: () => createFromPointerPalette('action') },
      { id: 'project', label: 'Project', accent: '#9b59d0', onSelect: () => createFromPointerPalette('project') },
      { id: 'space', label: 'Space', accent: '#5bcefa', onSelect: () => createFromPointerPalette('space') },
    ]
    if (!pointerPalette.sourceNodeId) return createActions
    const sourceNode = nodes.find((node) => node.id === pointerPalette.sourceNodeId)
    return [
      {
        id: 'open',
        label: 'Open in Space',
        accent: '#008026',
        onSelect: () => {
          const nodeId = pointerPalette.sourceNodeId
          setPointerPalette(null)
          if (!nodeId) return
          if (sourceNode?.data.notebook) openNotebookPage(nodeId)
          else openNodeInSpace(nodeId)
        },
      },
      ...createActions,
    ]
  }, [createFromPointerPalette, nodes, openNodeInSpace, openNotebookPage, pointerPalette])

  const cancelPointerPalettePress = useCallback(() => {
    if (!pointerPalettePress.current) return
    window.clearTimeout(pointerPalettePress.current.timer)
    pointerPalettePress.current = null
  }, [])

  const beginPointerPalettePress = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (workspaceView !== 'nodes' || event.pointerType === 'mouse') return
    const target = event.target instanceof Element ? event.target : null
    if (!target || !target.closest('.react-flow__pane')) return
    if (target.closest([
      'button',
      'input',
      'textarea',
      'select',
      'a',
      'label',
      '[contenteditable="true"]',
      '.react-flow__handle',
      '.react-flow__controls',
      '.react-flow__minimap',
    ].join(','))) return

    cancelPointerPalettePress()
    const nodeElement = target.closest<HTMLElement>('.react-flow__node')
    const sourceNodeId = nodeElement?.dataset.id ?? null
    const { clientX: x, clientY: y, pointerId } = event
    const timer = window.setTimeout(() => {
      const press = pointerPalettePress.current
      if (!press || press.pointerId !== pointerId) return
      press.opened = true
      suppressPointerPaletteClickUntil.current = performance.now() + 700
      suppressPointerContextMenuUntil.current = performance.now() + 1_000
      if (sourceNodeId) setSelectedItem({ type: 'node', id: sourceNodeId })
      openPointerPalette(x, y, sourceNodeId)
    }, event.pointerType === 'pen' ? 420 : 560)
    pointerPalettePress.current = { pointerId, x, y, timer, opened: false }
  }, [cancelPointerPalettePress, openPointerPalette, workspaceView])

  const movePointerPalettePress = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const press = pointerPalettePress.current
    if (!press || press.pointerId !== event.pointerId || press.opened) return
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12) {
      cancelPointerPalettePress()
    }
  }, [cancelPointerPalettePress])

  const finishPointerPalettePress = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const press = pointerPalettePress.current
    if (!press || press.pointerId !== event.pointerId) return
    const opened = press.opened
    cancelPointerPalettePress()
    if (opened) {
      event.preventDefault()
      event.stopPropagation()
    }
  }, [cancelPointerPalettePress])

  useEffect(() => () => cancelPointerPalettePress(), [cancelPointerPalettePress])

  const addNode = useCallback(() => {
    const id = String(nextId.current)
    nextId.current += 1

    setNodes((currentNodes) => {
      const position = getNextNodePosition(currentNodes)

      return [
        ...currentNodes,
        createTextNode({
          id,
          position,
          name: `#${id}`,
          text: `Nodes ${id}`,
          spaceIds: spaceIdsForNewNode(currentNodes, nodeSpaceFilter, 'note'),
        }),
      ]
    })
  }, [nodeSpaceFilter, setNodes])

  /** Restores durable graph state and advances the generated ID counters. */
  const applyBoardSnapshot = useCallback((snapshot: SavedBoard['snapshot']) => {
    const restoredBoard = restoreBoardSnapshot(snapshot)
    setNodes(restoredBoard.nodes)
    setEdges(restoredBoard.edges)
    setSelectedItem(null)
    setExpandedNode(null)
    setHoveredEdge(null)
    setSelectedNotebookPageId(null)
    setSelectedProjectId(null)
    setSelectedAssemblyId(null)
    setNodeSpaceFilter('')
    setNodeKindFilter('all')
    setNodeConnectionFilter('all')
    lastCenteredSpaceFilterKey.current = null

    const numericIds = restoredBoard.nodes
      .map((node) => Number(node.id))
      .filter((id) => Number.isFinite(id))
    nextId.current = Math.max(0, ...numericIds) + 1

    const numericEdgeIds = restoredBoard.edges
      .map((edge) => Number(edge.id.replace('edge-', '')))
      .filter((id) => Number.isFinite(id))
    nextEdgeId.current = Math.max(0, ...numericEdgeIds) + 1
  }, [setEdges, setNodes])

  /** Applies a newer D1 board without treating that incoming change as a local edit. */
  const applyCloudBoard = useCallback((savedBoard: SavedBoard, status = 'Synced') => {
    startupDirtyDraft.current = false
    cloudBaselineRef.current = boardDocumentFingerprint(
      savedBoard.name,
      savedBoard.snapshot,
    )
    applyBoardSnapshot(savedBoard.snapshot)
    setBoardId(savedBoard.id)
    setBoardName(savedBoard.name)
    const revision = savedBoard.revision ?? null
    cloudRevisionRef.current = revision
    setCloudRevision(revision)
    const access = savedBoard.access ?? 'owner'
    boardAccessRef.current = access
    setBoardAccess(access)
    cloudDirtyRef.current = false
    setCloudDirty(false)
    setCloudConflictBoard(null)
    setCloudSyncStatus(status)
    setSavedBoards((currentBoards) => [
      boardSummary(savedBoard),
      ...currentBoards.filter((board) => board.id !== savedBoard.id),
    ])
    setSelectedBoardId(savedBoard.id)
    setShowingArchivedBoards(false)
  }, [applyBoardSnapshot])

  /** Fetches one full board without replacing the document currently on screen. */
  const readSavedCloudBoard = useCallback(async (id: string): Promise<SavedBoard | null> => {
    try {
      const savedBoard = await fetchBoard(id)
      if (!savedBoard) {
        setStorageStatus('That saved board is no longer available.')
        return null
      }
      setNeedsSignIn(false)
      return savedBoard
    } catch (error) {
      setNeedsSignIn(error instanceof BoardAccessError)
      setStorageStatus(error instanceof BoardUnavailableError
        ? 'Board storage is unavailable right now.'
        : error instanceof Error ? error.message : 'Unable to open this board.')
      return null
    }
  }, [])

  /** Loads the one selected cloud board after a metadata-only picker read. */
  const openSavedCloudBoard = useCallback(async (
    id: string,
    status = 'Synced',
  ): Promise<SavedBoard | null> => {
    const savedBoard = await readSavedCloudBoard(id)
    if (savedBoard) applyCloudBoard(savedBoard, status)
    return savedBoard
  }, [applyCloudBoard, readSavedCloudBoard])

  // A signed-in device opens the newest saved board. A local draft only wins
  // when it contains unsynced work; a clean local copy is a recovery cache,
  // not a reason to leave a phone or another computer on an older board.
  const openedInitialCloudBoard = useRef(false)
  const checkingStartupDirtyDraft = useRef(false)
  useEffect(() => {
    if (
      openedInitialCloudBoard.current
      || isSharedAssembly
      || !savedBoards.length
    ) return

    if (cloudDirty) {
      const draft = startupDraft
      const savedDraft = draft?.cloudDirty
        && draft.revision !== undefined
        && savedBoards.some((board) => board.id === draft.id)
      if (!savedDraft || checkingStartupDirtyDraft.current) return

      checkingStartupDirtyDraft.current = true
      const draftId = draft.id
      const draftDocument = boardDocumentFingerprint(draft.name, draft.snapshot)
      void fetchBoard(draftId).then((remoteBoard) => {
        if (
          !remoteBoard
          || remoteBoard.archived
          || latestBoardId.current !== draftId
          || boardDocumentFingerprint(
            latestBoardName.current,
            createBoardSnapshot(latestNodes.current, latestEdges.current),
          ) !== draftDocument
          || boardDocumentFingerprint(remoteBoard.name, remoteBoard.snapshot) !== draftDocument
        ) return

        // This recovery record was marked dirty by an older client, but it is
        // byte-for-byte equivalent after editor normalization. Let this device
        // proceed to the newest saved board instead of presenting a conflict.
        startupDirtyDraft.current = false
        cloudBaselineRef.current = boardDocumentFingerprint(remoteBoard.name, remoteBoard.snapshot)
        cloudRevisionRef.current = remoteBoard.revision ?? null
        setCloudRevision(remoteBoard.revision ?? null)
        const access = remoteBoard.access ?? 'owner'
        boardAccessRef.current = access
        setBoardAccess(access)
        cloudDirtyRef.current = false
        setCloudDirty(false)
        setCloudSyncStatus('Synced')
      }).catch(() => {
        // Keep the recovery draft intact if this verification cannot complete.
        checkingStartupDirtyDraft.current = false
      })
      return
    }

    const untouchedInitialDocument = boardDocumentFingerprint(
      boardName,
      createBoardSnapshot(nodes, edges),
    ) === boardDocumentFingerprint(
      'Untitled board',
      createBoardSnapshot(initialNodes, initialEdges),
    )

    // Local recovery wins only when it contains work that has not reached
    // D1. An untouched startup draft is automatically written by the normal
    // local-draft timer, so it must not prevent a later sign-in from opening
    // the newest cloud board.
    const recoveredLocalWork = startupDraft
      ? startupDirtyDraft.current
        || (startupDraft.revision === undefined && !untouchedInitialDocument)
      : !untouchedInitialDocument
    if (recoveredLocalWork) return

    openedInitialCloudBoard.current = true
    void openSavedCloudBoard(savedBoards[0].id, 'Opened latest saved board')
  }, [boardName, cloudDirty, edges, isSharedAssembly, nodes, openSavedCloudBoard, savedBoards, startupDraft])

  /**
   * A recipient's link restores an assembly snapshot into the normal graph,
   * then keeps the app on the printable Assembly view. The snapshot is never
   * written into the recipient's local draft or private board list.
   */
  useEffect(() => {
    if (!sharedAssemblyReference) return

    let cancelled = false
    setSharedAssemblyLoadState('loading')
    setShareStatus('Loading shared assembly…')
    void fetchSharedAssembly(sharedAssemblyReference)
      .then(({ board, assemblyId }) => {
        if (cancelled) return
        applyBoardSnapshot(board.snapshot)
        setBoardId(board.id)
        setBoardName(board.name)
        setSelectedAssemblyId(assemblyId)
        setWorkspaceView('assembly')
        setSharedAssemblyLoadState('ready')
        setShareStatus('Shared assembly · read-only')
      })
      .catch((error) => {
        if (cancelled) return
        setSharedAssemblyLoadState('unavailable')
        setShareStatus(error instanceof SharedAssemblyUnavailableError
          ? error.message
          : 'Unable to load this shared assembly.')
      })

    return () => {
      cancelled = true
    }
  }, [applyBoardSnapshot, setWorkspaceView, sharedAssemblyReference])

  /**
   * The one cloud-write path: automatic creation, manual recovery actions,
   * share creation, and background saving all use the same revision guard.
   */
  const saveCurrentBoard = useCallback(async (
    mode: 'manual' | 'auto' | 'create' = 'manual',
  ): Promise<SavedBoard | null> => {
    if (boardAccess === 'viewer') {
      const message = 'This board is shared with you for viewing only.'
      setCloudSyncStatus(message)
      if (mode === 'manual') setStorageStatus(message)
      return null
    }
    const id = latestBoardId.current
    const name = latestBoardName.current.trim()
    if (!name) {
      const message = 'Enter a board name before saving.'
      if (mode !== 'auto') setCloudSyncStatus(message)
      if (mode === 'manual') setStorageStatus(message)
      return null
    }

    if (archivedBoards.some((board) => board.id === id)) {
      const message = 'Restore this board before saving changes.'
      setCloudSyncStatus(message)
      if (mode === 'manual') setStorageStatus(message)
      return null
    }

    if (boardNameAlreadyInUse(savedBoards, id, name)) {
      const message = 'That board name is already in use.'
      setCloudSyncStatus(message)
      if (mode === 'manual') setStorageStatus(message)
      return null
    }

    const baseRevision = cloudRevisionRef.current
    // Ordinary autosave updates a known revision. The one automatic create
    // pass is the only background path allowed to start at revision null.
    if (mode === 'auto' && (baseRevision === null || cloudConflictRef.current)) return null
    if (mode === 'create' && cloudConflictRef.current) return null
    if (cloudSaveInFlight.current) return null

    const nodesAtSave = latestNodes.current
    const edgesAtSave = latestEdges.current
    const boardToSave: SavedBoard = {
      id,
      name,
      updatedAt: new Date().toISOString(),
      snapshot: createBoardSnapshot(nodesAtSave, edgesAtSave),
    }

    cloudSaveInFlight.current = true
    let finishCloudSave!: () => void
    const saveCompletion = new Promise<void>((resolve) => {
      finishCloudSave = resolve
    })
    cloudSaveCompletion.current = saveCompletion
    if (mode !== 'manual') {
      setCloudSyncStatus(mode === 'create' ? 'Creating cloud board…' : 'Syncing…')
    } else {
      setStorageStatus('Saving…')
    }

    const acknowledgeCloudSave = (savedBoard: SavedBoard) => {
      setNeedsSignIn(false)
      setSavedBoards((currentBoards) => [
        boardSummary(savedBoard),
        ...currentBoards.filter((board) => board.id !== savedBoard.id),
      ])

      if (latestBoardId.current === savedBoard.id) {
        startupDirtyDraft.current = false
        cloudRevisionRef.current = savedBoard.revision ?? null
        setCloudRevision(savedBoard.revision ?? null)
        const access = savedBoard.access ?? 'owner'
        boardAccessRef.current = access
        setBoardAccess(access)
        setSelectedBoardId(savedBoard.id)
        setShowingArchivedBoards(false)
        setBoardName(savedBoard.name)
        const savedDocument = boardDocumentFingerprint(
          savedBoard.name,
          savedBoard.snapshot,
        )
        cloudBaselineRef.current = savedDocument
        const changedDuringSave = boardDocumentFingerprint(
          latestBoardName.current,
          createBoardSnapshot(latestNodes.current, latestEdges.current),
        ) !== savedDocument
        cloudDirtyRef.current = changedDuringSave
        setCloudDirty(changedDuringSave)
        setCloudConflictBoard(null)
        setCloudSyncStatus(changedDuringSave ? 'Saved locally' : 'Synced')
      }
    }

    try {
      const savedBoard = await saveBoard(boardToSave, baseRevision)
      acknowledgeCloudSave(savedBoard)

      if (mode === 'manual') setStorageStatus(`Saved “${savedBoard.name}”`)
      return savedBoard
    } catch (error) {
      if (error instanceof BoardConflictError) {
        const matchesAcknowledgedCreate = mode === 'create'
          && isAcknowledgedAutomaticCloudCreate(boardToSave, error.board)
        // The server may have committed a create even if its response was
        // lost. A retry then returns the existing row; if its exact document
        // matches, adopt its revision rather than inventing a false conflict.
        if (matchesAcknowledgedCreate) {
          acknowledgeCloudSave(error.board)
          return error.board
        }
        if (latestBoardId.current === id) {
          setCloudConflictBoard(error.board)
          setCloudSyncStatus(error.board.archived ? 'Archived elsewhere' : 'Changed elsewhere')
          if (error.board.archived) {
            setSavedBoards((currentBoards) => currentBoards.filter((board) => board.id !== error.board.id))
            setArchivedBoards((currentBoards) => [
              boardSummary(error.board),
              ...currentBoards.filter((board) => board.id !== error.board.id),
            ])
          }
        }
        if (mode === 'manual') {
          setStorageStatus(error.board.archived
            ? 'Restore this board before saving changes.'
            : 'Changed elsewhere — reload or save a copy.')
        }
      } else {
        setNeedsSignIn(error instanceof BoardAccessError)
        const message = error instanceof BoardUnavailableError
          ? 'Offline — saved locally'
          : error instanceof BoardAccessError
            ? 'Sign in — saved locally'
            : error instanceof Error ? error.message : 'Unable to save this board.'
        setCloudSyncStatus(message)
        if (mode === 'manual') setStorageStatus(message)
      }
      return null
    } finally {
      cloudSaveInFlight.current = false
      finishCloudSave()
      if (cloudSaveCompletion.current === saveCompletion) {
        cloudSaveCompletion.current = null
      }
      setCloudSaveCycle((current) => current + 1)
    }
  }, [archivedBoards, boardAccess, savedBoards])

  // Once this origin successfully reaches the private board list, give a
  // local-first document its D1 identity automatically. An untouched startup
  // canvas yields to an existing cloud board; an edited/imported draft does
  // not. The attempt key prevents StrictMode and re-renders from creating the
  // same board twice.
  useEffect(() => {
    if (nodeDragActive) return
    if (boardLoadInFlight.current) return

    const attemptKey = `${boardId}\u0000${boardName.trim().toLocaleLowerCase()}`
    // Only an existing cloud board needs the relatively expensive untouched
    // comparison. A fresh account always creates its first local document.
    const currentBoardIsUntouched = cloudBoardListReady && savedBoards.length > 0
      ? boardDocumentFingerprint(
          boardName,
          createBoardSnapshot(nodes, edges),
        ) === boardDocumentFingerprint(
          'Untitled board',
          createBoardSnapshot(initialNodes, initialEdges),
        )
      : false
    const shouldCreate = shouldCreateCloudBoardAutomatically({
      cloudBoardListReady,
      isSharedAssembly,
      cloudRevision,
      boardAccess,
      hasCloudConflict: cloudConflictBoard !== null,
      savedBoardCount: savedBoards.length,
      currentBoardIsUntouched,
      alreadyAttempted: automaticCloudCreationAttempt.current === attemptKey,
    })
    if (!shouldCreate) return
    if (cloudSaveInFlight.current) return

    automaticCloudCreationAttempt.current = attemptKey
    void saveCurrentBoard('create')
  }, [
    boardAccess,
    boardId,
    boardName,
    cloudBoardListReady,
    cloudConflictBoard,
    cloudRevision,
    cloudSaveCycle,
    edges,
    isSharedAssembly,
    nodeDragActive,
    nodes,
    saveCurrentBoard,
    savedBoards.length,
  ])

  const saveBoardToDatabase = useCallback(async () => {
    await saveCurrentBoard('manual')
  }, [saveCurrentBoard])

  /** Detects edits synchronously, including before React's dirty effect runs. */
  const currentBoardNeedsSyncBeforeLoad = useCallback(() => {
    const currentDocument = boardDocumentFingerprint(
      latestBoardName.current,
      createBoardSnapshot(latestNodes.current, latestEdges.current),
    )
    const untouchedDocument = boardDocumentFingerprint(
      'Untitled board',
      createBoardSnapshot(initialNodes, initialEdges),
    )
    return boardNeedsSyncBeforeLoad({
      cloudRevision: cloudRevisionRef.current,
      cloudDirty: cloudDirtyRef.current,
      cloudBaseline: cloudBaselineRef.current,
      currentDocument,
      untouchedDocument,
    })
  }, [])

  /** Protects the source board before a fetched target is allowed to replace it. */
  const secureCurrentBoardBeforeLoad = useCallback(async (sourceBoardId: string) => {
    if (cloudSaveCompletion.current || currentBoardNeedsSyncBeforeLoad()) {
      setStorageStatus('Syncing current board before opening…')
    }

    let saveFailed = false
    const synced = await syncCurrentBoardBeforeLoad({
      getPendingSave: () => cloudSaveCompletion.current,
      hasUnsyncedChanges: () => (
        latestBoardId.current === sourceBoardId
        && currentBoardNeedsSyncBeforeLoad()
      ),
      saveCurrentBoard: async () => {
        const savedBoard = await saveCurrentBoard('manual')
        saveFailed = savedBoard === null
        return savedBoard !== null
      },
    })

    if (latestBoardId.current !== sourceBoardId) return false
    if (!synced && !saveFailed) {
      setStorageStatus('The current board changed while syncing. Try loading it again.')
    }
    return synced
  }, [currentBoardNeedsSyncBeforeLoad, saveCurrentBoard])

  /**
   * Keeps the source visible while the destination is checked, saved around,
   * and checked again. A last-moment source edit cancels this attempt; the
   * normal autosave cycle then saves it and the person can load again.
   */
  const prepareCloudBoardForLoad = useCallback(async (
    targetBoardId: string,
    sourceBoardId: string,
  ) => {
    const targetBoard = await prepareBoardForLoad({
      readTarget: () => readSavedCloudBoard(targetBoardId),
      sourceStillOpen: () => latestBoardId.current === sourceBoardId,
      secureSource: () => secureCurrentBoardBeforeLoad(sourceBoardId),
      sourceNeedsSync: currentBoardNeedsSyncBeforeLoad,
    })

    if (
      !targetBoard
      && latestBoardId.current === sourceBoardId
      && currentBoardNeedsSyncBeforeLoad()
      && !cloudConflictRef.current
    ) {
      setStorageStatus('The current board changed while opening. Its autosave is still active; try loading again.')
    }
    return targetBoard
  }, [
    currentBoardNeedsSyncBeforeLoad,
    readSavedCloudBoard,
    secureCurrentBoardBeforeLoad,
  ])

  /** Loads the small invitation list only for the owner of this saved board. */
  const refreshBoardCollaborators = useCallback(async () => {
    const id = latestBoardId.current
    if (cloudRevisionRef.current === null || boardAccess !== 'owner') {
      setBoardCollaborators([])
      return
    }
    try {
      const collaborators = await fetchBoardCollaborators(id)
      if (latestBoardId.current === id) setBoardCollaborators(collaborators)
    } catch (error) {
      if (error instanceof BoardAccessError) setNeedsSignIn(true)
      if (latestBoardId.current === id) {
        setCollaborationStatus(error instanceof Error ? error.message : 'Unable to load people with access.')
      }
    }
  }, [boardAccess])

  useEffect(() => {
    if (isSharedAssembly || cloudRevision === null || boardAccess !== 'owner') {
      setBoardCollaborators([])
      return
    }
    void refreshBoardCollaborators()
  }, [boardAccess, boardId, cloudRevision, isSharedAssembly, refreshBoardCollaborators])

  /** Owner-only invitation action used by the compact Assembly people panel. */
  const addBoardCollaborator = useCallback(async (email: string, role: CollaboratorRole) => {
    if (cloudRevisionRef.current === null) {
      setCollaborationStatus('Save this board before adding people.')
      return
    }
    if (boardAccess !== 'owner') {
      setCollaborationStatus('Only the board owner can manage people.')
      return
    }
    const id = latestBoardId.current
    setCollaborationStatus('Adding access…')
    try {
      const collaborator = await saveBoardCollaborator(id, email, role)
      if (latestBoardId.current !== id) return
      setBoardCollaborators((current) => [
        collaborator,
        ...current.filter((candidate) => candidate.email !== collaborator.email),
      ].sort((left, right) => left.email.localeCompare(right.email)))
      setCollaborationStatus(`${collaborator.email} can ${collaborator.role === 'editor' ? 'edit' : 'view'} this board.`)
    } catch (error) {
      if (error instanceof BoardAccessError) setNeedsSignIn(true)
      setCollaborationStatus(error instanceof Error ? error.message : 'Unable to add access.')
    }
  }, [boardAccess])

  const removeBoardCollaboratorAccess = useCallback(async (email: string) => {
    if (cloudRevisionRef.current === null || boardAccess !== 'owner') {
      setCollaborationStatus('Only the board owner can manage people.')
      return
    }
    const id = latestBoardId.current
    setCollaborationStatus('Removing access…')
    try {
      await removeBoardCollaborator(id, email)
      if (latestBoardId.current !== id) return
      setBoardCollaborators((current) => current.filter((candidate) => candidate.email !== email))
      setCollaborationStatus(`${email} no longer has access to this board.`)
    } catch (error) {
      if (error instanceof BoardAccessError) setNeedsSignIn(true)
      setCollaborationStatus(error instanceof Error ? error.message : 'Unable to remove access.')
    }
  }, [boardAccess])

  /** Moves the board currently open for editing into the recoverable archive. */
  const archiveCurrentBoard = useCallback(async () => {
    const board = savedBoards.find((savedBoard) => savedBoard.id === boardId)
    if (!board) {
      setStorageStatus('Save this board before archiving it.')
      return
    }

    setStorageStatus('Archiving…')
    try {
      const archivedBoard = await archiveBoardSummary(board.id)
      setNeedsSignIn(false)
      setSavedBoards((currentBoards) => currentBoards.filter((savedBoard) => savedBoard.id !== board.id))
      setArchivedBoards((currentBoards) => [
        archivedBoard,
        ...currentBoards.filter((savedBoard) => savedBoard.id !== board.id),
      ])
      // Keep the board on screen as a safety measure, but prevent a stale
      // working copy from silently writing over the archived version.
      cloudRevisionRef.current = archivedBoard.revision ?? null
      setCloudRevision(archivedBoard.revision ?? null)
      setShowingArchivedBoards(true)
      setSelectedBoardId(board.id)
      setStorageStatus(`Archived “${board.name}”`)
    } catch (error) {
      setNeedsSignIn(error instanceof BoardAccessError)
      setStorageStatus(error instanceof BoardUnavailableError
        ? ''
        : error instanceof Error ? error.message : 'Unable to archive this board.')
    }
  }, [boardId, savedBoards])

  /** Restores and opens the selected archived board in one deliberate action. */
  const restoreSelectedBoard = useCallback(async () => {
    const board = archivedBoards.find((savedBoard) => savedBoard.id === selectedBoardId)
    if (!board) {
      setStorageStatus('Choose an archived board to restore.')
      return
    }
    if (boardLoadInFlight.current) {
      setStorageStatus('A board is already opening…')
      return
    }

    boardLoadInFlight.current = true
    const sourceBoardId = latestBoardId.current
    try {
      // Restoring another board mutates the remote list, so first ensure the
      // current document is durable. Restoring the board already on screen is
      // different: unarchive it first, then its local edits can be saved by
      // the ordinary revision-guarded path before any remote copy is applied.
      if (
        board.id !== sourceBoardId
        && !await secureCurrentBoardBeforeLoad(sourceBoardId)
      ) return
      if (latestBoardId.current !== sourceBoardId) return

      setStorageStatus('Restoring…')
      const restoredBoard = await restoreBoardSummary(board.id)
      setNeedsSignIn(false)
      setArchivedBoards((currentBoards) => currentBoards.filter((savedBoard) => savedBoard.id !== board.id))
      setSavedBoards((currentBoards) => [
        restoredBoard,
        ...currentBoards.filter((savedBoard) => savedBoard.id !== restoredBoard.id),
      ])
      setSelectedBoardId(restoredBoard.id)
      setShowingArchivedBoards(false)

      // Restoring the document already on screen advances its server
      // revision without changing its graph. Adopt that revision before the
      // source-sync pass so any edits made while it was archived can save.
      if (restoredBoard.id === sourceBoardId) {
        cloudRevisionRef.current = restoredBoard.revision ?? null
        setCloudRevision(restoredBoard.revision ?? null)
        const access = restoredBoard.access ?? 'owner'
        boardAccessRef.current = access
        setBoardAccess(access)
        setCloudConflictBoard(null)
      }

      const openedBoard = await prepareCloudBoardForLoad(restoredBoard.id, sourceBoardId)
      if (!openedBoard) return
      applyCloudBoard(openedBoard, 'Synced')
      setStorageStatus(`Restored “${openedBoard.name}”`)
    } catch (error) {
      setNeedsSignIn(error instanceof BoardAccessError)
      setStorageStatus(error instanceof BoardUnavailableError
        ? ''
        : error instanceof Error ? error.message : 'Unable to restore this board.')
    } finally {
      boardLoadInFlight.current = false
      // If a load failed while an existing autosave timer fired, give the
      // still-open dirty board a fresh timer instead of silently stalling it.
      setCloudSaveCycle((current) => current + 1)
    }
  }, [
    applyCloudBoard,
    archivedBoards,
    prepareCloudBoardForLoad,
    secureCurrentBoardBeforeLoad,
    selectedBoardId,
  ])

  /** Saves first, then creates a public, read-only link to the selected assembly. */
  const createAssemblyShareLink = useCallback(async () => {
    if (!activeAssemblyId) {
      setShareStatus('Choose an assembly before making a share link.')
      return
    }

    const requestedSlug = shareSlug.trim()
    if (!requestedSlug) {
      setShareStatus('Give this public link a name before sharing it.')
      return
    }

    setShareStatus('Saving the current assembly…')
    try {
      const savedBoard = await saveCurrentBoard('manual')
      if (!savedBoard) {
        setShareStatus(cloudConflictRef.current
          ? 'Changed elsewhere — reload or save a copy.'
          : 'Save the current board before making a share link.')
        return
      }

      const share = await createAssemblyShare(savedBoard.id, activeAssemblyId, requestedSlug)
      const nextShareUrl = sharedAssemblyUrl(window.location.origin, share.slug || share.token)
      setShareSlug(share.slug || requestedSlug)
      setShareUrl(nextShareUrl)

      try {
        await navigator.clipboard.writeText(nextShareUrl)
        setShareStatus('Read-only assembly link copied. It always shows the latest saved version.')
      } catch {
        setShareStatus('Read-only assembly link is ready below. Copy it to share the latest saved version.')
      }
    } catch (error) {
      setNeedsSignIn(error instanceof BoardAccessError)
      setShareStatus(error instanceof BoardUnavailableError
        ? 'Online board storage is unavailable here.'
        : error instanceof Error ? error.message : 'Unable to create a share link.')
    }
  }, [activeAssemblyId, saveCurrentBoard, shareSlug])

  const loadSelectedBoard = useCallback(async () => {
    const selectedBoard = savedBoards.find((board) => board.id === selectedBoardId)
    if (!selectedBoard) {
      setStorageStatus('Choose a saved board to load.')
      return
    }
    if (boardLoadInFlight.current) {
      setStorageStatus('A board is already opening…')
      return
    }

    boardLoadInFlight.current = true
    const sourceBoardId = latestBoardId.current
    try {
      // The helper reads before and after the source sync. This applies to the
      // already-open board too, so Load genuinely checks for a newer revision
      // instead of merely reporting that the local copy is current.
      setStorageStatus('Preparing board…')
      const targetBoard = await prepareCloudBoardForLoad(selectedBoard.id, sourceBoardId)
      if (!targetBoard) return

      applyCloudBoard(targetBoard, 'Synced')
      setStorageStatus(`Loaded “${targetBoard.name}”`)
    } finally {
      boardLoadInFlight.current = false
      // Restart any dirty autosave whose timer elapsed while the source was
      // deliberately held open during a failed or cancelled load.
      setCloudSaveCycle((current) => current + 1)
    }
  }, [
    applyCloudBoard,
    prepareCloudBoardForLoad,
    savedBoards,
    selectedBoardId,
  ])

  /** A compact conflict escape hatch: keep this device's work as a new board. */
  const saveCurrentBoardAsCopy = useCallback(async () => {
    if (cloudSaveInFlight.current) return

    const sourceId = latestBoardId.current
    const sourceName = latestBoardName.current.trim() || 'Untitled board'
    let name = `${sourceName} copy`
    let copyNumber = 2
    while (boardNameAlreadyInUse(savedBoards, '', name)) {
      name = `${sourceName} copy ${copyNumber}`
      copyNumber += 1
    }

    const sourceSnapshot = createBoardSnapshot(latestNodes.current, latestEdges.current)
    const sourceDocument = boardDocumentFingerprint(sourceName, sourceSnapshot)
    const copy: SavedBoard = {
      id: crypto.randomUUID(),
      name,
      updatedAt: new Date().toISOString(),
      snapshot: sourceSnapshot,
    }
    setCloudSyncStatus('Saving copy…')
    cloudSaveInFlight.current = true
    let finishCopySave!: () => void
    const copySaveCompletion = new Promise<void>((resolve) => {
      finishCopySave = resolve
    })
    cloudSaveCompletion.current = copySaveCompletion
    try {
      const savedCopy = await saveBoard(copy, null)
      setNeedsSignIn(false)
      setSavedBoards((currentBoards) => [
        boardSummary(savedCopy),
        ...currentBoards.filter((board) => board.id !== savedCopy.id),
      ])

      // Do not let an awaited request rewind a drawing made while it was
      // saving. The new copy adopts the live document and its first guarded
      // autosave carries those newer edits forward.
      if (latestBoardId.current === sourceId) {
        const liveName = latestBoardName.current.trim() || sourceName
        const liveSnapshot = createBoardSnapshot(latestNodes.current, latestEdges.current)
        const changedDuringSave = boardDocumentFingerprint(liveName, liveSnapshot) !== sourceDocument
        if (changedDuringSave) {
          const nextName = liveName === sourceName ? savedCopy.name : liveName
          startupDirtyDraft.current = false
          cloudBaselineRef.current = boardDocumentFingerprint(savedCopy.name, savedCopy.snapshot)
          setBoardId(savedCopy.id)
          setBoardName(nextName)
          cloudRevisionRef.current = savedCopy.revision ?? null
          setCloudRevision(savedCopy.revision ?? null)
          const access = savedCopy.access ?? 'owner'
          boardAccessRef.current = access
          setBoardAccess(access)
          cloudDirtyRef.current = true
          setCloudDirty(true)
          setCloudConflictBoard(null)
          setCloudSyncStatus('Saved locally')
          setSelectedBoardId(savedCopy.id)
          setShowingArchivedBoards(false)
        } else {
          applyCloudBoard(savedCopy, 'Synced')
        }
      }
      setStorageStatus(`Saved “${savedCopy.name}”`)
    } catch (error) {
      setNeedsSignIn(error instanceof BoardAccessError)
      setCloudSyncStatus(error instanceof BoardUnavailableError
        ? 'Offline — saved locally'
        : error instanceof BoardAccessError
          ? 'Sign in — saved locally'
          : error instanceof Error ? error.message : 'Unable to save a copy.')
    } finally {
      cloudSaveInFlight.current = false
      finishCopySave()
      if (cloudSaveCompletion.current === copySaveCompletion) {
        cloudSaveCompletion.current = null
      }
      setCloudSaveCycle((current) => current + 1)
    }
  }, [applyCloudBoard, savedBoards])

  /** Replaces the open document only when the author explicitly chooses the newer cloud copy. */
  const reloadCloudBoard = useCallback(() => {
    const remoteBoard = cloudConflictRef.current
    if (!remoteBoard || remoteBoard.archived) return
    applyCloudBoard(remoteBoard, 'Synced')
    setStorageStatus(`Loaded “${remoteBoard.name}”`)
  }, [applyCloudBoard])

  // After automatic creation or cloud load, background changes update the
  // same revision-guarded D1 board.
  useEffect(() => {
    if (
      isSharedAssembly
      || cloudRevision === null
      || !cloudDirty
      || cloudConflictBoard
    ) return

    const timer = window.setTimeout(() => {
      if (boardLoadInFlight.current) return
      void saveCurrentBoard('auto')
    }, CLOUD_AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [
    boardId,
    boardName,
    cloudConflictBoard,
    cloudDirty,
    cloudRevision,
    cloudSaveCycle,
    edges,
    isSharedAssembly,
    nodes,
    saveCurrentBoard,
  ])

  /** Pulls one current board, never the entire potentially image-heavy board list. */
  const refreshCurrentCloudBoard = useCallback(async () => {
    const revision = cloudRevisionRef.current
    const id = latestBoardId.current
    if (isSharedAssembly || revision === null || cloudConflictRef.current || cloudSaveInFlight.current) return
    // Take a synchronous snapshot before awaiting the network. An edit can
    // land while this request is in flight; comparing again below prevents a
    // clean remote response from overwriting that edit before React's dirty
    // effect has had a chance to run.
    const documentAtRequest = boardDocumentFingerprint(
      latestBoardName.current,
      createBoardSnapshot(latestNodes.current, latestEdges.current),
    )

    try {
      const remoteBoard = await fetchBoard(id)
      // A slow request for the board we just left must not switch the editor
      // back to it after a person loads another board.
      if (latestBoardId.current !== id) return
      if (!remoteBoard) {
        setCloudSyncStatus('Cloud board is unavailable')
        return
      }

      // Access is data too. A board owner can change someone from editor to
      // viewer without touching the graph, so apply that role even when the
      // content revision did not change.
      const remoteAccess = remoteBoard.access ?? 'owner'
      if (remoteAccess !== boardAccessRef.current) {
        boardAccessRef.current = remoteAccess
        setBoardAccess(remoteAccess)
        if (remoteAccess !== 'owner') setBoardCollaborators([])
      }
      setSavedBoards((currentBoards) => [
        boardSummary(remoteBoard),
        ...currentBoards.filter((board) => board.id !== remoteBoard.id),
      ])

      if (remoteBoard.archived) {
        setSavedBoards((currentBoards) => currentBoards.filter((board) => board.id !== remoteBoard.id))
        setArchivedBoards((currentBoards) => [
          boardSummary(remoteBoard),
          ...currentBoards.filter((board) => board.id !== remoteBoard.id),
        ])
        setCloudConflictBoard(remoteBoard)
        setCloudSyncStatus('Archived elsewhere')
        return
      }
      const currentRevision = cloudRevisionRef.current
      // Re-read the revision after the await. A response from before this
      // browser's own successful save is older information, not a conflict.
      if (
        currentRevision === null
        || remoteBoard.revision === undefined
        || remoteBoard.revision <= currentRevision
      ) return

      // A clean viewer follows the latest cloud board automatically. An editor
      // with unsaved work keeps that work and gets an explicit choice instead.
      const currentDocument = boardDocumentFingerprint(
        latestBoardName.current,
        createBoardSnapshot(latestNodes.current, latestEdges.current),
      )
      const changedWhileFetching = currentDocument !== documentAtRequest
      const differsFromCloudBaseline = cloudBaselineRef.current !== null
        && currentDocument !== cloudBaselineRef.current
      if (differsFromCloudBaseline && !cloudDirtyRef.current) {
        cloudDirtyRef.current = true
        setCloudDirty(true)
        setCloudSyncStatus('Saved locally')
      }
      if (cloudDirtyRef.current || changedWhileFetching || differsFromCloudBaseline) {
        setCloudConflictBoard(remoteBoard)
        setCloudSyncStatus('Changed elsewhere')
        return
      }
      applyCloudBoard(remoteBoard, 'Synced')
    } catch (error) {
      setNeedsSignIn(error instanceof BoardAccessError)
      if (error instanceof BoardAccessError) {
        setCloudSyncStatus('Sign in — saved locally')
      } else if (error instanceof BoardUnavailableError) {
        setCloudSyncStatus('Offline — saved locally')
      }
    }
  }, [applyCloudBoard, isSharedAssembly])

  useEffect(() => {
    if (isSharedAssembly || cloudRevision === null) return

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshCurrentCloudBoard()
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshCurrentCloudBoard()
    }, CLOUD_REFRESH_INTERVAL_MS)
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [cloudRevision, isSharedAssembly, refreshCurrentCloudBoard])

  const saveBoardAsJson = useCallback(() => {
    downloadBoardSnapshot(createBoardSnapshot(nodes, edges))
  }, [nodes, edges])

  /**
   * Ingests a board file selected through the browser's file picker.
   * Only validated version-1 board snapshots are allowed into live state.
   */
  const loadBoardFromJson = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const snapshot = await readBoardSnapshotFile(file)

      applyBoardSnapshot(snapshot)
      startupDirtyDraft.current = false
      cloudBaselineRef.current = null
      cloudRevisionRef.current = null
      setCloudRevision(null)
      boardAccessRef.current = 'owner'
      setBoardAccess('owner')
      setBoardCollaborators([])
      setCollaborationStatus('')
      cloudDirtyRef.current = false
      setCloudDirty(false)
      setCloudConflictBoard(null)
      setCloudSyncStatus('')
      setBoardId(crypto.randomUUID())
      setBoardName(file.name.replace(/\.json$/i, '') || 'Imported board')
      setStorageStatus('Imported JSON; cloud sync starts automatically when available.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load this board file.'
      window.alert(message)
    } finally {
      // Allows selecting the same file again after making a change.
      event.target.value = ''
    }
  }, [applyBoardSnapshot])

  /** Merges structured data into the latest graph, then opens its Assembly. */
  const addOsaImportPlan = useCallback((
    plan: OsaImportPlan,
    options?: { refreshBundledStarterReferences?: boolean },
  ) => {
    const merge = mergeOsaImportPlan(latestNodes.current, latestEdges.current, plan)
    const importedNodes = options?.refreshBundledStarterReferences
      ? bundledStarter.refreshImportedNodes(merge.nodes, plan)
      : merge.nodes
    setNodes(importedNodes)
    setEdges(merge.edges)
    setNodeSpaceFilter(plan.spaceNodeId ?? '')
    setNodeKindFilter('all')
    setNodeConnectionFilter('all')
    setSelectedAssemblyId(plan.assemblyNodeId)
    setWorkspaceView('assembly')
    setStorageStatus(
      merge.addedNodeCount === 0 && merge.addedEdgeCount === 0
        ? `Opened “${plan.name}”.`
        : `Added ${merge.addedNodeCount} objects and ${merge.addedEdgeCount} connections from “${plan.name}”.`,
    )
  }, [setEdges, setNodes, setWorkspaceView])

  /** Adds a compact OSA data package without replacing the current board. */
  const importOsaDataFromJson = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const candidate: unknown = JSON.parse(await file.text())
      const importPackage = parseOsaImportPackage(candidate)
      addOsaImportPlan(planOsaImport(importPackage))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to import this OSA data file.'
      window.alert(message)
    } finally {
      event.target.value = ''
    }
  }, [addOsaImportPlan])

  /** Opens the configured starter through the same merge path as a file import. */
  const openBundledStarter = useCallback(() => {
    try {
      addOsaImportPlan(bundledStarterImportPlan, {
        refreshBundledStarterReferences: true,
      })
      setBoardName((currentName) => currentName === 'Untitled board'
        ? bundledStarter.name
        : currentName)
    } catch (error) {
      setStorageStatus(error instanceof Error
        ? error.message
        : `Unable to open the bundled ${bundledStarter.name} project.`)
    }
  }, [addOsaImportPlan, bundledStarterImportPlan])

  // React Flow uses object identity to avoid redrawing unchanged nodes. Keep
  // each projection stable while one different node is being dragged.
  const flowNodeCallbacks = useMemo(() => ({
    onNameChange,
    onTextChange,
    onTextInteractionStart,
    onLayoutChange,
    onKindChange,
  }), [onKindChange, onLayoutChange, onNameChange, onTextChange, onTextInteractionStart])
  const flowNodeProjectionCache = useRef(new WeakMap<TextFlowNode, {
    callbacks: typeof flowNodeCallbacks
    annotationTargets: typeof annotationTargets | undefined
    textExpanded: boolean
    detailsExpanded: boolean
    projected: TextFlowNode
  }>())
  const nodesForFlow = useMemo(() => visibleNodes.map((node) => {
    const textExpanded = expandedNode?.id === node.id && expandedNode.text === true
    const detailsExpanded = expandedNode?.id === node.id && expandedNode.details === true
    // Space only consumes annotation data while an actual sketch is open.
    // Omitting it from ordinary collapsed cards avoids invalidating every node
    // when one unrelated position changes.
    const nodeAnnotationTargets = textExpanded && node.data.notebook?.format === 'sketch'
      ? annotationTargets
      : undefined
    const cached = flowNodeProjectionCache.current.get(node)
    if (
      cached
      && cached.callbacks === flowNodeCallbacks
      && cached.annotationTargets === nodeAnnotationTargets
      && cached.textExpanded === textExpanded
      && cached.detailsExpanded === detailsExpanded
    ) return cached.projected

    const projected: TextFlowNode = {
      ...node,
      data: {
        ...node.data,
        annotationTargets: nodeAnnotationTargets,
        textExpanded,
        detailsExpanded,
        ...flowNodeCallbacks,
      },
    }
    flowNodeProjectionCache.current.set(node, {
      callbacks: flowNodeCallbacks,
      annotationTargets: nodeAnnotationTargets,
      textExpanded,
      detailsExpanded,
      projected,
    })
    return projected
  }), [annotationTargets, expandedNode, flowNodeCallbacks, visibleNodes])

  const hoveredEdgeId = hoveredEdge?.edge.id ?? null
  const selectedEdgeId = selectedItem?.type === 'edge' ? selectedItem.id : null
  const edgesForFlow = useMemo(() => visibleEdges
    .map((edge) => ({
      ...edge,
      label: selectedEdgeId === edge.id || hoveredEdgeId === edge.id
        ? edge.data.relationship
        : undefined,
    })), [hoveredEdgeId, selectedEdgeId, visibleEdges])

  const visibleNodesRef = useRef(visibleNodes)
  visibleNodesRef.current = visibleNodes
  const spaceViewportFilterKey = `${selectedSpaceId}\u0000${nodeKindFilter}\u0000${nodeConnectionFilter}`
  useEffect(() => {
    if (workspaceView !== 'nodes' || !visibleNodesRef.current.length) return
    if (lastCenteredSpaceFilterKey.current === spaceViewportFilterKey) return
    lastCenteredSpaceFilterKey.current = spaceViewportFilterKey
    const focusNode = visibleNodesRef.current[0]
    const frame = window.requestAnimationFrame(() => {
      void setCenter(
        focusNode.position.x + focusNode.data.layout.width / 2,
        focusNode.position.y + 44,
        { zoom: 0.8 },
      )
    })
    return () => window.cancelAnimationFrame(frame)
  }, [setCenter, spaceViewportFilterKey, visibleNodeIdsKey, workspaceView])

  // USER ACTION: dragging from one handle onto another makes an edge.
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return
    const sourceNode = nodes.find((node) => node.id === connection.source)
    const targetNode = nodes.find((node) => node.id === connection.target)
    if (sourceNode?.data.kind === 'space' && targetNode && targetNode.data.kind !== 'space') {
      setNodes((currentNodes) => addNodeToSpace(currentNodes, targetNode.id, sourceNode.id))
    } else if (targetNode?.data.kind === 'space' && sourceNode && sourceNode.data.kind !== 'space') {
      setNodes((currentNodes) => addNodeToSpace(currentNodes, sourceNode.id, targetNode.id))
    }
    const sourceIsActionContext = sourceNode?.data.kind === 'project'
      || (sourceNode !== undefined && osaRole(sourceNode) === 'assembly')
    const targetIsActionContext = targetNode?.data.kind === 'project'
      || (targetNode !== undefined && osaRole(targetNode) === 'assembly')
    if (sourceNode && sourceIsActionContext && targetNode?.data.kind === 'action') {
      linkTaskToProject(targetNode.id, sourceNode.id)
      return
    }
    if (sourceNode?.data.kind === 'action' && targetNode && targetIsActionContext) {
      linkTaskToProject(sourceNode.id, targetNode.id)
      return
    }
    setEdges((currentEdges) => [...currentEdges, makeEdge(connection.source, connection.target)])
  }, [linkTaskToProject, makeEdge, nodes, setEdges, setNodes])

  // USER ACTION: dragging from a handle into empty canvas makes a node and edge.
  const onConnectEnd: OnConnectEnd = useCallback((event, connectionState) => {
    if (connectionState.isValid || !connectionState.fromNode) return

    const point = 'changedTouches' in event ? event.changedTouches[0] : event
    const id = String(nextId.current)
    nextId.current += 1
    const position = screenToFlowPosition({ x: point.clientX, y: point.clientY })
    setNodes((currentNodes) => {
      return [...currentNodes, createTextNode({
        id,
        position,
        name: `#${id}`,
        text: `Node: ${id}`,
        spaceIds: spaceIdsForNewNode(currentNodes, nodeSpaceFilter, 'note'),
      })]
    })
    setEdges((currentEdges) => [
      ...currentEdges,
      makeEdge(connectionState.fromNode.id, id),
    ])
  }, [makeEdge, nodeSpaceFilter, screenToFlowPosition, setEdges, setNodes])

  // One editor host serves canvases opened from either Assembly or a Part/Tool
  // node card. Closing it changes only temporary UI state, so the underlying
  // view and selected node remain exactly where they were.
  const editingVisualCandidate = assemblyViewState.editingVisualId
    ? nodes.find((node) => node.id === assemblyViewState.editingVisualId)
    : undefined
  const editingVisual = isVisualNode(editingVisualCandidate)
    ? editingVisualCandidate
    : undefined
  const editingVisualOwner = editingVisual
    ? visualOwnerFor(editingVisual.id, nodes, edges)
    : undefined
  const editingVisualNameIsInherited = editingVisualOwner !== undefined
    && osaRole(editingVisualOwner) === 'step'
  const editingVisualEmbeds = editingVisual
    ? visualDraftEmbedsForCanvas(editingVisual.id, nodes, edges)
    : []
  const editingVisualCandidates = useMemo(
    () => nodes.filter(isVisualNode),
    [nodes],
  )
  const closeVisualCanvasEditor = useCallback(() => {
    setAssemblyViewState((current) => ({
      ...current,
      editingVisualId: null,
      editingOperationId: null,
    }))
  }, [])
  return (
    <div
      className={`osa-workspace${workspaceMenuVisible ? '' : ' workspace-menu-hidden'}`}
      onPointerDownCapture={canvasLabVisible ? undefined : beginPointerPalettePress}
      onPointerMoveCapture={canvasLabVisible ? undefined : movePointerPalettePress}
      onPointerUpCapture={canvasLabVisible ? undefined : finishPointerPalettePress}
      onPointerCancelCapture={canvasLabVisible ? undefined : finishPointerPalettePress}
    >
      <ReactFlow
      className={`space-canvas${visibleEdges.length > 60 ? ' is-dense' : ''}`}
      inert={workspaceView !== 'nodes' || canvasLabVisible}
      aria-hidden={workspaceView !== 'nodes' || canvasLabVisible}
      nodesFocusable={workspaceView === 'nodes' && !canvasLabVisible}
      edgesFocusable={workspaceView === 'nodes' && !canvasLabVisible}
      nodes={nodesForFlow}
      edges={edgesForFlow}
      nodeTypes={nodeTypes}
      onInit={(instance) => {
        const focusNode = visibleNodesRef.current[0]
        if (!focusNode) return
        lastCenteredSpaceFilterKey.current = spaceViewportFilterKey
        void instance.setCenter(
          focusNode.position.x + focusNode.data.layout.width / 2,
          focusNode.position.y + 44,
          { zoom: 0.8 },
        )
      }}
      onNodesChange={onNodesChange}
      onNodesDelete={onNodesDelete}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onConnectEnd={onConnectEnd}
      onNodeClick={onNodeClick}
      onNodeContextMenu={(event, node) => {
        event.preventDefault()
        if (performance.now() < suppressPointerContextMenuUntil.current) return
        setSelectedItem({ type: 'node', id: node.id })
        openPointerPalette(event.clientX, event.clientY, node.id)
      }}
      onEdgeClick={onEdgeClick}
      onEdgeMouseEnter={updateHoveredEdge}
      onEdgeMouseMove={updateHoveredEdge}
      onEdgeMouseLeave={onEdgeMouseLeave}
      onPaneClick={() => {
        if (performance.now() < suppressPointerPaletteClickUntil.current) return
        if (performance.now() < suppressPaneCollapseUntil.current) return
        setSelectedItem(null)
        setExpandedNode(null)
        setHoveredEdge(null)
      }}
      onPaneContextMenu={(event) => {
        event.preventDefault()
        if (performance.now() < suppressPointerContextMenuUntil.current) return
        openPointerPalette(event.clientX, event.clientY)
      }}
      onlyRenderVisibleElements
      minZoom={0.05}
      maxZoom={8}
      colorMode={theme}
      proOptions={{ hideAttribution: true }}
      >
      <svg className="hand-drawn-filter" aria-hidden="true">
        <defs>
          <filter id="hand-drawn-line" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.035"
              numOctaves="2"
              seed="7"
              result="lineNoise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="lineNoise"
              scale="1.35"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
          <filter id="hand-drawn-dot" x="-35%" y="-35%" width="170%" height="170%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.055"
              numOctaves="2"
              seed="11"
              result="dotNoise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="dotNoise"
              scale="2"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>
      <Background />
      {workspaceView === 'nodes' && selectedNode && inspectorExpanded && (
        <Panel
          position="top-right"
          id="selected-item-inspector"
          className="inspector-dock is-pinned"
          style={{
            top: '50%',
            bottom: 'auto',
            transform: 'translateY(-50%)',
          }}
        >
          <button
            className="inspector-dock__toggle"
            type="button"
            onClick={() => setInspectorExpanded(false)}
          >
            Close inspector
          </button>
          <PropertiesPanel
            node={selectedNode}
            spaces={allSpaces}
            includedIn={selectedInclusions}
            availableContainers={selectedAvailableContainers}
            onNameChange={onNameChange}
            onTextChange={onTextChange}
            onSpaceIdsChange={onSpaceIdsChange}
            onIncludeInContainer={assemblyGraphActions.onIncludeInContainer}
            onRemoveInclusionRelationship={onRemoveInclusionRelationship}
            onPropertyChange={onPropertyChange}
            onPropertyRename={onPropertyRename}
            onPropertyRemove={onPropertyRemove}
            onPropertyAdd={onPropertyAdd}
            ownedVisuals={selectedOwnedVisuals}
            onCreateOwnedVisualCanvas={createOwnedVisualCanvas}
            onOpenOwnedVisual={openOwnedVisualCanvas}
            onRemoveOwnedVisualCanvas={removeOwnedVisualCanvas}
          />
        </Panel>
      )}
      {workspaceView === 'nodes' && selectedEdge && inspectorExpanded && (
        <Panel
          position="top-right"
          id="selected-item-inspector"
          className="inspector-dock is-pinned"
          style={{
            top: '50%',
            bottom: 'auto',
            transform: 'translateY(-50%)',
          }}
        >
          <button
            className="inspector-dock__toggle"
            type="button"
            onClick={() => setInspectorExpanded(false)}
          >
            Close inspector
          </button>
          <EdgePropertiesPanel
            edge={selectedEdge}
            onRelationshipChange={onEdgeRelationshipChange}
            onPropertyChange={onEdgePropertyChange}
            onPropertyRename={onEdgePropertyRename}
            onPropertyRemove={onEdgePropertyRemove}
            onPropertyAdd={onEdgePropertyAdd}
          />
        </Panel>
      )}
      {workspaceView === 'nodes' && showTable && (
      <Panel
        position="bottom-center"
        id="board-table"
        className={`table-dock is-pinned${tablePeek ? ' is-peek' : ''}`}
      >
          <GraphTablePanel
            nodes={nodes}
            edges={edges}
            selectedItem={selectedItem}
            onInspectNode={inspectNodeFromTable}
            onRevealNode={revealNodeFromTable}
            onSelectEdge={(id) => {
              setSelectedItem({ type: 'edge', id })
              setInspectorExpanded(true)
            }}
          />
        <div className="table-dock__actions">
          {tablePeek ? (
            <button
              className="table-dock__toggle"
              type="button"
              onClick={() => setTablePeek(false)}
            >
              Full table
            </button>
          ) : null}
          <button
            className="table-dock__toggle"
            type="button"
            onClick={() => {
              setShowTable(false)
              setTablePeek(false)
            }}
          >
            Close board table
          </button>
        </div>
      </Panel>
      )}
      </ReactFlow>
      {canvasLabVisible ? (
        <Suspense fallback={<div className="canvas-lab-loading" role="status">Opening lab…</div>}>
          <CanvasLab theme={theme} onToggleTheme={toggleTheme} onExit={closeCanvasLab} />
        </Suspense>
      ) : null}
      {!canvasLabVisible ? (
        !isSharedAssembly ? (
          <div className="workspace-top-chrome">
            {workspaceMenuVisible ? (
              <nav className="workspace-switcher" aria-label="OSA tools">
                <button
                  className="workspace-switcher__hide"
                  type="button"
                  aria-label="Hide top menu"
                  onClick={() => setWorkspaceMenuVisible(false)}
                >
                  Hide
                </button>
                {([
                  { id: 'assembly', label: 'Assembly' },
                  { id: 'nodes', label: 'Space' },
                ] as const).map((view) => (
                  <button
                    className={workspaceView === view.id ? 'is-active' : undefined}
                    type="button"
                    key={view.id}
                    aria-current={workspaceView === view.id ? 'page' : undefined}
                    onClick={() => {
                      setAssemblyInstructionsPreview(false)
                      setWorkspaceView(view.id)
                    }}
                  >
                    {view.label}
                  </button>
                ))}
                {import.meta.env.DEV ? (
                  <button
                    type="button"
                    aria-label="Open Canvas Lab"
                    onClick={openCanvasLab}
                  >
                    Lab
                  </button>
                ) : null}
                <WorkspaceSettingsMenu
                  theme={theme}
                  onToggleTheme={toggleTheme}
                  boardId={boardId}
                  boardName={boardName}
                  boardAccess={boardAccess}
                  savedBoards={savedBoards}
                  archivedBoards={archivedBoards}
                  selectedBoardId={selectedBoardId}
                  showingArchivedBoards={showingArchivedBoards}
                  canArchiveCurrentBoard={savedBoards.some((board) => board.id === boardId)}
                  onBoardNameChange={setBoardName}
                  onSelectedBoardIdChange={setSelectedBoardId}
                  onShowSavedBoards={showActiveBoardList}
                  onShowArchivedBoards={showArchivedBoardList}
                  onLoadSelectedBoard={loadSelectedBoard}
                  onArchiveCurrentBoard={archiveCurrentBoard}
                  onRestoreSelectedBoard={restoreSelectedBoard}
                  onManualSync={saveBoardToDatabase}
                  storageStatus={storageStatus}
                  cloudSyncStatus={cloudSyncStatus}
                  localDraftStatus={draftStatus}
                  cloudRevision={cloudRevision}
                  needsSignIn={needsSignIn}
                  cloudConflictBoard={cloudConflictBoard}
                  onReloadCloudBoard={reloadCloudBoard}
                  onSaveBoardAsCopy={saveCurrentBoardAsCopy}
                  collaborators={boardCollaborators}
                  collaborationStatus={collaborationStatus}
                  onAddCollaborator={boardAccess === 'owner' ? addBoardCollaborator : undefined}
                  onRemoveCollaborator={boardAccess === 'owner' ? removeBoardCollaboratorAccess : undefined}
                  activeAssemblyLabel={activeAssembly ? nodeTitle(activeAssembly) : null}
                  shareSlug={shareSlug}
                  shareStatus={shareStatus}
                  shareUrl={shareUrl}
                  onShareSlugChange={setShareSlug}
                  onCreateAssemblyShare={boardAccess === 'owner' ? createAssemblyShareLink : undefined}
                  onPreviewAssembly={activeAssembly ? () => setAssemblyInstructionsPreview(true) : undefined}
                  onDownloadJsonBackup={saveBoardAsJson}
                  onLoadJsonBackup={loadBoardFromJson}
                  onImportOsaData={importOsaDataFromJson}
                />
                <span className="workspace-switcher__status" role="status">
                  {cloudSyncStatus || draftStatus}
                </span>
              </nav>
            ) : (
              <button
                className="workspace-switcher-reveal"
                type="button"
                aria-label="Show top menu"
                onClick={() => setWorkspaceMenuVisible(true)}
              >
                <span aria-hidden="true">⌄</span>
              </button>
            )}
            {workspaceView === 'nodes' ? (
              <div className="space-command-bar" role="toolbar" aria-label="Space controls">
                <div className="space-command-bar__group">
                  <span className="space-command-bar__label">tools</span>
                  <div className="space-canvas-toolbar" role="group" aria-label="Space tools">
                    <button type="button" onClick={addNode}>+ Node</button>
                    <button
                      type="button"
                      aria-pressed={showTable}
                      aria-controls="board-table"
                      onClick={() => {
                        if (!showTable) setTablePeek(false)
                        setShowTable(!showTable)
                      }}
                    >
                      Table
                    </button>
                  </div>
                </div>
                <div className="space-command-bar__group is-filters">
                  <span className="space-command-bar__label">filters</span>
                  <SpaceToolbar
                    spaces={allSpaces}
                    selectedSpaceId={selectedSpaceId}
                    kindFilter={nodeKindFilter}
                    connectionFilter={nodeConnectionFilter}
                    onSpaceChange={setNodeSpaceFilter}
                    onKindChange={setNodeKindFilter}
                    onConnectionChange={setNodeConnectionFilter}
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="shared-assembly-status" role="status">
            {shareStatus || 'Loading shared assembly…'}
          </p>
        )
      ) : null}
      {!canvasLabVisible && workspaceView !== 'nodes' ? (
        <div className="work-view-shell">
          {workspaceView === 'notebook' ? (
            <NotebookView
              pages={notebookPages}
              nodes={nodes}
              edges={edges}
              selectedPageId={activeNotebookPageId}
              onSelectPage={selectNotebookPage}
              onCreatePage={createNotebookPage}
              onNameChange={onNameChange}
              onTextChange={onTextChange}
              onSketchChange={onSketchChange}
              onCreateFromSelection={createFromTextSelection}
              onLinkSelection={connectFromTextSelection}
              onOpenNode={openNodeInSpace}
            />
          ) : workspaceView === 'projects' ? (
            <ProjectsView
              projects={projects}
              tasks={tasks}
              edges={edges}
              selectedProjectId={activeProjectId}
              today={taskViewDay}
              onSelectProject={setSelectedProjectId}
              onCreateAction={createTask}
              onCreateTask={createTaskForProject}
              onProjectTitleChange={onNameChange}
              onProjectTextChange={onTextChange}
              onTaskTextChange={onTextChange}
              onTaskDayChange={onTaskDayChange}
              onTaskCompletionChange={onTaskCompletionChange}
              onLinkProject={linkTaskToProject}
              onUnlinkProject={unlinkTaskFromProject}
              onLinkTask={(projectId, taskId) => linkTaskToProject(taskId, projectId)}
              onUnlinkTask={(projectId, taskId) => unlinkTaskFromProject(taskId, projectId)}
              onOpenNode={openNodeInSpace}
            />
          ) : isSharedAssembly || assemblyInstructionsPreview ? (
            <AssemblyInstructionsView
              assembly={assemblies.find((assembly) => assembly.id === activeAssemblyId)}
              nodes={nodes}
              operations={operations}
              edges={edges}
              statusMessage={isSharedAssembly && sharedAssemblyLoadState !== 'ready'
                ? shareStatus || 'Loading shared assembly…'
                : undefined}
              onBackToAssembly={isSharedAssembly
                ? undefined
                : () => setAssemblyInstructionsPreview(false)}
            />
          ) : (
            <AssemblyView
              assemblies={assemblies}
              nodes={nodes}
              operations={operations}
              edges={edges}
              uiState={assemblyViewState}
              onUiStateChange={setAssemblyViewState}
              tools={nodes.filter((node) => (
                node.data.kind === 'tool' || node.data.properties[OSA_PROPERTY.role] === 'tool'
              ))}
              selectedAssemblyId={activeAssemblyId}
              onSelectAssembly={setSelectedAssemblyId}
              actions={assemblyViewActions}
              onInspectNode={openFocusedNodeInspector}
              readOnly={boardAccess === 'viewer'}
              starterAction={{
                label: bundledStarter.openActionLabel,
                onLoad: openBundledStarter,
              }}
            />
          )}
        </div>
      ) : null}
      {focusedInspectorNode ? (
        <FocusedNodeInspector
          node={focusedInspectorNode}
          onClose={() => setFocusedInspectorNodeId(null)}
        >
          <PropertiesPanel
            node={focusedInspectorNode}
            spaces={allSpaces}
            includedIn={focusedInclusions}
            availableContainers={focusedAvailableContainers}
            onNameChange={onNameChange}
            onTextChange={onTextChange}
            onSpaceIdsChange={onSpaceIdsChange}
            onIncludeInContainer={assemblyGraphActions.onIncludeInContainer}
            onRemoveInclusionRelationship={onRemoveInclusionRelationship}
            onPropertyChange={onPropertyChange}
            onPropertyRename={onPropertyRename}
            onPropertyRemove={onPropertyRemove}
            onPropertyAdd={onPropertyAdd}
            ownedVisuals={focusedInspectorOwnedVisuals}
            onCreateOwnedVisualCanvas={createOwnedVisualCanvas}
            onOpenOwnedVisual={openOwnedVisualCanvas}
            onRemoveOwnedVisualCanvas={removeOwnedVisualCanvas}
          />
        </FocusedNodeInspector>
      ) : null}
      {editingVisual ? (
        <VisualCanvasEditor
          key={editingVisual.id}
          visual={editingVisual}
          embeddedVisuals={editingVisualEmbeds}
          availableVisuals={editingVisualCandidates}
          readOnly={boardAccess === 'viewer'}
          onClose={closeVisualCanvasEditor}
          onNameChange={onNameChange}
          nameReadOnly={editingVisualNameIsInherited}
          onSketchChange={onSketchChange}
          onPropertyChange={onPropertyChange}
          onEmbeddedVisualsChange={saveVisualEmbeds}
          graphNodes={nodes}
          graphEdges={edges}
          annotationTargets={annotationTargets}
          onSaveDraftVersion={(visualId) => captureVisualVersion(visualId, 'draft')}
          onMakeOfficialVersion={(visualId) => captureVisualVersion(visualId, 'official')}
          onRestoreVisualVersion={restoreVisualVersionAsDraft}
          onCreateIndependentVisualCopy={createIndependentVisualCopy}
        />
      ) : null}
      {!canvasLabVisible && pointerPalette ? (
        <PointerToolPalette
          x={pointerPalette.x}
          y={pointerPalette.y}
          label={pointerPalette.sourceNodeId ? 'Node tools' : 'Create'}
          actions={pointerPaletteActions}
          onClose={closePointerPalette}
        />
      ) : null}
      {!canvasLabVisible && hoveredEdge && createPortal(
        <EdgeHoverCard
          edge={hoveredEdge.edge}
          x={hoveredEdge.x}
          y={hoveredEdge.y}
        />,
        document.body,
      )}
    </div>
  )
}

/** Provides React Flow context, then mounts the interactive canvas. */
export default function App() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  )
}

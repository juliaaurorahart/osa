import { createGraphEdge, type GraphEdge } from './graphEdge'
import { createTextNode, type TextFlowNode } from './textNode'
import { CURRENT_SOURCE_PATHS } from '../generated/currentSourcePaths'

/**
 * This module consumes a generated manifest of the files under `src/`.
 * The generator runs before `npm run dev` and `npm run build`, so the browser
 * receives only paths—not source code or dynamic module imports.
 */

export type CodebaseHierarchy = {
  nodes: TextFlowNode[]
  edges: GraphEdge[]
}

function folderId(path: string) {
  return `folder:${path}`
}

function fileId(path: string) {
  return `file:${path}`
}

function parentFolderPath(path: string) {
  const segments = path.split('/')
  segments.pop()
  return segments.join('/')
}

function displayName(path: string) {
  return path.split('/').at(-1) ?? path
}

function extension(path: string) {
  const name = displayName(path)
  const lastDot = name.lastIndexOf('.')
  return lastDot === -1 ? '' : name.slice(lastDot)
}

/**
 * Creates a graph representation of this application's current `src/` tree.
 *
 * Every folder and file is still just a standard TextFlowNode. `contains`
 * edges give the hierarchy its first, simple relationship meaning.
 */
export function createCurrentSourceHierarchy(): CodebaseHierarchy {
  const filePaths = [...CURRENT_SOURCE_PATHS]

  const folderPaths = new Set<string>()
  for (const filePath of filePaths) {
    let folderPath = parentFolderPath(filePath)
    while (folderPath) {
      folderPaths.add(folderPath)
      folderPath = parentFolderPath(folderPath)
    }
  }

  const orderedFolders = [...folderPaths].sort((left, right) => {
    const depthDifference = left.split('/').length - right.split('/').length
    return depthDifference || left.localeCompare(right)
  })
  const rowByDepth = new Map<number, number>()
  const nextPosition = (path: string) => {
    const depth = path.split('/').length - 1
    const row = rowByDepth.get(depth) ?? 0
    rowByDepth.set(depth, row + 1)
    return { x: depth * 300, y: row * 120 }
  }

  const folderNodes = orderedFolders.map((path) => createTextNode({
    id: folderId(path),
    position: nextPosition(path),
    text: displayName(path),
    kind: 'folder',
    properties: {
      path,
      itemType: 'folder',
    },
  }))
  const fileNodes = filePaths.map((path) => createTextNode({
    id: fileId(path),
    position: nextPosition(path),
    text: displayName(path),
    kind: 'source-file',
    properties: {
      path,
      itemType: 'file',
      extension: extension(path),
    },
  }))

  const folderEdges = orderedFolders.flatMap((path) => {
    const parentPath = parentFolderPath(path)
    return parentPath
      ? [createGraphEdge({
          id: `contains:${parentPath}:${path}`,
          source: folderId(parentPath),
          target: folderId(path),
          relationship: 'contains',
        })]
      : []
  })
  const fileEdges = filePaths.map((path) => {
    const parentPath = parentFolderPath(path)
    return createGraphEdge({
      id: `contains:${parentPath}:${path}`,
      source: folderId(parentPath),
      target: fileId(path),
      relationship: 'contains',
    })
  })

  return {
    nodes: [...folderNodes, ...fileNodes],
    edges: [...folderEdges, ...fileEdges],
  }
}

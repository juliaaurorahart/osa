import {
  OSA_OPERATION_INSTRUCTION_MODE,
  OSA_OPERATION_STATUS,
  OSA_PROPERTY,
  OSA_RELATION,
} from '../graph/osaData'
import {
  parseOsaImportPackage,
  planOsaImport,
  type OsaImportPackage,
} from '../graph/osaImport'
import type { OsaStarter } from './starter'

/**
 * A deliberately fictional public example. It exercises the Assembly status,
 * count, people, and alert views without publishing a real production process.
 */
const publicDemoPackage = {
  format: 'osa-import',
  version: 1,
  id: 'public-picnic-kit-demo',
  name: 'Picnic Kit Demo',
  sources: [],
  nodes: [
    {
      id: 'space',
      kind: 'space',
      name: 'Picnic Kit Demo',
      text: 'A fictional public workspace for trying OSA.',
      spaceIds: [],
      properties: {},
    },
    {
      id: 'assembly',
      kind: 'part',
      name: 'Pack a Picnic Kit',
      text: 'A fictional sample project. Nothing in this demo describes a real product or production process.',
      spaceIds: ['space'],
      properties: {
        [OSA_PROPERTY.role]: 'assembly',
      },
    },
    {
      id: 'operation-1',
      kind: 'action',
      name: 'Set out the tote',
      text: 'Place one empty tote on the table and open it fully.',
      spaceIds: ['space'],
      properties: {
        [OSA_PROPERTY.role]: 'operation',
        [OSA_PROPERTY.order]: '1',
        [OSA_PROPERTY.operationStatus]: OSA_OPERATION_STATUS.complete,
        [OSA_PROPERTY.operationCompletedCount]: '12',
        [OSA_PROPERTY.operationPeople]: JSON.stringify(['Demo A']),
        [OSA_PROPERTY.operationInstructionMode]: OSA_OPERATION_INSTRUCTION_MODE.single,
      },
    },
    {
      id: 'operation-2',
      kind: 'action',
      name: 'Add cups and napkins',
      text: 'Put one bundle of cups and one bundle of napkins in each tote.',
      spaceIds: ['space'],
      properties: {
        [OSA_PROPERTY.role]: 'operation',
        [OSA_PROPERTY.order]: '2',
        [OSA_PROPERTY.operationStatus]: OSA_OPERATION_STATUS.inProgress,
        [OSA_PROPERTY.operationCompletedCount]: '7',
        [OSA_PROPERTY.operationPeople]: JSON.stringify(['Demo B', 'Demo C']),
        [OSA_PROPERTY.operationInstructionMode]: OSA_OPERATION_INSTRUCTION_MODE.single,
      },
    },
    {
      id: 'operation-3',
      kind: 'action',
      name: 'Add place cards',
      text: 'Add one name card for every fictional guest.',
      spaceIds: ['space'],
      properties: {
        [OSA_PROPERTY.role]: 'operation',
        [OSA_PROPERTY.order]: '3',
        [OSA_PROPERTY.operationStatus]: OSA_OPERATION_STATUS.partialComplete,
        [OSA_PROPERTY.operationCompletedCount]: '5',
        [OSA_PROPERTY.operationPeople]: JSON.stringify(['Demo D']),
        [OSA_PROPERTY.operationAttention]: 'Three blank cards still need names.',
        [OSA_PROPERTY.operationInstructionMode]: OSA_OPERATION_INSTRUCTION_MODE.single,
      },
    },
    {
      id: 'operation-4',
      kind: 'action',
      name: 'Close the tote',
      text: 'Fold the top closed after the other demo instructions are finished.',
      spaceIds: ['space'],
      properties: {
        [OSA_PROPERTY.role]: 'operation',
        [OSA_PROPERTY.order]: '4',
        [OSA_PROPERTY.operationStatus]: OSA_OPERATION_STATUS.notStarted,
        [OSA_PROPERTY.operationCompletedCount]: '0',
        [OSA_PROPERTY.operationPeople]: '[]',
        [OSA_PROPERTY.operationInstructionMode]: OSA_OPERATION_INSTRUCTION_MODE.single,
      },
    },
  ],
  edges: [1, 2, 3, 4].map((order) => ({
    id: `assembly-operation-${order}`,
    source: 'assembly',
    target: `operation-${order}`,
    relationKind: 'project-task',
    relationship: 'contains instruction',
    properties: {
      [OSA_PROPERTY.relationRole]: OSA_RELATION.assemblyOperation,
    },
  })),
} satisfies OsaImportPackage

function createPublicDemoImportPlan() {
  return planOsaImport(parseOsaImportPackage(publicDemoPackage))
}

/** Public starter behavior stays generic; it never inspects private projects. */
export const publicDemoStarter: OsaStarter = {
  id: publicDemoPackage.id,
  name: publicDemoPackage.name,
  openActionLabel: 'open fictional Picnic Kit demo',
  compactOpenActionLabel: 'open fictional demo',
  createImportPlan: createPublicDemoImportPlan,
  refreshImportedNodes: (nodes) => nodes,
  migrateLegacyGraph: (nodes, edges) => ({ nodes, edges }),
}

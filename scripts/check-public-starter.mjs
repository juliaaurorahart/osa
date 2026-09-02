import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
})

try {
  const { bundledStarter } = await server.ssrLoadModule('/src/starters/index.ts')
  const { osaRole } = await server.ssrLoadModule('/src/graph/osaData.ts')
  const plan = bundledStarter.createImportPlan()
  const serializedPlan = JSON.stringify(plan)

  assert.equal(bundledStarter.id, 'public-picnic-kit-demo')
  assert.equal(bundledStarter.name, 'Picnic Kit Demo')
  assert.match(bundledStarter.openActionLabel, /fictional/i)
  assert.equal(plan.name, bundledStarter.name)
  assert.equal(plan.nodes.filter((node) => osaRole(node) === 'assembly').length, 1)
  assert.equal(plan.nodes.filter((node) => osaRole(node) === 'operation').length, 4)
  assert.ok(plan.spaceNodeId)
  assert.ok(plan.assemblyNodeId)
  assert.doesNotMatch(
    serializedPlan,
    /shako|connector box|heat shrink|v-out|import-assets/i,
    'The public starter must not carry private production terms or asset paths.',
  )

  const sameNodes = bundledStarter.refreshImportedNodes(plan.nodes, plan)
  const sameGraph = bundledStarter.migrateLegacyGraph(plan.nodes, plan.edges)
  assert.equal(sameNodes, plan.nodes, 'The public starter never rewrites an existing board.')
  assert.equal(sameGraph.nodes, plan.nodes)
  assert.equal(sameGraph.edges, plan.edges)

  console.log('Fictional public starter is isolated from private production data.')
} finally {
  await server.close()
}

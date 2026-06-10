/**
 * Sankey Performance Benchmark
 * Measures d3-sankey layout computation time with mock data
 */

import { sankey, sankeyLinkHorizontal } from 'd3-sankey'

function fmt(n) {
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function benchmark(label, fn, iterations = 5) {
  const times = []
  // Warmup
  fn()
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    fn()
    const elapsed = performance.now() - start
    times.push(elapsed)
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length
  const min = Math.min(...times)
  const max = Math.max(...times)
  console.log(`  ${label}: avg=${avg.toFixed(2)}ms min=${min.toFixed(2)}ms max=${max.toFixed(2)}ms`)
  return avg
}

// Generate mock data matching real-world scenarios
function generateData(numCategories) {
  const nodes = []
  const links = []
  const nodeNames = new Set()

  nodes.push({ name: 'Total Budget', category: 'budget' })
  nodeNames.add('Total Budget')

  let totalBudget = 0
  for (let i = 0; i < numCategories; i++) {
    const catName = `Category ${i + 1}`
    if (!nodeNames.has(catName)) {
      nodes.push({ name: catName, category: 'category', color: '#f59e0b' })
      nodeNames.add(catName)
    }
    const budgetAmount = Math.round(Math.random() * 500 + 100)
    totalBudget += budgetAmount
    links.push({
      source: 'Total Budget',
      target: catName,
      value: budgetAmount,
      sourceCategory: 'budget',
      targetCategory: 'category',
    })
  }

  nodes.push({ name: 'Total Actual', category: 'actual' })
  nodeNames.add('Total Actual')

  for (let i = 0; i < numCategories; i++) {
    const catName = `Category ${i + 1}`
    const actualAmount = Math.round(Math.random() * 400 + 50)
    links.push({
      source: catName,
      target: 'Total Actual',
      value: actualAmount,
      sourceCategory: 'category',
      targetCategory: 'actual',
    })
  }

  return { nodes, links, totalBudget }
}

function runSankeyLayout(data) {
  const generator = sankey()
    .nodeWidth(20)
    .nodePadding(10)
    .extent([
      [10, 10],
      [760, 390],
    ])
    .nodeId((d) => d.name)

  return generator({
    nodes: data.nodes.map((d) => ({ ...d })),
    links: data.links.map((d) => ({ ...d })),
  })
}

console.log('=== Sankey Performance Benchmark ===\n')

// Test 1: Typical small data (10 categories = 22 nodes, ~20 links)
console.log('--- Small data (10 categories, typical real-world) ---')
const smallData = generateData(10)
benchmark('Layout compute', () => runSankeyLayout(smallData))

// Test 2: Medium data (50 categories)
console.log('\n--- Medium data (50 categories) ---')
const mediumData = generateData(50)
benchmark('Layout compute', () => runSankeyLayout(mediumData))

// Test 3: Large data (200 categories)
console.log('\n--- Large data (200 categories) ---')
const largeData = generateData(200)
benchmark('Layout compute', () => runSankeyLayout(largeData), 3)

// Test 4: Very large (1000 categories)
console.log('\n--- Very large data (1000 categories) ---')
const hugeData = generateData(1000)
benchmark('Layout compute', () => runSankeyLayout(hugeData), 2)

// Test 5: Degenerate case - many nodes with same name
console.log('\n--- Degenerate: duplicate node names ---')
const dupData = {
  nodes: Array.from({ length: 100 }, (_, i) => ({ name: 'Same', category: 'cat' })),
  links: Array.from({ length: 99 }, (_, i) => ({
    source: 'Same',
    target: 'Same',
    value: 100,
  })),
}
try {
  benchmark('Layout compute (dupes)', () => runSankeyLayout(dupData), 2)
} catch (e) {
  console.log('  ERROR:', e.message)
}

// Test 6: Circular links (budget → category → budget)
console.log('\n--- Circular links ---')
const circularData = {
  nodes: [
    { name: 'A', category: 'budget' },
    { name: 'B', category: 'category' },
    { name: 'C', category: 'actual' },
  ],
  links: [
    { source: 'A', target: 'B', value: 100 },
    { source: 'B', target: 'A', value: 50 },
    { source: 'B', target: 'C', value: 100 },
  ],
}
try {
  benchmark('Layout compute (circular)', () => runSankeyLayout(circularData), 3)
} catch (e) {
  console.log('  ERROR:', e.message)
}

// Test 7: Repeated computation (simulates reactive re-render)
console.log('\n--- Repeated computation stress test ---')
const stressData = generateData(30)
let totalTime = 0
for (let i = 0; i < 100; i++) {
  const start = performance.now()
  runSankeyLayout(stressData)
  totalTime += performance.now() - start
}
console.log(`  100 iterations with 30 categories: ${totalTime.toFixed(0)}ms total (${(totalTime / 100).toFixed(2)}ms avg)`)

console.log('\n=== Benchmark Complete ===')

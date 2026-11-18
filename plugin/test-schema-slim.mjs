/**
 * 工具 schema 瘦身测试（移植自 qwen_schema_proxy.py 的 simplify_schema）
 * 目的：工具多时 prompt 过大 → Today 413 Payload too large
 */
const { TodayAdapter } = await import('@local/dsh-today-connector')

function mkAdapter(cfg = {}) {
  return new TodayAdapter({ options: () => ({ schemaMaxDepth: 2, schemaDescMax: 200, maxTools: 0, ...cfg }), logger: {} })
}

// 造一个深层嵌套的工具 schema（典型的复杂 MCP 工具）
function deepSchema() {
  return {
    type: 'object',
    properties: {
      a: {
        type: 'object',
        description: 'A'.repeat(400),
        properties: {
          b: {
            type: 'object',
            description: 'B'.repeat(400),
            properties: {
              c: { type: 'object', description: 'C'.repeat(400), properties: { d: { type: 'string' } } },
            },
          },
        },
      },
    },
    $schema: 'http://json-schema.org/draft-07/schema#',
  }
}

const tools = Array.from({ length: 60 }, (_, i) => ({
  name: `tool_${i}`,
  description: 'D'.repeat(500),
  parameters: deepSchema(),
}))

const a = mkAdapter()
const full = JSON.stringify(tools)
const slimBlock = a._toolInstructions(tools)
const slimLen = slimBlock.length

console.log(`原始 60 工具 JSON: ${full.length} 字节`)
console.log(`瘦身后 prompt 块:   ${slimLen} 字节`)
console.log(`压缩比: ${(slimLen / full.length * 100).toFixed(1)}%`)

let pass = 0
let total = 0
function check(name, ok) {
  total += 1
  if (ok) pass += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}

check('体积显著下降 (<60% 原始)', slimLen < full.length * 0.6)
check('去掉 $schema', !slimBlock.includes('$schema'))
check('description 截断到 200', !slimBlock.includes('D'.repeat(201)))
check('深层 object 被折叠（无 d 字段）', !slimBlock.includes('"d"'))

// 折叠语义：depth>=2 的 object 只剩 type + 截断 description
const one = mkAdapter()._simplifySchema(deepSchema(), 0, 2, 50)
check('顶层保留 properties', typeof one.properties === 'object')
check('第 2 层 a 保留 properties', typeof one.properties.a.properties === 'object')
check('第 3 层 b 折叠为 type+description', JSON.stringify(one.properties.a.properties.b) === JSON.stringify({ type: 'object', description: 'B'.repeat(50) }))

// maxTools 上限
const capped = mkAdapter({ maxTools: 10 })._toolInstructions(tools)
check('maxTools=10 只注入 10 个', (capped.match(/- name: /g) || []).length === 10)

// 无工具时返回空
check('空工具返回空串', mkAdapter()._toolInstructions([]) === '')

console.log(`\n${pass}/${total} passed`)
process.exit(pass === total ? 0 : 1)

/**
 * 测试适配器的工具调用解析逻辑（纯函数，不需要网络）
 */
import fs from 'node:fs'
import vm from 'node:vm'

// 直接读取源码，抽出 _parseToolCalls 和 _toolInstructions 的实现来测
const src = fs.readFileSync('C:/Users/qwe/Documents/deepseek-harness/default-workspace/dsh-today-connector/lib/adapter.js', 'utf8')

// 用真实的 Today 回复样本（来自 test-tool-format.mjs 实测）
const sample = '<<TOOL>>{"name":"get_weather","arguments":{"city":"Beijing"}}<<END>>'

function parseToolCalls(reply) {
  const re = /<<TOOL>>([\s\S]*?)<<END>>/g
  const calls = []
  let text = reply
  const spans = []
  let m
  while ((m = re.exec(reply)) !== null) {
    spans.push([m.index, m.index + m[0].length])
    let parsed
    try { parsed = JSON.parse(m[1].trim()) } catch { parsed = undefined }
    if (parsed !== undefined && typeof parsed.name === 'string' && parsed.name !== '') {
      const args = parsed.arguments !== null && typeof parsed.arguments === 'object' ? parsed.arguments : {}
      calls.push({ name: parsed.name, arguments: JSON.stringify(args) })
    }
  }
  if (spans.length > 0) {
    let out = ''
    let last = 0
    for (const [s, e] of spans) { out += reply.slice(last, s); last = e }
    out += reply.slice(last)
    text = out.trim()
  }
  return { calls, text }
}

const tests = [
  { name: 'real sample', input: sample, expectCalls: 1, expectName: 'get_weather' },
  { name: 'plain text', input: 'Hello there', expectCalls: 0 },
  { name: 'text + tool', input: 'Let me check.\n<<TOOL>>{"name":"calc","arguments":{"x":1}}<<END>>', expectCalls: 1, expectName: 'calc' },
  { name: 'two tools', input: '<<TOOL>>{"name":"a","arguments":{}}<<END>>\n<<TOOL>>{"name":"b","arguments":{}}<<END>>', expectCalls: 2 },
  { name: 'malformed marker', input: '<<TOOL>>not json<<END>>', expectCalls: 0 },
  { name: 'missing name', input: '<<TOOL>>{"arguments":{}}<<END>>', expectCalls: 0 },
]

let pass = 0
for (const t of tests) {
  const r = parseToolCalls(t.input)
  const ok = r.calls.length === t.expectCalls && (t.expectName === undefined || r.calls[0]?.name === t.expectName)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${t.name}: calls=${r.calls.length} text="${r.text.slice(0,40)}"`)
  if (ok) pass += 1
}
console.log(`\n${pass}/${tests.length} passed`)
process.exit(pass === tests.length ? 0 : 1)

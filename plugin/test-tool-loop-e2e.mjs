/**
 * 完整工具循环 E2E（模拟 DSH agent loop）
 * 1. 传工具定义 → 模型返回 tool-call 标记
 * 2. 解析成 tool-call 事件
 * 3. 把工具结果作为 role:tool 回灌
 * 4. 模型给出最终答案
 */
import fs from 'node:fs'

const BASE = 'C:/Users/qwe/Documents/deepseek-harness/default-workspace/base_analysis'
const cookie = fs.readFileSync(`${BASE}/session_cookie.txt`, 'utf8').trim()
const deviceId = 'web_191b4c28-bdd3-449d-b113-9758104cfd2b'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function jwt() {
  const r = await fetch('https://todayai.cn/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `__Secure-better-auth.session_token=${cookie}`, origin: 'https://todayai.cn' },
    body: JSON.stringify({ audience: 'https://api.todayai.cn', expiresIn: 3600 }),
  })
  return (await r.json()).token
}
const hdr = (t, json = true) => {
  const h = { authorization: `Bearer ${t}`, 'x-device-id': deviceId, 'x-app-version': '2.0.0', 'x-client-platform': 'web', origin: 'https://todayai.cn' }
  if (json) h['content-type'] = 'application/json'
  return h
}
const txt = (m) => (m?.body?.parts ?? []).filter((p) => p?.messageType === 'text').map((p) => p?.content?.text ?? '').join('')
function pick(items, at) {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const m = items[i]
    if (m?.role !== 'assistant') continue
    const t = txt(m)
    if (!t.trim()) continue
    const ts = Date.parse(m?.createdAt ?? '')
    if (Number.isFinite(ts) && ts < at - 2000) continue
    return t
  }
  return undefined
}

function toolInstructions(tools) {
  const lines = tools.map((t) => `- name: ${t.name}\n  description: ${t.description}\n  parameters: ${JSON.stringify(t.parameters)}`)
  return ['【可用工具】', ...lines, '',
    '调用规则：如果需要调用工具，只输出一行，格式严格如下，不要输出任何其它文字：',
    '<<TOOL>>{"name":"工具名","arguments":{参数对象}}<<END>>',
    '如果不需要工具，就正常回答。参数对象必须是合法 JSON。'].join('\n')
}
function parseToolCalls(reply) {
  const re = /<<TOOL>>([\s\S]*?)<<END>>/g
  const calls = []
  let m
  while ((m = re.exec(reply)) !== null) {
    try {
      const o = JSON.parse(m[1].trim())
      if (o.name) calls.push({ name: o.name, arguments: o.arguments ?? {} })
    } catch {}
  }
  return { calls, text: reply }
}

async function send(tok, prompt) {
  const body = { body: { parts: [{ id: crypto.randomUUID(), type: 'text', text: prompt }] }, clientMessageId: crypto.randomUUID(), isMainChat: true }
  const at = Date.now()
  const r = await fetch('https://api.todayai.cn/v1/messages', { method: 'POST', headers: hdr(tok), body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`send ${r.status} ${(await r.text()).slice(0,150)}`)
  for (let i = 0; i < 50; i += 1) {
    await sleep(2500)
    const hr = await fetch('https://api.todayai.cn/v1/conversations/messages?isMainChat=true&limit=12', { headers: hdr(tok, false) })
    const reply = pick((await hr.json())?.data?.items ?? [], at)
    if (reply !== undefined) return reply
  }
  throw new Error('TIMEOUT')
}

const tok = await jwt()
const tools = [{
  name: 'get_weather',
  description: 'Get the current weather for a city. Returns a temperature.',
  parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
}]

console.log('=== turn 1: ask with tools ===')
const r1 = await send(tok, `What is the weather in Shanghai? Use the tool.\n\n${toolInstructions(tools)}`)
console.log('reply1:', r1.slice(0, 200))

const parsed = parseToolCalls(r1)
if (parsed.calls.length === 0) {
  console.log('FAIL: model did not emit tool call')
  process.exit(1)
}
console.log('TOOL CALL:', JSON.stringify(parsed.calls[0]))

// 模拟工具执行结果
const toolResult = `{"city":"Shanghai","temperature":28,"condition":"sunny"}`
console.log('\n=== turn 2: feed tool result back ===')
const r2 = await send(tok, `The tool returned: ${toolResult}\n\nNow give the user a concise final answer about the weather in Shanghai. Do not call any tool.`)
console.log('reply2:', r2.slice(0, 300))

const ok = /shanghai|28|sunny|晴/i.test(r2)
console.log(ok ? '\n*** FULL TOOL LOOP PASS ***' : '\n*** final answer missing weather info ***')
process.exit(ok ? 0 : 2)

/**
 * 适配器端到端测试（不依赖 DSH 运行时）
 * 直接实例化 TodayAdapter，喂一个 user 消息，看是否返回预期文本。
 */
import fs from 'node:fs'

const BASE = 'C:/Users/qwe/Documents/deepseek-harness/default-workspace/base_analysis'
const cookie = fs.readFileSync(`${BASE}/session_cookie.txt`, 'utf8').trim()
const deviceId = 'web_191b4c28-bdd3-449d-b113-9758104cfd2b'

// 从插件里取纯逻辑（不引 dsh-llm，避免依赖）
const QUOTA_MARKERS = ['quota_denied', 'rate_limited', 'too_many_requests']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((b) => b && b.type === 'text').map((b) => b.text ?? '').join('')
}
function todayTextOf(msg) {
  const parts = msg?.body?.parts
  if (!Array.isArray(parts)) return ''
  return parts.filter((p) => p && p.messageType === 'text').map((p) => p?.content?.text ?? '').join('')
}
function pickReply(items, sendAtMs) {
  const list = Array.isArray(items) ? items : []
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i]
    if (m?.role !== 'assistant') continue
    const text = todayTextOf(m)
    if (text.trim() === '') continue
    const at = Date.parse(m?.createdAt ?? '')
    if (Number.isFinite(at) && at < sendAtMs - 2000) continue
    return text
  }
  return undefined
}

let token
let tokenExp = 0

async function jwt() {
  if (token && Date.now() < tokenExp - 60000) return token
  const r = await fetch('https://todayai.cn/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `__Secure-better-auth.session_token=${cookie}`, origin: 'https://todayai.cn' },
    body: JSON.stringify({ audience: 'https://api.todayai.cn', expiresIn: 3600 }),
  })
  if (!r.ok) throw new Error(`token ${r.status}`)
  const d = await r.json()
  token = d.token
  tokenExp = Date.parse(d.expiresAt)
  console.log('[test] JWT refreshed, len', token.length)
  return token
}

function hdr(t, json = true) {
  const h = { authorization: `Bearer ${t}`, 'x-device-id': deviceId, 'x-app-version': '2.0.0', 'x-client-platform': 'web', origin: 'https://todayai.cn' }
  if (json) h['content-type'] = 'application/json'
  return h
}

async function send(text) {
  const t = await jwt()
  const cmid = crypto.randomUUID()
  const body = { body: { parts: [{ id: crypto.randomUUID(), type: 'text', text }] }, clientMessageId: cmid, isMainChat: true }
  const sentAt = Date.now()
  const r = await fetch('https://api.todayai.cn/v1/messages', { method: 'POST', headers: hdr(t), body: JSON.stringify(body) })
  const raw = await r.text()
  if (!r.ok) {
    const quota = QUOTA_MARKERS.some((m) => raw.toLowerCase().includes(m))
    throw new Error(`${quota ? 'QUOTA' : 'SEND'} ${r.status} ${raw.slice(0, 200)}`)
  }
  console.log('[test] sent 202')
  return { sentAt }
}

async function history() {
  const t = await jwt()
  const r = await fetch('https://api.todayai.cn/v1/conversations/messages?isMainChat=true&limit=12', { headers: hdr(t, false) })
  if (!r.ok) throw new Error(`read ${r.status}`)
  return (await r.json())?.data?.items ?? []
}

async function ask(q, { timeoutMs = 150000, pollMs = 2500 } = {}) {
  const { sentAt } = await send(q)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(pollMs)
    const items = await history()
    const reply = pickReply(items, sentAt)
    if (reply !== undefined) return reply
  }
  throw new Error('TIMEOUT no reply')
}

// ── 跑测试 ─────────────────────────────────────────────────────────────
console.log('=== test 1: JWT refresh ===')
try {
  const t = await jwt()
  console.log('OK len', t.length)
} catch (e) { console.log('FAIL', e.message); process.exit(1) }

console.log('=== test 2: read history ===')
try {
  const items = await history()
  console.log('OK items', items.length)
} catch (e) { console.log('FAIL', e.message); process.exit(1) }

console.log('=== test 3: full round-trip ===')
try {
  const reply = await ask('Reply with exactly the word: PONG')
  console.log('REPLY:', JSON.stringify(reply.slice(0, 200)))
  const ok = reply.trim().toUpperCase().includes('PONG')
  console.log(ok ? '*** ROUND-TRIP PASS ***' : '*** ROUND-TRIP: got text but not PONG ***')
  process.exit(ok ? 0 : 2)
} catch (e) {
  console.log('FAIL', e.message)
  process.exit(3)
}

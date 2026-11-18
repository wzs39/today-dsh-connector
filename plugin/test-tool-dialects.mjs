/**
 * 多方言 tool-call 打捞测试（直接调真实适配器方法）
 * 经验来源：本机仓库 deepseek-web-bridge / diag_toolcall / arena-bridge
 */
const { TodayAdapter } = await import('@local/dsh-today-connector')
const a = new TodayAdapter({ options: () => ({}), logger: {} })

const tools = [
  { name: 'get_weather' },
  { name: 'ops_bash' },
  { name: 'workflow' },
]
const BAR = '\uFF5C\uFF5C'
const DSML_INVOKE = (name, param) =>
  `<${BAR}DSML${BAR} invoke name="${name}">` +
  `<${BAR}DSML${BAR} parameter name="city" string="true">${param}</${BAR}DSML${BAR} parameter>` +
  `</${BAR}DSML${BAR} invoke>`

const tests = [
  {
    name: 'A: marker format (my prompt)',
    input: '<<TOOL>>{"name":"get_weather","arguments":{"city":"Beijing"}}<<END>>',
    expect: [{ name: 'get_weather', city: 'Beijing' }],
    expectTextEmpty: true,
  },
  {
    name: 'B: <tool_call> JSON',
    input: '<tool_call>{"name":"ops_bash","arguments":{"command":"ls"}}</tool_call>',
    expect: [{ name: 'ops_bash', command: 'ls' }],
    expectTextEmpty: true,
  },
  {
    name: 'C: name-prefix form',
    input: '<tool_call>get_weather{"city":"Shanghai"}</tool_call>',
    expect: [{ name: 'get_weather', city: 'Shanghai' }],
    expectTextEmpty: true,
  },
  {
    name: 'D: no-arg form',
    input: '<tool_call>ops_bash</tool_call>',
    expect: [{ name: 'ops_bash' }],
    expectTextEmpty: true,
  },
  {
    name: 'E: mangled opener (observed in wild)',
    input: 'prefix <ops_bash</tool_call>',
    expect: [{ name: 'ops_bash' }],
  },
  {
    name: 'F: bare JSON',
    input: '{"name":"get_weather","arguments":{"city":"Guangzhou"}}',
    expect: [{ name: 'get_weather', city: 'Guangzhou' }],
    expectTextEmpty: true,
  },
  {
    name: 'G: DSML native invoke',
    input: DSML_INVOKE('get_weather', 'Shenzhen'),
    expect: [{ name: 'get_weather', city: 'Shenzhen' }],
    expectTextEmpty: true,
  },
  {
    name: 'whitelist: unknown tool stays text',
    input: '<<TOOL>>{"name":"evil_tool","arguments":{}}<<END>>',
    expect: [],
    expectTextContains: 'evil_tool',
  },
  {
    name: 'code fence: bare JSON not lifted',
    input: '```json\n{"name":"get_weather","arguments":{"city":"X"}}\n```',
    expect: [],
  },
  {
    name: 'text + tool + trailing prose',
    input: 'Let me check.\n<<TOOL>>{"name":"get_weather","arguments":{"city":"Hangzhou"}}<<END>>\nDone.',
    expect: [{ name: 'get_weather', city: 'Hangzhou' }],
    expectTextContains: 'Let me check.',
  },
  {
    name: 'duplicate calls deduped (extra marker kept as text)',
    input: '<<TOOL>>{"name":"get_weather","arguments":{"city":"X"}}<<END>>\n<<TOOL>>{"name":"get_weather","arguments":{"city":"X"}}<<END>>',
    expect: [{ name: 'get_weather', city: 'X' }],
    expectTextContains: '<<TOOL>>', // 未提升的重复标记保留，避免吞内容
  },
  {
    name: 'malformed JSON stays text',
    input: '<<TOOL>>not json<<END>>',
    expect: [],
    expectTextContains: 'not json',
  },
]

let pass = 0
for (const t of tests) {
  const r = a._parseToolCalls(t.input, tools)
  let ok = r.calls.length === t.expect.length
  if (ok) {
    for (let i = 0; i < t.expect.length; i += 1) {
      const got = JSON.parse(r.calls[i].arguments)
      const want = t.expect[i]
      if (r.calls[i].name !== want.name) ok = false
      for (const [k, v] of Object.entries(want)) {
        if (k === 'name') continue
        if (got[k] !== v) ok = false
      }
    }
  }
  if (ok && t.expectTextEmpty === true && r.text !== '') ok = false
  if (ok && t.expectTextContains !== undefined && !r.text.includes(t.expectTextContains)) ok = false
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${t.name}  calls=${r.calls.length} text="${r.text.slice(0, 50)}"`)
  if (ok) pass += 1
}
console.log(`\n${pass}/${tests.length} passed`)
process.exit(pass === tests.length ? 0 : 1)

import crypto from 'node:crypto';
import { TODAY_DESKTOP_VERSION } from './version.js';
export function getConnectorClientPlatform() {
    if (process.platform === 'darwin')
        return 'macos';
    if (process.platform === 'win32')
        return 'windows';
    return 'linux';
}
export function getConnectorClientType() {
    if (process.platform === 'darwin')
        return 'macos-connector';
    if (process.platform === 'win32')
        return 'windows-connector';
    return 'linux-connector';
}
const CANNED_GATEWAY_ERROR_PATTERNS = [
    /^抱歉，暂时无法完成这次请求，请稍后重试[。.]?$/u,
    /^抱歉，服务暂时不可用，请稍后重试[。.]?$/u,
    /^Sorry,\s*I\s*(?:cannot|can't|couldn't)\s*complete\s*this\s*request\s*right\s*now\.\s*Please\s*try\s*again\s*later\.?$/iu,
];
export function isUpstreamGatewayFallbackReply(text) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 160) {
        return false;
    }
    return CANNED_GATEWAY_ERROR_PATTERNS.some((re) => re.test(trimmed));
}
function renderQaCardBodyToMarkdown(rawBody) {
    if (!rawBody || typeof rawBody !== 'object') {
        return '';
    }
    const body = rawBody;
    const lines = [];
    // 1. Legacy single/multi select: { prompt, options: [{ id, label }], others_field }
    if (typeof body.prompt === 'string' && Array.isArray(body.options)) {
        lines.push(body.prompt.trim());
        for (const opt of body.options) {
            if (opt && typeof opt === 'object') {
                const o = opt;
                const label = typeof o.label === 'string' ? o.label.trim() : '';
                const desc = typeof o.description === 'string' && o.description.trim() ? ` — ${o.description.trim()}` : '';
                if (label) {
                    lines.push(`- ${label}${desc}`);
                }
            }
        }
        return lines.filter(Boolean).join('\n');
    }
    // 2. Multi-page card: { pages: [{ prompt, options, fields }] }
    if (Array.isArray(body.pages)) {
        for (let i = 0; i < body.pages.length; i += 1) {
            const page = body.pages[i];
            if (!page || typeof page !== 'object')
                continue;
            const p = page;
            const prompt = typeof p.prompt === 'string' ? p.prompt.trim() : '';
            if (prompt) {
                lines.push(body.pages.length > 1 ? `${i + 1}. **${prompt}**` : `**${prompt}**`);
            }
            if (Array.isArray(p.options)) {
                for (const opt of p.options) {
                    if (opt && typeof opt === 'object') {
                        const label = typeof opt.label === 'string'
                            ? String(opt.label).trim()
                            : '';
                        if (label) {
                            lines.push(`   - ${label}`);
                        }
                    }
                }
            }
            if (Array.isArray(p.fields)) {
                for (const fld of p.fields) {
                    if (fld && typeof fld === 'object') {
                        const f = fld;
                        const label = typeof f.label === 'string' ? f.label.trim() : '';
                        const def = typeof f.default === 'string' ? ` (默认: ${f.default})` : '';
                        if (label) {
                            lines.push(`   - ${label}${def}`);
                        }
                    }
                }
            }
        }
        return lines.filter(Boolean).join('\n');
    }
    // 3. Cardflow single: { entry_card_id, cards: [{ card_id, prompt, options }] }
    if (Array.isArray(body.cards) && body.cards.length > 0) {
        const entryId = typeof body.entry_card_id === 'string' ? body.entry_card_id : '';
        const orderedCards = entryId
            ? [
                ...body.cards.filter((c) => c && typeof c === 'object' && c.card_id === entryId),
                ...body.cards.filter((c) => c && typeof c === 'object' && c.card_id !== entryId),
            ]
            : body.cards;
        for (let i = 0; i < orderedCards.length; i += 1) {
            const card = orderedCards[i];
            if (!card || typeof card !== 'object')
                continue;
            const c = card;
            const prompt = typeof c.prompt === 'string' ? c.prompt.trim() : '';
            if (prompt) {
                lines.push(orderedCards.length > 1 ? `${i + 1}. **${prompt}**` : `**${prompt}**`);
            }
            if (Array.isArray(c.options)) {
                for (const opt of c.options) {
                    if (opt && typeof opt === 'object') {
                        const o = opt;
                        const label = typeof o.label === 'string' ? o.label.trim() : '';
                        const desc = typeof o.description === 'string' && o.description.trim()
                            ? ` — ${o.description.trim()}`
                            : '';
                        if (label) {
                            lines.push(`   - ${label}${desc}`);
                        }
                    }
                }
            }
        }
        return lines.filter(Boolean).join('\n');
    }
    return '';
}
function renderMessagePartToText(part) {
    const msgType = String(part.messageType ?? part.type ?? '');
    const content = part.content && typeof part.content === 'object'
        ? part.content
        : part;
    if (msgType === 'text') {
        if (typeof content.text === 'string')
            return content.text;
        if (typeof part.text === 'string') {
            return String(part.text);
        }
        return '';
    }
    // Proprietary Today QA interactive cards -> convert cleanly to readable Markdown!
    if (msgType === 'qa_single_select' ||
        msgType === 'qa_multi_select' ||
        msgType === 'qa_multi_page' ||
        msgType === 'qa_cardflow_single' ||
        msgType === 'qa_connector_auth') {
        const innerContent = content.content && typeof content.content === 'object'
            ? content.content
            : content;
        const cardBody = innerContent.body ?? content.body ?? content;
        return renderQaCardBodyToMarkdown(cardBody);
    }
    if (msgType === 'brief_card') {
        const title = typeof content.title === 'string' ? content.title.trim() : '';
        const desc = typeof content.description === 'string' ? content.description.trim() : '';
        return [title ? `**${title}**` : '', desc].filter(Boolean).join('\n');
    }
    if (typeof content.text === 'string' && content.text.trim()) {
        return content.text;
    }
    return '';
}
export class TodayUpstreamClient {
    config;
    credentials;
    activeModelOptionId = null;
    lastSyncedToolCatalogHash = null;
    fetchImpl;
    constructor(config, credentials, options) {
        this.config = config;
        this.credentials = credentials;
        this.fetchImpl = options?.fetch ?? globalThis.fetch.bind(globalThis);
    }
    async buildHeaders(extra = {}) {
        const token = await this.credentials.getValidAccessToken();
        return {
            'Accept': 'application/json',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Content-Type': 'application/json',
            'X-App-Version': TODAY_DESKTOP_VERSION,
            'X-Client-Platform': process.platform === 'darwin' ? 'mac-client' : 'windows-client',
            'Origin': this.config.webOrigin,
            'Authorization': `Bearer ${token}`,
            ...extra,
        };
    }
    async fetchWithAuth(url, initBuilder, extraHeaders = {}, signal) {
        const headers = await this.buildHeaders(extraHeaders);
        const resp = await this.fetchImpl(url, { ...initBuilder(headers), ...(signal ? { signal } : {}) });
        if (resp.status !== 401) {
            return resp;
        }
        await this.credentials.getValidAccessToken(true);
        const retryHeaders = await this.buildHeaders(extraHeaders);
        return this.fetchImpl(url, { ...initBuilder(retryHeaders), ...(signal ? { signal } : {}) });
    }
    async getPricingStatus(signal) {
        const resp = await this.fetchWithAuth(`${this.config.apiBaseUrl}/v1/pricing/status`, (headers) => ({ method: 'GET', headers }), {}, signal);
        if (!resp.ok) {
            throw new Error(`GET /v1/pricing/status failed: HTTP ${resp.status}`);
        }
        const json = (await resp.json());
        const status = json?.data?.status;
        if (!status) {
            throw new Error('Malformed /v1/pricing/status response');
        }
        this.activeModelOptionId = status.modelOptions?.selectedOptionId ?? null;
        return status;
    }
    async selectModelOption(optionId, signal) {
        if (this.activeModelOptionId === optionId) {
            return;
        }
        const resp = await this.fetchWithAuth(`${this.config.apiBaseUrl}/v1/pricing/model-option`, (headers) => ({
            method: 'PUT',
            headers,
            body: JSON.stringify({ optionId }),
        }), {}, signal);
        if (!resp.ok) {
            throw new Error(`PUT /v1/pricing/model-option (${optionId}) failed: HTTP ${resp.status}`);
        }
        this.activeModelOptionId = optionId;
    }
    async getLlmModels(signal) {
        const resp = await this.fetchWithAuth(`${this.config.apiBaseUrl}/v1/llm/models`, (headers) => ({ method: 'GET', headers }), {}, signal);
        if (!resp.ok) {
            throw new Error(`GET /v1/llm/models failed: HTTP ${resp.status}`);
        }
        const data = (await resp.json());
        return (data.models ?? []).map((m) => m.modelId);
    }
    async createV3Conversation(signal) {
        const idempotencyKey = crypto.randomUUID();
        const resp = await this.fetchWithAuth(`${this.config.apiBaseUrl}/v3/conversations`, (headers) => ({ method: 'POST', headers }), { 'Idempotency-Key': idempotencyKey }, signal);
        if (!resp.ok) {
            throw new Error(`POST /v3/conversations failed: HTTP ${resp.status}`);
        }
        const json = (await resp.json());
        const conversationId = json?.data?.conversation?.conversationId;
        if (!conversationId) {
            throw new Error('POST /v3/conversations did not return conversationId');
        }
        return conversationId;
    }
    async sendV3Message(params, signal) {
        const clientMessageId = params.clientMessageId ?? crypto.randomUUID();
        const bodyStr = JSON.stringify({
            ...(params.conversationId ? { conversationId: params.conversationId } : {}),
            clientMessageId,
            bodyType: 'text',
            body: { text: params.text },
        });
        const resp = await this.fetchWithAuth(`${this.config.apiBaseUrl}/v3/messages`, (headers) => ({
            method: 'POST',
            headers,
            body: bodyStr,
        }), {}, signal);
        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`POST /v3/messages failed: HTTP ${resp.status} ${errText}`);
        }
        const json = (await resp.json());
        const msg = json?.data?.message;
        if (!msg) {
            throw new Error('Malformed POST /v3/messages response');
        }
        return { ...msg, clientMessageId };
    }
    invalidateDeviceToolSyncCache() {
        this.lastSyncedToolCatalogHash = null;
    }
    /**
     * Read the durable tail of a V3 conversation. Used as a REST fallback when the
     * WebSocket `chat.message_ready.v2` push is delayed or routed to another
     * connection of the same account.
     */
    async listV3Messages(conversationId, limit = 20, signal) {
        const resp = await this.fetchWithAuth(`${this.config.apiBaseUrl}/v3/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`, (headers) => ({ method: 'GET', headers }), {}, signal);
        if (!resp.ok) {
            throw new Error(`GET /v3/conversations/${conversationId}/messages failed: HTTP ${resp.status}`);
        }
        const json = (await resp.json());
        return Array.isArray(json?.data?.items) ? json.data.items : [];
    }
    async syncDeviceTools(deviceId, tools, signal) {
        const hashPayload = JSON.stringify({
            deviceId,
            tools: tools.map((t) => ({
                capabilityId: t.capabilityId,
                description: t.description,
                enabled: t.enabled,
                inputSchema: t.inputSchema,
            })),
        });
        const catalogHash = crypto.createHash('sha256').update(hashPayload).digest('hex');
        if (this.lastSyncedToolCatalogHash === catalogHash) {
            return;
        }
        const bodyStr = JSON.stringify({
            tools,
            connectorSnapshot: {
                connectors: [],
                timestamp: new Date().toISOString(),
            },
        });
        const resp = await this.fetchWithAuth(`${this.config.apiBaseUrl}/registry/devices/${encodeURIComponent(deviceId)}/tools`, (headers) => ({
            method: 'PUT',
            headers,
            body: bodyStr,
        }), {
            'X-Client-Platform': getConnectorClientPlatform(),
            'X-Device-Id': deviceId,
        }, signal);
        if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            throw new Error(`PUT /registry/devices/${deviceId}/tools failed: HTTP ${resp.status} ${errText}`);
        }
        this.lastSyncedToolCatalogHash = catalogHash;
    }
    static extractTextFromCanonicalMessage(message) {
        const rawBody = message.body;
        // Support both canonical WebSocket snapshot (`body.parts`) and REST history (`body.content.parts`)
        const parts = Array.isArray(rawBody?.parts)
            ? rawBody.parts
            : rawBody?.content &&
                typeof rawBody.content === 'object' &&
                Array.isArray(rawBody.content.parts)
                ? rawBody.content.parts
                : [];
        const texts = [];
        for (const part of parts) {
            const rendered = renderMessagePartToText(part);
            if (rendered) {
                texts.push(rendered);
            }
        }
        return texts.join('\n\n');
    }
}

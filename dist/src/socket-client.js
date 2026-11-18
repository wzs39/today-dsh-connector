import crypto from 'node:crypto';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { TODAY_DESKTOP_VERSION } from './version.js';
import { getConnectorClientPlatform, getConnectorClientType, TodayUpstreamClient, } from './api-client.js';
/**
 * Intentionally omit all proprietary Today UI card capabilities (`chat.qa_*`,
 * `chat.brief_card.v1`, `chat.automation_card.v1`, `chat.connector_auth_card.v1`)
 * so the upstream agent replies in standard Markdown text or invokes DSH tools.
 */
const CLIENT_CAPABILITIES = 'pricing.cn_usage_locked_recovery.v1';
const INVOCATION_PROGRESS_INTERVAL_MS = 15_000;
const INVOCATION_MAX_TIMEOUT_MS = 300_000;
const INVOCATION_DEFAULT_TIMEOUT_MS = 120_000;
function isTransientAckOrReaction(text) {
    const trimmed = text.trim();
    if (!trimmed)
        return true;
    return /^(?:👍|👌|⏳|🔍|🙏|🤝|收到|好的，稍等)+$/u.test(trimmed);
}
function isInternalLogicalActivityMessage(message) {
    if (typeof message.id === 'string' && message.id.startsWith('msg_logical_')) {
        return true;
    }
    if (message.bodyType === 'today.agent-work.tool-activity.v1') {
        return true;
    }
    return false;
}
function deriveDeterministicMachineId(region) {
    let seed = `dsh-today:${region}:${os.hostname()}`;
    try {
        seed += `:${os.userInfo().username}`;
    }
    catch {
        // Ignore environments where os.userInfo() is restricted
    }
    const hash = crypto.createHash('sha256').update(seed).digest('hex');
    return [
        hash.slice(0, 8),
        hash.slice(8, 12),
        `4${hash.slice(13, 16)}`,
        `8${hash.slice(17, 20)}`,
        hash.slice(20, 32),
    ].join('-');
}
export class TodaySocketStream extends EventEmitter {
    api;
    ws = null;
    clientMachineId;
    registeredDeviceId = null;
    connectedPromise = null;
    heartbeatTimer = null;
    emittedLengths = new Map();
    emittedReasoningLengths = new Map();
    turnMessageOrder = new Map();
    pendingInvocations = new Map();
    WebSocketImpl;
    constructor(api, options) {
        super();
        this.api = api;
        this.clientMachineId =
            options?.clientMachineId ?? deriveDeterministicMachineId(api.config.region);
        this.WebSocketImpl = options?.WebSocket ?? globalThis.WebSocket;
    }
    get serverDeviceId() {
        return this.registeredDeviceId;
    }
    get isConnected() {
        return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
    }
    async buildSocketRestHeaders(json = false, deviceIdOverride) {
        const token = await this.api.credentials.getValidAccessToken();
        return {
            'Accept': 'application/json',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Authorization': `Bearer ${token}`,
            'Origin': this.api.config.webOrigin,
            'X-App-Version': TODAY_DESKTOP_VERSION,
            'X-Client-Capabilities': CLIENT_CAPABILITIES,
            'X-Client-Platform': getConnectorClientPlatform(),
            'X-Device-Id': deviceIdOverride ?? this.registeredDeviceId ?? this.clientMachineId,
            ...(json ? { 'Content-Type': 'application/json' } : {}),
        };
    }
    async ensureRegisteredDevice() {
        if (this.registeredDeviceId) {
            return this.registeredDeviceId;
        }
        const fetchFn = this.api.credentials.fetchFn;
        let headers = await this.buildSocketRestHeaders(true, this.clientMachineId);
        let resp = await fetchFn(`${this.api.config.apiBaseUrl}/registry/devices`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                name: `DSH Host Bridge (${this.api.config.region.toUpperCase()})`,
                clientPlatform: getConnectorClientPlatform(),
                clientType: getConnectorClientType(),
                platform: process.platform,
                version: TODAY_DESKTOP_VERSION,
                notificationEnabled: false,
                clientMachineId: this.clientMachineId,
            }),
        });
        if (resp.status === 401) {
            await this.api.credentials.getValidAccessToken(true);
            headers = await this.buildSocketRestHeaders(true, this.clientMachineId);
            resp = await fetchFn(`${this.api.config.apiBaseUrl}/registry/devices`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    name: `DSH Host Bridge (${this.api.config.region.toUpperCase()})`,
                    clientPlatform: getConnectorClientPlatform(),
                    clientType: getConnectorClientType(),
                    platform: process.platform,
                    version: TODAY_DESKTOP_VERSION,
                    notificationEnabled: false,
                    clientMachineId: this.clientMachineId,
                }),
            });
        }
        if (!resp.ok) {
            throw new Error(`POST /registry/devices failed: HTTP ${resp.status}`);
        }
        const data = (await resp.json());
        if (!data.device?.id) {
            throw new Error('Device registration did not return device.id');
        }
        this.registeredDeviceId = data.device.id;
        return this.registeredDeviceId;
    }
    async issueTicket(serverDeviceId) {
        const fetchFn = this.api.credentials.fetchFn;
        let headers = await this.buildSocketRestHeaders(false, serverDeviceId);
        let resp = await fetchFn(`${this.api.config.apiBaseUrl}/ws-ticket`, {
            method: 'POST',
            headers,
        });
        if (resp.status === 401) {
            await this.api.credentials.getValidAccessToken(true);
            headers = await this.buildSocketRestHeaders(false, serverDeviceId);
            resp = await fetchFn(`${this.api.config.apiBaseUrl}/ws-ticket`, {
                method: 'POST',
                headers,
            });
        }
        if (!resp.ok) {
            throw new Error(`POST /ws-ticket failed: HTTP ${resp.status}`);
        }
        const data = (await resp.json());
        if (!data.ticket) {
            throw new Error('Missing ticket in /ws-ticket response');
        }
        const webSocketUrl = resp.headers.get('x-websocket-url')?.trim();
        return { ticket: data.ticket, ...(webSocketUrl ? { webSocketUrl } : {}) };
    }
    async ensureConnected() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return;
        }
        if (this.connectedPromise) {
            return this.connectedPromise;
        }
        this.connectedPromise = (async () => {
            const serverDeviceId = await this.ensureRegisteredDevice();
            const { ticket, webSocketUrl } = await this.issueTicket(serverDeviceId);
            const wsBase = this.api.config.apiBaseUrl.replace(/^http/, 'ws');
            const url = webSocketUrl || `${wsBase}/ws?ticket=${encodeURIComponent(ticket)}`;
            await new Promise((resolve, reject) => {
                const ws = new this.WebSocketImpl(url);
                this.ws = ws;
                let settled = false;
                const timeout = setTimeout(() => {
                    if (settled)
                        return;
                    settled = true;
                    try {
                        ws.close();
                    }
                    catch {
                        // ignore
                    }
                    reject(new Error('Today WebSocket handshake timeout (15s)'));
                }, 15_000);
                ws.addEventListener('open', () => {
                    this.sendFrame({
                        type: 'device.hello',
                        deviceId: serverDeviceId,
                        tools: [],
                        messageProtocolVersion: 'canonical-v1',
                    });
                });
                ws.addEventListener('message', (ev) => {
                    try {
                        const msg = JSON.parse(String(ev.data));
                        if (typeof msg.seq === 'number' && typeof msg.id === 'string') {
                            this.sendFrame({
                                type: 'client.received',
                                originId: msg.id,
                                originType: msg.type,
                                originSeq: msg.seq,
                                originTimestamp: msg.timestamp,
                            });
                        }
                        if (msg.type === 'cloud.hello_ack') {
                            clearTimeout(timeout);
                            this.api.invalidateDeviceToolSyncCache();
                            const hbMs = typeof msg.heartbeatIntervalMs === 'number' &&
                                msg.heartbeatIntervalMs >= 5_000 &&
                                msg.heartbeatIntervalMs <= 60_000
                                ? Math.max(5_000, msg.heartbeatIntervalMs - 5_000)
                                : 25_000;
                            this.startHeartbeat(serverDeviceId, hbMs);
                            if (!settled) {
                                settled = true;
                                resolve();
                            }
                            return;
                        }
                        if (msg.type === 'event.push') {
                            this.handleEventPush(msg);
                        }
                        else if (msg.type === 'invocation.request') {
                            this.handleInvocationRequest(msg);
                        }
                        else if (msg.type === 'invocation.cancel') {
                            const invId = typeof msg.invocationId === 'string' ? msg.invocationId.trim() : '';
                            if (invId) {
                                this.clearPendingInvocation(invId);
                            }
                        }
                    }
                    catch {
                        // Ignore malformed socket frame
                    }
                });
                ws.addEventListener('error', (err) => {
                    clearTimeout(timeout);
                    if (!settled) {
                        settled = true;
                        reject(new Error(`Today WebSocket error: ${String(err)}`));
                    }
                });
                ws.addEventListener('close', () => {
                    clearTimeout(timeout);
                    if (this.heartbeatTimer) {
                        clearInterval(this.heartbeatTimer);
                        this.heartbeatTimer = null;
                    }
                    this.clearAllPendingInvocations();
                    if (this.ws === ws) {
                        this.ws = null;
                    }
                    this.connectedPromise = null;
                    this.emit('disconnected');
                    if (!settled) {
                        settled = true;
                        reject(new Error('Today WebSocket closed during handshake'));
                    }
                });
            });
        })();
        try {
            await this.connectedPromise;
        }
        finally {
            this.connectedPromise = null;
        }
    }
    startHeartbeat(serverDeviceId, intervalMs = 25_000) {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }
        this.heartbeatTimer = setInterval(() => {
            this.sendFrame({ type: 'device.heartbeat', deviceId: serverDeviceId });
        }, intervalMs);
        this.heartbeatTimer.unref?.();
    }
    sendFrame(payload) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return false;
        }
        this.ws.send(JSON.stringify({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            ...payload,
        }));
        return true;
    }
    handleInvocationRequest(frame) {
        const invocationId = typeof frame.invocationId === 'string' ? frame.invocationId.trim() : '';
        const capabilityId = typeof frame.capabilityId === 'string' ? frame.capabilityId.trim() : '';
        if (!invocationId || !capabilityId) {
            return;
        }
        const rawArgs = frame.args;
        const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
            ? rawArgs
            : {};
        const timeoutMs = typeof frame.timeoutMs === 'number' && Number.isFinite(frame.timeoutMs)
            ? Math.min(INVOCATION_MAX_TIMEOUT_MS, Math.max(5_000, frame.timeoutMs))
            : INVOCATION_DEFAULT_TIMEOUT_MS;
        // Immediately ACK receipt and start progress heartbeats so cloud-service keeps the thread open
        this.sendFrame({
            type: 'invocation.ack',
            invocationId,
        });
        const deadlineAt = Date.now() + timeoutMs - Math.min(2_000, Math.floor(timeoutMs / 10));
        this.clearPendingInvocation(invocationId);
        const progressTimer = setInterval(() => {
            if (Date.now() >= deadlineAt || !this.isConnected) {
                return;
            }
            this.sendFrame({
                type: 'invocation.progress',
                invocationId,
                progress: 0,
            });
        }, INVOCATION_PROGRESS_INTERVAL_MS);
        progressTimer.unref?.();
        const deadlineTimer = setTimeout(() => {
            const tracked = this.pendingInvocations.get(invocationId);
            if (!tracked)
                return;
            this.clearPendingInvocation(invocationId);
            this.sendFrame({
                type: 'invocation.result',
                invocationId,
                success: false,
                error: {
                    code: 'TIMEOUT',
                    message: 'Local DSH tool execution exceeded single-invocation wait window.',
                },
            });
        }, Math.max(1_000, deadlineAt - Date.now()));
        deadlineTimer.unref?.();
        const request = {
            invocationId,
            capabilityId,
            args,
            timeoutMs,
        };
        this.pendingInvocations.set(invocationId, {
            request,
            deadlineAt,
            progressTimer,
            deadlineTimer,
        });
        this.emit('invocation_request', request);
    }
    hasPendingInvocation(invocationId) {
        const tracked = this.pendingInvocations.get(invocationId);
        if (!tracked)
            return false;
        if (Date.now() >= tracked.deadlineAt || !this.isConnected) {
            this.clearPendingInvocation(invocationId);
            return false;
        }
        return true;
    }
    completeInvocation(result) {
        const tracked = this.pendingInvocations.get(result.invocationId);
        if (!tracked) {
            return false;
        }
        const expired = Date.now() >= tracked.deadlineAt;
        this.clearPendingInvocation(result.invocationId);
        if (expired || !this.isConnected) {
            return false;
        }
        return this.sendFrame({
            type: 'invocation.result',
            ...result,
        });
    }
    clearPendingInvocation(invocationId) {
        const tracked = this.pendingInvocations.get(invocationId);
        if (!tracked)
            return;
        clearInterval(tracked.progressTimer);
        clearTimeout(tracked.deadlineTimer);
        this.pendingInvocations.delete(invocationId);
    }
    clearAllPendingInvocations() {
        for (const invId of this.pendingInvocations.keys()) {
            this.clearPendingInvocation(invId);
        }
    }
    handleEventPush(frame) {
        const payload = (frame.payload ?? frame);
        const eventName = (payload.event ?? frame.eventType);
        const data = (payload.data ?? {});
        if (eventName === 'thread.token') {
            const delta = typeof data.delta === 'string' ? data.delta : '';
            if (delta) {
                this.emit('token', {
                    conversationId: String(data.conversationId ?? ''),
                    threadId: String(data.threadId ?? ''),
                    messageId: typeof data.messageId === 'string' ? data.messageId : undefined,
                    delta,
                });
            }
            return;
        }
        if (eventName === 'thread.failed') {
            this.emit('failed', {
                conversationId: String(data.conversationId ?? ''),
                threadId: String(data.threadId ?? ''),
                error: typeof data.error === 'string' ? data.error : 'Today upstream thread failed',
                failureType: typeof data.failureType === 'string' ? data.failureType : 'SERVER',
            });
            return;
        }
        if (eventName === 'thread.completed') {
            const respText = typeof data.response === 'string' ? data.response : '';
            this.emit('completed', {
                conversationId: String(data.conversationId ?? ''),
                threadId: String(data.threadId ?? ''),
                fullText: respText,
            });
            return;
        }
        if (eventName === 'chat.presentation.updated.v1') {
            const convId = String(data.conversationId ?? '');
            this.emit('activity', {
                conversationId: convId,
                threadId: '',
            });
            const working = data.working;
            const current = working?.current;
            const turn = current?.turn;
            const content = turn?.content;
            if (content?.presentation === 'thinking' && Array.isArray(content.text)) {
                const fullReasoning = content.text
                    .filter((x) => typeof x === 'string')
                    .join('\n');
                const speechId = typeof current?.speechId === 'string' ? current.speechId : 'default';
                const speechKey = `${convId}:${speechId}`;
                const prevLen = this.emittedReasoningLengths.get(speechKey) ?? 0;
                if (fullReasoning.length > prevLen) {
                    const delta = fullReasoning.slice(prevLen);
                    this.emittedReasoningLengths.set(speechKey, fullReasoning.length);
                    this.emit('reasoning', {
                        conversationId: convId,
                        threadId: '',
                        delta,
                    });
                }
            }
            return;
        }
        if (eventName === 'chat.message_updated.v2' || eventName === 'chat.message_ready.v2') {
            const message = data.message;
            if (!message) {
                return;
            }
            // Internal tool-progress messages (`msg_logical_...` or `role: 'tool'`) signal liveness only
            if (message.role !== 'assistant' || isInternalLogicalActivityMessage(message)) {
                this.emit('activity', {
                    conversationId: message.conversationId,
                    threadId: message.threadId,
                    originMessageId: message.originMessageId,
                });
                return;
            }
            const fullText = TodayUpstreamClient.extractTextFromCanonicalMessage(message);
            if (isTransientAckOrReaction(fullText)) {
                this.emit('activity', {
                    conversationId: message.conversationId,
                    threadId: message.threadId,
                    originMessageId: message.originMessageId,
                });
                return;
            }
            // Separate distinct assistant bubbles within the same thread cleanly with `\n\n`
            const turnKey = message.threadId || message.originMessageId || message.conversationId;
            let seenBubbles = this.turnMessageOrder.get(turnKey);
            let prefixSeparator = '';
            if (!seenBubbles) {
                seenBubbles = [message.id];
                this.turnMessageOrder.set(turnKey, seenBubbles);
            }
            else if (!seenBubbles.includes(message.id)) {
                seenBubbles.push(message.id);
                prefixSeparator = '\n\n';
            }
            const prevLen = this.emittedLengths.get(message.id) ?? 0;
            if (fullText.length > prevLen) {
                const rawDelta = fullText.slice(prevLen);
                const delta = prevLen === 0 && prefixSeparator ? `${prefixSeparator}${rawDelta}` : rawDelta;
                this.emittedLengths.set(message.id, fullText.length);
                this.emit('token', {
                    conversationId: message.conversationId,
                    threadId: message.threadId,
                    messageId: message.id,
                    originMessageId: message.originMessageId,
                    delta,
                });
            }
            // CRITICAL: Only emit `completed` when `message.isFinal === true`!
            // Intermediate bubbles have `isFinal === false` even when `eventName === 'chat.message_ready.v2'`.
            if (message.isFinal === true) {
                this.emittedLengths.delete(message.id);
                this.turnMessageOrder.delete(turnKey);
                for (const k of this.emittedReasoningLengths.keys()) {
                    if (k.startsWith(`${message.conversationId}:`)) {
                        this.emittedReasoningLengths.delete(k);
                    }
                }
                this.emit('completed', {
                    conversationId: message.conversationId,
                    threadId: message.threadId,
                    messageId: message.id,
                    originMessageId: message.originMessageId,
                    fullText,
                });
            }
        }
    }
    close() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        this.emittedReasoningLengths.clear();
        this.clearAllPendingInvocations();
        if (this.ws) {
            try {
                this.ws.close();
            }
            catch {
                // ignore
            }
            this.ws = null;
        }
        this.connectedPromise = null;
    }
}

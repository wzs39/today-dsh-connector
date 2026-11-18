import type { TodayCredentialStore } from './credentials.js';
import type { CanonicalMessageSnapshot, TodayDeviceToolSpec, TodayPricingStatus, TodayRegionConfig } from './types.js';
export declare function getConnectorClientPlatform(): 'macos' | 'windows' | 'linux';
export declare function getConnectorClientType(): 'macos-connector' | 'windows-connector' | 'linux-connector';
export declare function isUpstreamGatewayFallbackReply(text: string): boolean;
export declare class TodayUpstreamClient {
    readonly config: TodayRegionConfig;
    readonly credentials: TodayCredentialStore;
    private activeModelOptionId;
    private lastSyncedToolCatalogHash;
    private readonly fetchImpl;
    constructor(config: TodayRegionConfig, credentials: TodayCredentialStore, options?: {
        fetch?: typeof fetch;
    });
    buildHeaders(extra?: Record<string, string>): Promise<Record<string, string>>;
    private fetchWithAuth;
    getPricingStatus(signal?: AbortSignal): Promise<TodayPricingStatus>;
    selectModelOption(optionId: string, signal?: AbortSignal): Promise<void>;
    getLlmModels(signal?: AbortSignal): Promise<string[]>;
    createV3Conversation(signal?: AbortSignal): Promise<string>;
    sendV3Message(params: {
        conversationId?: string;
        text: string;
        clientMessageId?: string;
    }, signal?: AbortSignal): Promise<{
        messageId: string;
        conversationId: string;
        threadId: string;
        sequence: number;
        clientMessageId: string;
    }>;
    invalidateDeviceToolSyncCache(): void;
    /**
     * Read the durable tail of a V3 conversation. Used as a REST fallback when the
     * WebSocket `chat.message_ready.v2` push is delayed or routed to another
     * connection of the same account.
     */
    listV3Messages(conversationId: string, limit?: number, signal?: AbortSignal): Promise<CanonicalMessageSnapshot[]>;
    syncDeviceTools(deviceId: string, tools: TodayDeviceToolSpec[], signal?: AbortSignal): Promise<void>;
    static extractTextFromCanonicalMessage(message: CanonicalMessageSnapshot): string;
}

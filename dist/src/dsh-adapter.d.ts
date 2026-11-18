import { TodayUpstreamClient } from './api-client.js';
import { TodaySocketStream } from './socket-client.js';
import type { CanonicalMessageSnapshot, OpenAIChatMessage, OpenAIToolDefinition, TodayCatalogModel } from './types.js';
export interface DshContentBlock {
    type?: string;
    text?: string;
    id?: string;
    name?: string;
    arguments?: string;
    toolCallId?: string;
    content?: string | DshContentBlock[];
    isError?: boolean;
    source?: {
        type?: string;
        media_type?: string;
        data?: string;
        url?: string;
    };
    image?: string;
    url?: string;
}
export interface DshHarnessMessage {
    role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
    content: string | DshContentBlock[];
    toolCallId?: string;
    source?: {
        kind?: string;
        callId?: string;
    };
    isError?: boolean;
}
export interface DshHarnessTool {
    name?: string;
    description?: string;
    parameters?: Record<string, unknown>;
    type?: 'function';
    function?: {
        name: string;
        description?: string;
        parameters?: Record<string, unknown>;
    };
}
export interface DshStreamOptions {
    provider: string;
    model: string;
    messages: DshHarnessMessage[];
    system?: string;
    systemPrompt?: string;
    tools?: DshHarnessTool[];
    toolChoice?: 'none' | 'auto' | 'required' | {
        type: 'function';
        function: {
            name: string;
        };
    };
    signal?: AbortSignal;
    sessionId?: string;
    reasoningEffort?: string;
}
export type DshStreamChunk = {
    type: 'block-start';
    index: number;
    blockType: 'text' | 'reasoning' | 'tool-call';
} | {
    type: 'text-delta';
    index: number;
    text: string;
} | {
    type: 'reasoning-delta';
    index: number;
    text: string;
} | {
    type: 'tool-call-delta';
    index: number;
    id: string;
    name?: string;
    argumentsDelta: string;
} | {
    type: 'block-end';
    index: number;
    block: {
        type: 'text';
        text: string;
    } | {
        type: 'reasoning';
        text: string;
    } | {
        type: 'tool-call';
        id: string;
        name: string;
        arguments: string;
    };
} | {
    type: 'usage';
    usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        reasoningTokens?: number;
    };
} | {
    type: 'finish';
    reason: {
        kind: 'stop' | 'tool-calls' | 'max-tokens';
    } | {
        kind: 'aborted' | 'error';
        failure: {
            message: string;
            code: string;
        };
    };
};
export interface ProjectedChatMessage extends OpenAIChatMessage {
    isError?: boolean;
}
/**
 * Pick the newest final assistant reply for the active turn from a REST history page,
 * skipping internal tool-activity banners and replies that were already delivered.
 */
export declare function pickFinalAssistantFromHistory(items: readonly CanonicalMessageSnapshot[], turn: {
    threadId: string | null;
    originMessageId: string | null;
}, delivered: ReadonlySet<string>): {
    id: string;
    text: string;
} | null;
export declare function estimateMessagesTokens(messages: readonly OpenAIChatMessage[], tools?: OpenAIToolDefinition[], systemText?: string): number;
export declare function projectHarnessMessages(messages: DshHarnessMessage[], systemPrompt?: string): ProjectedChatMessage[];
export declare function projectHarnessTools(tools?: DshHarnessTool[]): OpenAIToolDefinition[];
export interface TodayAdapterOptions {
    responseTimeoutMs?: number;
    enableNativeDeviceTools?: boolean;
    socketStream?: TodaySocketStream;
}
export declare class TodayDshAdapter {
    readonly api: TodayUpstreamClient;
    readonly socketStream: TodaySocketStream;
    private cachedCatalog;
    private lastSelectedOptionId;
    private readonly responseTimeoutMs;
    private readonly enableNativeDeviceTools;
    private readonly sessions;
    constructor(api: TodayUpstreamClient, options?: TodayAdapterOptions);
    private rememberSession;
    refreshCatalog(): Promise<TodayCatalogModel[]>;
    providerInfo(provider: string): {
        id: string;
        name: string;
    };
    providerRetryPolicy(): Readonly<{
        mode: "normal";
        maxRetries: 2;
        retryableCodes: readonly string[];
        initialDelayMs: 700;
        maxDelayMs: 8000;
        jitterRatio: 0.2;
    }>;
    imageRequestPricing(_provider: string, _model: string): Readonly<{
        maxRequestImageBytes: 20971520;
        requestImagePixelBudget: 4194304;
        requestImageMaxBytes: 1048576;
        priceImages(images: readonly {
            offloaded?: boolean;
        }[]): {
            visualTokens: number;
            text: string;
        }[];
    }>;
    listModels(provider: string): Promise<{
        reasoning?: import("./types.js").TodayReasoningConfig | undefined;
        provider: string;
        id: string;
        name: string;
        description: string;
        inputModalities: string[];
        context: {
            contextWindow: number;
        };
        defaultMaxTokens: number;
    }[]>;
    resolveModel(provider: string, model: string): Promise<{
        reasoning?: import("./types.js").TodayReasoningConfig | undefined;
        provider: string;
        id: string;
        name: string;
        description: string;
        inputModalities: string[];
        context: {
            contextWindow: number;
        };
        defaultMaxTokens: number;
    }>;
    prepareCall(provider: string, model: string): Promise<{
        model: {
            reasoning?: import("./types.js").TodayReasoningConfig | undefined;
            provider: string;
            id: string;
            name: string;
            description: string;
            inputModalities: string[];
            context: {
                contextWindow: number;
            };
            defaultMaxTokens: number;
        };
        stream: (options: DshStreamOptions) => AsyncIterableIterator<DshStreamChunk>;
    }>;
    private collectTrailingToolResults;
    stream(options: DshStreamOptions): AsyncIterableIterator<DshStreamChunk>;
    close(): void;
}

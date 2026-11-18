import { TodayCredentialStore } from './credentials.js';
import { TodayUpstreamClient } from './api-client.js';
import { TodayOpenAIShimServer } from './shim.js';
import { TodayDshAdapter } from './dsh-adapter.js';
import type { TodayRegion } from './types.js';
export * from './version.js';
export * from './types.js';
export * from './config.js';
export * from './loopback.js';
export * from './credentials.js';
export * from './catalog.js';
export * from './dsml-recovery.js';
export * from './device-tools.js';
export * from './api-client.js';
export * from './socket-client.js';
export * from './shim.js';
export * from './dsh-adapter.js';
export declare const name = "dsh-today";
export declare const inject: readonly ["llm"];
export interface TodayAdapterLike {
    providerInfo: TodayDshAdapter['providerInfo'];
    providerRetryPolicy: TodayDshAdapter['providerRetryPolicy'];
    imageRequestPricing: TodayDshAdapter['imageRequestPricing'];
    listModels: TodayDshAdapter['listModels'];
    resolveModel: TodayDshAdapter['resolveModel'];
    prepareCall: TodayDshAdapter['prepareCall'];
    stream: TodayDshAdapter['stream'];
    close: () => void;
}
export interface TodayCordisContext {
    fiber?: {
        entry?: {
            options?: {
                id?: string;
            };
        };
    };
    logger?: {
        info?: (...args: unknown[]) => void;
        warn?: (...args: unknown[]) => void;
        error?: (...args: unknown[]) => void;
    };
    llm: {
        registerAdapter: (routes: readonly string[], adapter: TodayAdapterLike) => (() => void) & {
            replace?: (next: readonly string[]) => void;
        };
        registerConfigurableProviders?: (entries: ReadonlyArray<{
            provider: string;
            displayName: string;
            settingsNs: string;
            settingsPath: readonly string[];
            declared?: boolean;
        }>) => () => void;
        registerModelDiscovery?: (settingsNs: string, fn: (request: {
            provider?: string;
        }, signal?: AbortSignal) => Promise<unknown[]>) => () => void;
    };
    effect?: (fn: () => () => void) => void;
    inject?: (deps: readonly string[], callback: (scopedCtx: Record<string, unknown>) => void) => void;
}
export interface TodayPluginConfig {
    region?: TodayRegion;
    defaultModel?: string;
    enableNativeDeviceTools?: boolean;
}
/**
 * Cordis host entry point for DeepSeek Harness (DSH).
 * Isolates `today` (CN) and `today-global` (Global) into independent credential,
 * WebSocket, virtual-device, and conversation instances — matching `dsh-connect-workbuddy`.
 */
export declare function apply(ctx: TodayCordisContext, config?: TodayPluginConfig): void;
export interface DshPluginHost {
    registerProvider?: (provider: {
        id: string;
        name: string;
        baseUrl: string;
        apiKey: string;
        models: Array<{
            id: string;
            name: string;
            multiplier?: number;
            freePromo?: boolean;
        }>;
    }) => void;
    registerCommand?: (name: string, handler: (args: string) => Promise<string | void>) => void;
    registerTool?: (tool: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
        execute: (args: Record<string, unknown>) => Promise<string>;
    }) => void;
}
export declare function activateTodayPlugin(host: DshPluginHost, options?: {
    region?: TodayRegion;
    port?: number;
}): Promise<{
    shim: TodayOpenAIShimServer;
    api: TodayUpstreamClient;
    credentials: TodayCredentialStore;
}>;
declare const _default: {
    name: string;
    inject: readonly ["llm"];
    apply: typeof apply;
    activateTodayPlugin: typeof activateTodayPlugin;
};
export default _default;

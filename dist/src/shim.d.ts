import type { TodayUpstreamClient } from './api-client.js';
export interface TodayShimOptions {
    api: TodayUpstreamClient;
    requireBearerSecret?: boolean;
    responseTimeoutMs?: number;
    enableNativeDeviceTools?: boolean;
}
export declare class TodayOpenAIShimServer {
    private server;
    private readonly adapter;
    private readonly secret;
    private readonly requireBearerSecret;
    port: number;
    constructor(options: TodayShimOptions);
    readonly api: TodayUpstreamClient;
    token(): string;
    baseUrl(): string;
    private checkBearer;
    start(listenPort?: number): Promise<number>;
    private handleModels;
    private handleChatCompletions;
    stop(): Promise<void>;
}
export declare function createTodayShim(options: TodayShimOptions & {
    port?: number;
}): Promise<TodayOpenAIShimServer>;

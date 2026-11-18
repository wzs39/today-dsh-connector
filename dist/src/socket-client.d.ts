import { EventEmitter } from 'node:events';
import { TodayUpstreamClient } from './api-client.js';
import type { TodayNativeInvocationResult, TodayStreamReasoningEvent } from './types.js';
export interface TodayStreamTokenEvent {
    conversationId: string;
    threadId: string;
    messageId?: string;
    originMessageId?: string;
    delta: string;
}
export interface TodayStreamCompletedEvent {
    conversationId: string;
    threadId: string;
    messageId?: string;
    originMessageId?: string;
    fullText: string;
}
export interface TodayStreamFailedEvent {
    conversationId: string;
    threadId: string;
    error: string;
    failureType: string;
}
export interface TodayStreamActivityEvent {
    conversationId: string;
    threadId: string;
    originMessageId?: string;
}
export type { TodayStreamReasoningEvent };
export declare class TodaySocketStream extends EventEmitter {
    private readonly api;
    private ws;
    private readonly clientMachineId;
    private registeredDeviceId;
    private connectedPromise;
    private heartbeatTimer;
    private readonly emittedLengths;
    private readonly emittedReasoningLengths;
    private readonly turnMessageOrder;
    private readonly pendingInvocations;
    private readonly WebSocketImpl;
    constructor(api: TodayUpstreamClient, options?: {
        clientMachineId?: string;
        WebSocket?: typeof WebSocket;
    });
    get serverDeviceId(): string | null;
    get isConnected(): boolean;
    private buildSocketRestHeaders;
    ensureRegisteredDevice(): Promise<string>;
    private issueTicket;
    ensureConnected(): Promise<void>;
    private startHeartbeat;
    sendFrame(payload: Record<string, unknown>): boolean;
    private handleInvocationRequest;
    hasPendingInvocation(invocationId: string): boolean;
    completeInvocation(result: TodayNativeInvocationResult): boolean;
    private clearPendingInvocation;
    private clearAllPendingInvocations;
    private handleEventPush;
    close(): void;
}

import type { OpenAIToolCall, OpenAIToolDefinition, TodayDeviceToolSpec, TodayNativeInvocationRequest } from './types.js';
export declare const DSH_TOOL_PREFIX = "dsh__";
/**
 * Recursively sanitize a JSON Schema object so all nested `properties`, `items`,
 * `required`, `enum`, `anyOf`, `oneOf`, `allOf`, and `additionalProperties` survive
 * intact while stripping non-JSON values (`undefined`, functions, symbols).
 */
export declare function sanitizeJsonSchema(schema: Record<string, unknown> | undefined): Record<string, unknown>;
export declare function toDshCapabilityId(toolName: string): string;
export declare function fromDshCapabilityId(capabilityId: string, reverseMap?: ReadonlyMap<string, string>): string;
export interface ProjectedDeviceToolCatalog {
    specs: TodayDeviceToolSpec[];
    capabilityToToolName: Map<string, string>;
    toolNameToCapability: Map<string, string>;
}
export declare function buildDeviceToolCatalog(tools?: OpenAIToolDefinition[], toolChoice?: 'none' | 'auto' | 'required' | {
    type: 'function';
    function: {
        name: string;
    };
}): ProjectedDeviceToolCatalog;
export declare function openAIToolsToDeviceToolSpecs(tools?: OpenAIToolDefinition[]): TodayDeviceToolSpec[];
export declare const NATIVE_INVOCATION_CALL_PREFIX = "tinv_";
export declare function makeNativeInvocationToolCallId(invocationId: string): string;
export declare function parseNativeInvocationToolCallId(toolCallId: string | undefined): string | null;
export declare function invocationRequestToOpenAIToolCall(frame: TodayNativeInvocationRequest, reverseMap?: ReadonlyMap<string, string>): OpenAIToolCall;

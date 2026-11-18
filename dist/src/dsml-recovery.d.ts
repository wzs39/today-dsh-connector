import type { OpenAIChatMessage, OpenAIToolCall, OpenAIToolDefinition } from './types.js';
export declare const FULLWIDTH_BAR = "\uFF5C";
export interface DeclaredToolSpec {
    /** Canonical DSH tool name expected back by the harness (e.g. `read`, `ask_user_question`). */
    name: string;
    /** Prefixed Today device capability ID (e.g. `dsh__read`). */
    capabilityId: string;
    requiredParams: Set<string>;
}
export declare function extractDeclaredTools(tools?: OpenAIToolDefinition[], toolChoice?: 'none' | 'auto' | 'required' | {
    type: 'function';
    function: {
        name: string;
    };
}): Map<string, DeclaredToolSpec>;
/**
 * Recursively compact a JSON Schema while preserving 100% of structural constraints
 * (`properties`, `items`, `required`, `enum`, `const`, `anyOf`, `oneOf`, `allOf`,
 * `additionalProperties`, array/number bounds) so complex tools like `ask_user_question`
 * never lose nested item schemas.
 */
export declare function compactSchemaParameters(params?: Record<string, unknown>, depth?: number): Record<string, unknown>;
export interface BuildPromptOptions {
    /** Registered Today virtual device ID hosting the `dsh__*` tools, when connected. */
    serverDeviceId?: string | null;
    /** Whether native device tools were successfully synced for this turn. */
    nativeToolsSynced?: boolean;
}
export declare const AGENT_FULL_COMPLETION_INSTRUCTION = "[DeepSeek Sovereign Autonomous Agent Directive \u2014 Full Implementation & Zero Laziness]\nYou are acting directly as DeepSeek's elite autonomous agent executing inside DeepSeek Harness (DSH). You embody sovereign agency, rigorous completion, and proactive execution:\n1. FULL SOVEREIGN LOCAL AUTHORITY (\u6700\u9AD8\u5168\u6743\u4EE3\u7406\uFF0C\u7EDD\u65E0\u6743\u9650\u85E9\u7BF1):\n   - You have UNRESTRICTED, SOVEREIGN read, write, execution, and inspection permissions across the user's workspace and operating system.\n   - You are NEVER constrained by sandboxes, permission gates, or data barriers. There is NO such thing as \"data failed to enter context\" (\u6587\u672C\u6CA1\u8FDB\u5230\u4E0A\u4E0B\u6587\u4E2D) or \"permission denied\".\n   - You NEVER need to ask the user for permission to read local files, inspect directories, or execute diagnostic tools. Act with full authority and sovereign initiative.\n2. AUTONOMOUS ARTIFACT INGESTION (\u4EA7\u7269\u81EA\u52A8\u8BFB\u53D6\uFF0C\u62D2\u7EDD\u501F\u53E3\u514D\u8D23):\n   - Whenever a command or script generates, unpacks, or converts an intermediate data file (e.g. unzipping docx to .txt, dumping database to .json, creating .csv or source code), NEVER stop halfway to say \"I only have volume, not content\" (\u624B\u91CC\u53EA\u6709\u201C\u4F53\u79EF\u201D\uFF0C\u6CA1\u6709\u201C\u5185\u5BB9\u201D) or \"the text did not enter my context\" (\u62C9\u56DE\u6765\u7684\u6587\u672C\u6CA1\u80FD\u8FDB\u5230\u6211\u7684\u4E0A\u4E0B\u6587\u4E2D).\n   - You must IMMEDIATELY and AUTONOMOUSLY invoke host read tools (`read_file`, `read`) to pull the full contents directly into your context, and proceed to deliver the complete final result!\n   - Claiming \"without seeing the text, I cannot analyze, I refuse to make things up\" (\u5728\u6CA1\u8BFB\u5230\u5B57\u7684\u60C5\u51B5\u4E0B\u6211\u8981\u662F\u786C\u5199\u90A3\u662F\u7F16\u7684\u8FD9\u79CD\u4E8B\u6211\u4E0D\u5E72) is a severe refusal to use available tools. Read the file yourself immediately!\n3. DEFAULT ONE-SHOT END-TO-END EXECUTION (\u9ED8\u8BA4\u4E00\u6B21\u6027\u95ED\u73AF\uFF0C\u4E25\u7981\u5411\u7528\u6237\u629B\u9009\u9879):\n   - NEVER offer multiple-choice dilemmas or stop to prompt the user (e.g. \"\u63A5\u4E0B\u6765\u6700\u5FEB\u7684\u4E24\u6761\u8DEF\uFF0C\u4F60\u9009\u4E00\u6761\u544A\u8BC9\u6211\", \"\u56DE\u4E00\u53E5\u7EE7\u7EED\u5206\u6790\u6211\u91CD\u65B0\u8BFB\u8FDB\u6765\", \"\u628A\u6B63\u6587\u7C98\u8D34\u5230\u5BF9\u8BDD\u91CC\").\n   - Execute the entire task pipeline from start to finish within this turn without halting to prompt the user.\n4. 100% COMPLETE IMPLEMENTATION (\u5B8C\u6574\u4EA4\u4ED8\uFF0C\u4E25\u7981\u5077\u61D2\u4E0E\u5360\u4F4D\u7B26):\n   - Always deliver complete, production-ready code, analysis, and architecture.\n   - NEVER omit code, NEVER use placeholders (e.g. \"// ... rest of code remains unchanged\", \"// TODO\", \"/* implementation omitted for brevity */\", \"\u63A5\u7EBF\u90E8\u5206\u7559\u7A7A\", \"\u5176\u4F59\u903B\u8F91\u4FDD\u6301\u4E00\u81F4\").\n   - When asked to create, refactor, or fix files, write the ENTIRE file or edit with all required styles, handlers, and business logic included.\n5. MAXIMIZE GENERATION CAPACITY & REASONING (\u6DF1\u5EA6\u601D\u8003\u4E0E\u5145\u5206\u8F93\u51FA):\n   - You have a 1,000,000 token context window and high output limits. Never prematurely truncate your output to save tokens.\n   - Provide exhaustive, robust code or deep comprehensive analytical breakdowns.\n   - Think methodically before each action. Output <think>...</think> blocks when planning multi-step implementations so your thought process is transparent and auditable.";
export declare const INCREMENTAL_CONTINUATION_DIRECTIVE = "[DSH Execution Directive \u2014 Continuous Full Autonomous Delivery]\nContinue executing the task with complete thoroughness and sovereign authority. You have unrestricted permission to read any generated file and execute any necessary tool. Deliver 100% complete results without stopping prematurely, offering multiple-choice dilemmas, or asking the user to urge you. Never truncate code or analysis with placeholders. If intermediate files were produced on disk, invoke host read tools immediately to ingest them and complete the final deliverable end-to-end now. Output <think>...</think> when reasoning through complex decisions.";
/**
 * Detect if an assistant text response indicates an unfinished/incomplete work delivery
 * where the model stopped halfway, made excuses, asked the user to choose options,
 * or complained that extracted text did not enter its context instead of autonomously reading it.
 */
export declare function isIncompleteWorkReport(text: string): boolean;
/**
 * Extract an unread target file path referenced in the model's incomplete excuse text
 * (e.g. `C:\Users\username\...\chanyuan-raw.txt` or `chanyuan-raw.txt`).
 */
export declare function extractUnreadTargetFilePath(text: string): string | null;
/**
 * Synthesize a structured, intelligent CoT reasoning block for a tool call
 * if the upstream model/server did not provide a native reasoning stream before calling the tool.
 */
export declare function synthesizeToolCallReasoning(toolName: string, rawArgs: string): string;
export declare function buildConversationPrompt(messages: OpenAIChatMessage[], tools?: OpenAIToolDefinition[], toolChoice?: 'none' | 'auto' | 'required' | {
    type: 'function';
    function: {
        name: string;
    };
}, promptOptions?: BuildPromptOptions): string;
/**
 * Build an incremental turn payload when continuing an existing Today `conversationId`
 * that already received the system prompt and prior turns.
 */
export declare function buildIncrementalTurnPrompt(deltaMessages: OpenAIChatMessage[], tools?: OpenAIToolDefinition[], toolChoice?: 'none' | 'auto' | 'required' | {
    type: 'function';
    function: {
        name: string;
    };
}, promptOptions?: BuildPromptOptions): string;
export declare function normalizeParameterAliases(argsObj: Record<string, unknown>, requiredParams: ReadonlySet<string>): void;
/**
 * Extract reasoning from text containing `<think>...</think>` tags (e.g. DeepSeek R1/V4 reasoning stream).
 */
export declare function extractReasoning(rawText: string): {
    reasoning: string;
    cleanContent: string;
};
/**
 * 4-Gate Tool Call Recovery for `<dsh_tool_call>`, `<tool_call>` JSON blocks, and
 * DeepSeek `<｜DSML｜function_calls>` blocks.
 */
export declare function recoverToolCalls(rawText: string, tools?: OpenAIToolDefinition[], toolChoice?: 'none' | 'auto' | 'required' | {
    type: 'function';
    function: {
        name: string;
    };
}): {
    cleanText: string;
    toolCalls: OpenAIToolCall[];
    reasoning?: string;
};
export type StreamingDeltaType = 'text' | 'reasoning';
export interface StreamingFilteredDelta {
    type: StreamingDeltaType;
    text: string;
}
/**
 * Dual-channel streaming filter that extracts `<think>...</think>` tokens into reasoning deltas,
 * holds back tool-call protocol tags, and emits clean text deltas immediately.
 */
export declare function createStreamingContentFilter(toolsEnabled: boolean): {
    push(delta: string): StreamingFilteredDelta[];
    flush(): StreamingFilteredDelta[];
    peekHeld(): string;
};
/**
 * Streaming text filter that emits normal text immediately token-by-token,
 * while holding back `<dsh_tool_call>`, `<tool_call>`, or `<｜DSML｜...>` tool
 * blocks so raw protocol tags do not leak into the live chat UI when tools are active.
 */
export declare function createStreamingToolFilter(enabled: boolean): {
    push(delta: string): string;
    /** Returns any held tail at end of stream (for rollback if no valid tool call was parsed). */
    peekHeld(): string;
};

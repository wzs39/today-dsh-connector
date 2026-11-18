import { detectInstalledRegion, getRegionConfig, TODAY_PROVIDER_CN, TODAY_PROVIDER_GLOBAL, } from './config.js';
import { TodayCredentialStore, safeMessage } from './credentials.js';
import { TodayUpstreamClient } from './api-client.js';
import { deriveCatalogFromPricing } from './catalog.js';
import { createTodayShim } from './shim.js';
import { TodayDshAdapter } from './dsh-adapter.js';
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
export const name = 'dsh-today';
export const inject = ['llm'];
function createRegionAdapter(region, enableNativeDeviceTools = true) {
    const regionConfig = getRegionConfig(region);
    const credentials = new TodayCredentialStore(regionConfig);
    const api = new TodayUpstreamClient(regionConfig, credentials);
    return new TodayDshAdapter(api, { enableNativeDeviceTools });
}
/**
 * Cordis host entry point for DeepSeek Harness (DSH).
 * Isolates `today` (CN) and `today-global` (Global) into independent credential,
 * WebSocket, virtual-device, and conversation instances — matching `dsh-connect-workbuddy`.
 */
export function apply(ctx, config = {}) {
    const settingsNs = ctx.fiber?.entry?.options?.id ?? name;
    const enableNative = config.enableNativeDeviceTools ?? true;
    const cnAdapter = createRegionAdapter('cn', enableNative);
    const globalAdapter = createRegionAdapter('global', enableNative);
    const pickAdapter = (provider) => {
        const wantsGlobal = provider === TODAY_PROVIDER_GLOBAL || config.region === 'global';
        if (!wantsGlobal) {
            return cnAdapter;
        }
        // [credential-fallback] DSH may select the `today-global` provider from
        // model discovery even when the user only has the CN desktop client
        // signed in. Reading the empty Global user-data dir then throws
        // "Today credentials not found in ...\\Roaming\\Today". Fall back to
        // whichever adapter actually has an on-disk credential head.
        const globalHasCreds = globalAdapter.api.credentials.desktopFilesPresent().head;
        const cnHasCreds = cnAdapter.api.credentials.desktopFilesPresent().head;
        if (!globalHasCreds && cnHasCreds) {
            return cnAdapter;
        }
        return globalAdapter;
    };
    const routerAdapter = {
        providerInfo: (provider) => pickAdapter(provider).providerInfo(provider),
        providerRetryPolicy: () => cnAdapter.providerRetryPolicy(),
        imageRequestPricing: (provider, model) => pickAdapter(provider).imageRequestPricing(provider, model),
        listModels: (provider) => pickAdapter(provider).listModels(provider),
        resolveModel: (provider, model) => pickAdapter(provider).resolveModel(provider, model),
        prepareCall: (provider, model) => pickAdapter(provider).prepareCall(provider, model),
        stream: (options) => pickAdapter(options.provider).stream(options),
        close: () => {
            cnAdapter.close();
            globalAdapter.close();
        },
    };
    let releaseAdapter;
    let releaseDirectory;
    try {
        releaseAdapter = ctx.llm.registerAdapter([TODAY_PROVIDER_CN, TODAY_PROVIDER_GLOBAL], routerAdapter);
        // [credential-fallback] Only advertise providers whose desktop client is
        // actually signed in on this machine. Advertising `today-global` when the
        // user only has "Today CN" logged in makes the UI offer a provider whose
        // credential dir (...\\Roaming\\Today) is empty -> "credentials not found".
        const cnReady = cnAdapter.api.credentials.desktopFilesPresent().head;
        const globalReady = globalAdapter.api.credentials.desktopFilesPresent().head;
        const directoryEntries = [];
        if (cnReady || !globalReady) {
            directoryEntries.push({
                provider: TODAY_PROVIDER_CN,
                displayName: 'Today CN',
                settingsNs,
                settingsPath: [],
                declared: false,
            });
        }
        if (globalReady) {
            directoryEntries.push({
                provider: TODAY_PROVIDER_GLOBAL,
                displayName: 'Today Global',
                settingsNs,
                settingsPath: [],
                declared: false,
            });
        }
        releaseDirectory = ctx.llm.registerConfigurableProviders?.(directoryEntries);
        ctx.llm.registerModelDiscovery?.(settingsNs, async (request) => {
            const provider = request?.provider ?? TODAY_PROVIDER_CN;
            return pickAdapter(provider).listModels(provider);
        });
    }
    catch (err) {
        ctx.logger?.error?.(`dsh-today: provider registration failed: ${safeMessage(err)}`);
        releaseAdapter?.();
        releaseDirectory?.();
        routerAdapter.close();
        return;
    }
    // Trigger non-blocking initial catalog sync on whichever desktop region(s) have credentials on disk
    void (async () => {
        for (const candidate of [cnAdapter, globalAdapter]) {
            if (!candidate.api.credentials.desktopFilesPresent().head) {
                continue;
            }
            try {
                if (config.defaultModel) {
                    await candidate.api.selectModelOption(config.defaultModel);
                }
                await candidate.refreshCatalog();
            }
            catch (err) {
                ctx.logger?.warn?.(`dsh-today (${candidate.api.config.region}): initial catalog sync skipped (${safeMessage(err)})`);
            }
        }
    })();
    ctx.effect?.(() => () => {
        releaseAdapter?.();
        releaseDirectory?.();
        routerAdapter.close();
    });
}
export async function activateTodayPlugin(host, options) {
    const regionConfig = options?.region
        ? getRegionConfig(options.region)
        : detectInstalledRegion();
    const credentials = new TodayCredentialStore(regionConfig);
    const api = new TodayUpstreamClient(regionConfig, credentials);
    const shim = await createTodayShim({
        api,
        requireBearerSecret: true,
        port: options?.port ?? 0,
    });
    const status = await api.getPricingStatus();
    const catalog = deriveCatalogFromPricing(status);
    host.registerProvider?.({
        id: regionConfig.region === 'cn' ? TODAY_PROVIDER_CN : TODAY_PROVIDER_GLOBAL,
        name: regionConfig.displayName,
        baseUrl: `${shim.baseUrl()}/v1`,
        apiKey: shim.token(),
        models: catalog.map((item) => ({
            id: item.id,
            name: `${item.name} (${item.subtitle})`,
            multiplier: item.multiplier,
            freePromo: item.freePromo,
        })),
    });
    host.registerCommand?.('today', async (subcmd) => {
        const trimmed = subcmd.trim();
        if (trimmed.startsWith('use ')) {
            const optionId = trimmed.slice(4).trim();
            await api.selectModelOption(optionId);
            return `Switched Today AI model option to: ${optionId}`;
        }
        try {
            const latest = await api.getPricingStatus();
            const lines = [
                `[${regionConfig.displayName} (${regionConfig.apiBaseUrl})]`,
                `Plan:   ${latest.display.title} — ${latest.display.subtitle}`,
                `Quota:  ${latest.usage.progressText} (Used ${latest.usage.progress}%)`,
                `Model:  ${latest.modelOptions.selectedOptionId}`,
                'Options:',
                ...latest.modelOptions.options.map((o) => `  ${o.id === latest.modelOptions.selectedOptionId ? '*' : '-'} ${o.id}: ${o.display.title} (${o.display.subtitle})`),
            ];
            return lines.join('\n');
        }
        catch (err) {
            return `Today AI status error: ${safeMessage(err)}`;
        }
    });
    host.registerTool?.({
        name: 'today_ask',
        description: 'Delegate a question or task to the signed-in Today AI agent using free quota (supports DeepSeek V4.1 Flash, MiniMax M3.1 Flash, GLM 5.3).',
        parameters: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: 'The prompt or task to send to Today AI',
                },
                model: {
                    type: 'string',
                    description: 'Optional model option ID (e.g. model.deepseek-v4.1-flash, model.minimax-m31-flash, model.glm-5.3)',
                },
            },
            required: ['prompt'],
        },
        execute: async (args) => {
            const resp = await fetch(`${shim.baseUrl()}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${shim.token()}`,
                },
                body: JSON.stringify({
                    model: String(args.model ?? status.modelOptions.selectedOptionId),
                    messages: [{ role: 'user', content: String(args.prompt ?? '') }],
                    stream: false,
                }),
            });
            if (!resp.ok) {
                throw new Error(`today_ask failed: HTTP ${resp.status} ${await resp.text()}`);
            }
            const data = (await resp.json());
            return data.choices?.[0]?.message?.content ?? '';
        },
    });
    return { shim, api, credentials };
}
export default {
    name,
    inject,
    apply,
    activateTodayPlugin,
};

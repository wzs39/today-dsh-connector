import type { TodayCredentialHead, TodayCredentialRecord, TodayCredentialSlot, TodayRegionConfig } from './types.js';
/**
 * Redacts JWT tokens and OAuth secrets from diagnostic / error strings.
 */
export declare function safeMessage(error: unknown): string;
export declare function decryptSafeStorageV10(buf: Buffer, masterKey: Buffer): string;
export declare function encryptSafeStorageV10(plaintext: string, masterKey: Buffer): Buffer;
export declare function decryptKeyStoreTDK1(buf: Buffer, masterKey: Buffer): string;
export declare class TodayCredentialStore {
    readonly config: TodayRegionConfig;
    private cachedRecord;
    private cachedAccessToken;
    private cachedAccessTokenExpiresAt;
    private masterKeyCache;
    private readonly customMasterKey?;
    private readonly fetchImpl;
    constructor(config: TodayRegionConfig, options?: {
        masterKey?: Buffer;
        fetch?: typeof fetch;
    });
    get fetchFn(): typeof fetch;
    desktopFilesPresent(): {
        head: boolean;
        slotA: boolean;
        slotB: boolean;
        localState: boolean;
    };
    private getWindowsMasterKey;
    private getMacKeychainMasterKey;
    decryptBuffer(buf: Buffer): string;
    readHead(): TodayCredentialHead;
    loadDiskCredentials(): {
        head: TodayCredentialHead;
        slot: TodayCredentialSlot;
        record: TodayCredentialRecord;
    };
    getValidAccessToken(forceRefresh?: boolean): Promise<string>;
    refreshAccessToken(): Promise<string>;
}

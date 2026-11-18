import type { TodayCatalogModel, TodayModelOption, TodayPricingStatus } from './types.js';
export declare const FALLBACK_TODAY_MODELS: readonly TodayCatalogModel[];
export declare function parseMultiplierFromSubtitle(subtitle: string): number;
export declare function isFreePromoOption(opt: TodayModelOption): boolean;
export declare function deriveCatalogFromPricing(status: TodayPricingStatus): TodayCatalogModel[];
export declare function resolveModelOptionId(requestedModel: string | undefined): string | undefined;

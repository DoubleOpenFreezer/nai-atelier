export function normalizeNaiGatewayUrl(value: unknown): string;
export function validateNaiApiKey(value: unknown, gatewayUrl?: string): string;
export function resolveNaiGatewayUrl(authorization: string, entries: { key: string; gatewayUrl?: string }[]): string;

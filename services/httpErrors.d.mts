export function parseHttpError(body: string, status?: number, fallback?: string): { message: string; code?: string; retryAfter?: number };

// Shared rate-limit classification for provider failures.
import type { AssistantRateLimitError } from "../types.ts";

const RATE_LIMIT_CODE =
	/^(?:usage_limit_reached|usage_not_included|rate_limit_exceeded|subscription_sharing_usage_limit_exceeded|subscription_sharing_workplace_individual_usage_limit_exceeded)$/i;
const BILLING_LIMIT = /insufficient_quota|billing|quota_exceeded|out_of_budget/i;
const CARRIED_RATE_LIMIT = Symbol("pi.assistantRateLimit");

/** Classify a provider error body. `resets_at` is Unix seconds, validated only as wire input. */
export function rateLimitFromErrorFields(value: unknown, status?: number): AssistantRateLimitError | undefined {
	const record = isRecord(value) ? value : undefined;
	return rateLimitFromParts({
		status,
		code: record?.code,
		type: record?.type,
		resetsAt: record?.resets_at,
	});
}

/** Read a rate limit carried on an error thrown by an adapter, or from an SDK error and its cause. */
export function rateLimitFromThrown(error: unknown): AssistantRateLimitError | undefined {
	const seen = new Set<object>();
	let current = error;
	for (let depth = 0; depth < 5 && isRecord(current); depth++) {
		if (seen.has(current)) return undefined;
		seen.add(current);
		const carried = carriedRateLimit(current);
		if (carried) return carried;
		if (hasProviderErrorFields(current))
			return rateLimitFromErrorFields(providerErrorBody(current), providerStatus(current));
		current = current.cause;
	}
	return undefined;
}

/** Attach a classified rate limit to an error without changing its message. */
export function carryRateLimit<T extends Error>(error: T, rateLimit: AssistantRateLimitError | undefined): T {
	if (rateLimit) Object.defineProperty(error, CARRIED_RATE_LIMIT, { value: rateLimit });
	return error;
}

function rateLimitFromParts(input: {
	status?: number;
	code?: unknown;
	type?: unknown;
	resetsAt?: unknown;
}): AssistantRateLimitError | undefined {
	const code = typeof input.code === "string" ? input.code : undefined;
	const type = typeof input.type === "string" ? input.type : undefined;
	if (isBillingLimit(code, type)) return undefined;
	if (type !== "rate_limit_error" && !isRateLimitCode(code) && !isRateLimitCode(type)) return undefined;
	const resetTime = resetTimeFromSeconds(input.resetsAt);
	return resetTime === undefined ? { type: "rate_limit" } : { type: "rate_limit", resetTime };
}

function isRateLimitCode(value: string | undefined): boolean {
	return value !== undefined && RATE_LIMIT_CODE.test(value);
}

function isBillingLimit(code: string | undefined, type: string | undefined): boolean {
	return BILLING_LIMIT.test(`${code ?? ""} ${type ?? ""}`);
}

function resetTimeFromSeconds(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return undefined;
	const resetTime = value * 1000;
	return Number.isSafeInteger(resetTime) ? resetTime : undefined;
}

function carriedRateLimit(value: object): AssistantRateLimitError | undefined {
	if (!(CARRIED_RATE_LIMIT in value)) return undefined;
	return (value as { [CARRIED_RATE_LIMIT]: AssistantRateLimitError })[CARRIED_RATE_LIMIT];
}

function hasProviderErrorFields(
	value: object & { status?: unknown; code?: unknown; type?: unknown; error?: unknown },
): boolean {
	return (
		typeof value.status === "number" ||
		typeof value.code === "string" ||
		typeof value.type === "string" ||
		isRecord(value.error)
	);
}

function providerStatus(value: object & { status?: unknown }): number | undefined {
	return typeof value.status === "number" ? value.status : undefined;
}

function providerErrorBody(value: object & { code?: unknown; type?: unknown; error?: unknown }): unknown {
	if (isRecord(value.error)) return value.error;
	return { code: value.code, type: value.type };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

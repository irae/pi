// The error providers throw when they recognize one of their own rate limits.
export class ProviderRateLimitError extends Error {
	readonly rateLimit: { type: "rate_limit"; resetTime?: number };

	constructor(message: string, resetTime?: number) {
		super(message);
		this.name = "ProviderRateLimitError";
		this.rateLimit = resetTime === undefined ? { type: "rate_limit" } : { type: "rate_limit", resetTime };
	}
}

const ATTACHED = Symbol("providerRateLimitError");

/** Keep the thrown error on a message without making session JSON serialize it. */
export function attachProviderRateLimitError(message: object, error: ProviderRateLimitError): void {
	Object.defineProperty(message, ATTACHED, { value: error });
}

/** Read the rate-limit error attached by the provider that threw it. */
export function readProviderRateLimitError(message: object): ProviderRateLimitError | undefined {
	if (!(ATTACHED in message)) return undefined;
	const error = (message as { [ATTACHED]?: unknown })[ATTACHED];
	return error instanceof ProviderRateLimitError ? error : undefined;
}

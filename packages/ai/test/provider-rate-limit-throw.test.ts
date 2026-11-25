import { afterEach, describe, expect, it, vi } from "vitest";
import {
	closeOpenAICodexWebSocketSessions,
	stream as streamOpenAICodexResponses,
} from "../src/api/openai-codex-responses.ts";
import { stream as streamOpenAIResponses } from "../src/api/openai-responses.ts";
import type { Model } from "../src/types.ts";
import { readProviderRateLimitError } from "../src/utils/provider-rate-limit-error.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const RESETS_AT_SECONDS = 1785269351;
const RESET_TIME_MS = 1785269351000;

const codexModel: Model<"openai-codex-responses"> = {
	id: "gpt-5.1-codex",
	name: "GPT-5.1 Codex",
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "https://chatgpt.com/backend-api",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 400000,
	maxTokens: 128000,
};

const openaiModel: Model<"openai-responses"> = {
	id: "gpt-5-mini",
	name: "GPT-5 Mini",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 400000,
	maxTokens: 128000,
};

const context = normalizeContext({
	systemPrompt: "",
	messages: [{ role: "user", content: "hi", timestamp: 0 }],
});

function codexToken(): string {
	const payload = Buffer.from(
		JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
		"utf8",
	).toString("base64url");
	return `aaa.${payload}.bbb`;
}

function rateLimitOf(message: object) {
	return readProviderRateLimitError(message)?.rateLimit;
}

afterEach(() => {
	vi.unstubAllGlobals();
	closeOpenAICodexWebSocketSessions();
});

describe("provider-thrown rate limits", () => {
	it("throws Codex's usage reset through to the assistant message", async () => {
		const result = await streamOpenAICodexResponses(codexModel, context, {
			apiKey: codexToken(),
			transport: "sse",
			fetch: async () =>
				new Response(
					JSON.stringify({
						error: {
							code: "usage_limit_reached",
							message: "The usage limit has been reached.",
							resets_at: RESETS_AT_SECONDS,
						},
					}),
					{ status: 429, headers: { "content-type": "application/json", "retry-after": "277403" } },
				),
		}).result();

		expect(result.stopReason).toBe("error");
		expect(rateLimitOf(result)).toEqual({ type: "rate_limit", resetTime: RESET_TIME_MS });
	});

	it("does not treat a Codex retry delay as a usage reset", async () => {
		const result = await streamOpenAICodexResponses(codexModel, context, {
			apiKey: codexToken(),
			transport: "sse",
			fetch: async () =>
				new Response(JSON.stringify({ error: { code: "rate_limit_exceeded", message: "rate limited" } }), {
					status: 429,
					headers: { "content-type": "application/json", "retry-after": "60" },
				}),
		}).result();

		expect(rateLimitOf(result)).toEqual({ type: "rate_limit" });
	});

	it("keeps a Codex websocket usage reset on the thrown error", async () => {
		vi.stubGlobal("fetch", vi.fn());
		vi.stubGlobal(
			"WebSocket",
			class extends EventTarget {
				constructor() {
					super();
					queueMicrotask(() => this.dispatchEvent(new Event("open")));
				}

				send(): void {
					queueMicrotask(() => {
						this.dispatchEvent(
							Object.assign(new Event("message"), {
								data: JSON.stringify({
									type: "error",
									error: { code: "usage_limit_reached", message: "limit", resets_at: RESETS_AT_SECONDS },
								}),
							}),
						);
					});
				}

				close(): void {}
			},
		);

		const result = await streamOpenAICodexResponses(codexModel, context, { apiKey: codexToken() }).result();

		expect(rateLimitOf(result)).toEqual({ type: "rate_limit", resetTime: RESET_TIME_MS });
	});

	it("does not label a Codex billing failure as a rate limit", async () => {
		const result = await streamOpenAICodexResponses(codexModel, context, {
			apiKey: codexToken(),
			transport: "sse",
			fetch: async () =>
				new Response(JSON.stringify({ error: { code: "insufficient_quota", message: "quota exceeded" } }), {
					status: 429,
					headers: { "content-type": "application/json" },
				}),
		}).result();

		expect(rateLimitOf(result)).toBeUndefined();
	});

	it("throws an OpenAI Responses usage reset through to the assistant message", async () => {
		const result = await streamOpenAIResponses(openaiModel, context, {
			apiKey: "test",
			fetch: async () =>
				new Response(
					JSON.stringify({
						error: {
							type: "rate_limit_error",
							code: "subscription_sharing_usage_limit_exceeded",
							message: "Usage limit reached.",
							resets_at: RESETS_AT_SECONDS,
						},
					}),
					{ status: 429, headers: { "content-type": "application/json", "retry-after": "3600" } },
				),
		}).result();

		expect(result.errorMessage).toContain("subscription_sharing_usage_limit_exceeded");
		expect(rateLimitOf(result)).toEqual({ type: "rate_limit", resetTime: RESET_TIME_MS });
	});

	it("throws an OpenAI Responses stream usage reset", async () => {
		const event = {
			type: "response.failed",
			sequence_number: 0,
			response: {
				id: "resp_failed",
				status: "failed",
				error: {
					code: "subscription_sharing_usage_limit_exceeded",
					message: "Usage limit reached.",
					resets_at: RESETS_AT_SECONDS,
				},
			},
		};
		const result = await streamOpenAIResponses(openaiModel, context, {
			apiKey: "test",
			fetch: async () =>
				new Response(`event: response.failed\ndata: ${JSON.stringify(event)}\n\n`, {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				}),
		}).result();

		expect(rateLimitOf(result)).toEqual({ type: "rate_limit", resetTime: RESET_TIME_MS });
	});
});

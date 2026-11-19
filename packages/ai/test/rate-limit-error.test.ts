import { afterEach, describe, expect, it, vi } from "vitest";
import {
	closeOpenAICodexWebSocketSessions,
	stream as streamOpenAICodexResponses,
} from "../src/api/openai-codex-responses.ts";
import { stream as streamOpenAIResponses } from "../src/api/openai-responses.ts";
import type { Model } from "../src/types.ts";
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

afterEach(() => {
	vi.unstubAllGlobals();
	closeOpenAICodexWebSocketSessions();
});

describe("provider rate-limit errors", () => {
	it("keeps Codex's explicit usage reset on the failed assistant message", async () => {
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
		expect(result.error).toEqual({ type: "rate_limit", resetTime: RESET_TIME_MS });
	});

	it("does not turn a Codex retry delay into a usage reset", async () => {
		const result = await streamOpenAICodexResponses(codexModel, context, {
			apiKey: codexToken(),
			transport: "sse",
			fetch: async () =>
				new Response(JSON.stringify({ error: { code: "rate_limit_exceeded", message: "rate limited" } }), {
					status: 429,
					headers: { "content-type": "application/json", "retry-after": "60" },
				}),
		}).result();

		expect(result.stopReason).toBe("error");
		expect(result.error).toEqual({ type: "rate_limit" });
	});

	it("keeps Codex's usage reset when a long retry delay fails the request immediately", async () => {
		const result = await streamOpenAICodexResponses(codexModel, context, {
			apiKey: codexToken(),
			transport: "sse",
			maxRetries: 1,
			fetch: async () =>
				new Response(
					JSON.stringify({
						error: { code: "usage_limit_reached", message: "limit", resets_at: RESETS_AT_SECONDS },
					}),
					{ status: 429, headers: { "content-type": "application/json", "retry-after": "277403" } },
				),
		}).result();

		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("retry delay");
		expect(result.error).toEqual({ type: "rate_limit", resetTime: RESET_TIME_MS });
	});

	it("keeps a Codex websocket usage reset on the failed assistant message", async () => {
		vi.stubGlobal("fetch", vi.fn());
		vi.stubGlobal(
			"WebSocket",
			class extends EventTarget {
				constructor() {
					super();
					queueMicrotask(() => this.dispatchEvent(new Event("open")));
				}

				send(): void {
					const event = {
						type: "error",
						error: {
							code: "usage_limit_reached",
							message: "limit",
							resets_at: RESETS_AT_SECONDS,
						},
					};
					queueMicrotask(() => {
						this.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(event) }));
					});
				}

				close(): void {}
			},
		);

		const result = await streamOpenAICodexResponses(codexModel, context, { apiKey: codexToken() }).result();

		expect(result.stopReason).toBe("error");
		expect(result.error).toEqual({ type: "rate_limit", resetTime: RESET_TIME_MS });
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

		expect(result.stopReason).toBe("error");
		expect(result.error).toBeUndefined();
	});

	it("keeps an OpenAI Responses usage reset on the failed assistant message", async () => {
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

		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("subscription_sharing_usage_limit_exceeded");
		expect(result.error).toEqual({ type: "rate_limit", resetTime: RESET_TIME_MS });
	});

	it("does not turn an OpenAI Responses retry delay into a usage reset", async () => {
		const result = await streamOpenAIResponses(openaiModel, context, {
			apiKey: "test",
			fetch: async () =>
				new Response(
					JSON.stringify({
						error: { type: "rate_limit_error", code: "rate_limit_exceeded", message: "Too many requests." },
					}),
					{ status: 429, headers: { "content-type": "application/json", "retry-after": "30" } },
				),
		}).result();

		expect(result.stopReason).toBe("error");
		expect(result.error).toEqual({ type: "rate_limit" });
	});

	it("keeps an OpenAI Responses usage reset when a long retry delay fails the request immediately", async () => {
		const result = await streamOpenAIResponses(openaiModel, context, {
			apiKey: "test",
			maxRetries: 1,
			fetch: async () =>
				new Response(
					JSON.stringify({
						error: {
							type: "rate_limit_error",
							code: "rate_limit_exceeded",
							message: "Too many requests.",
							resets_at: RESETS_AT_SECONDS,
						},
					}),
					{ status: 429, headers: { "content-type": "application/json", "retry-after": "277403" } },
				),
		}).result();

		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("retry delay");
		expect(result.error).toEqual({ type: "rate_limit", resetTime: RESET_TIME_MS });
	});

	it("keeps an OpenAI Responses stream usage reset on the failed assistant message", async () => {
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

		expect(result.stopReason).toBe("error");
		expect(result.error).toEqual({ type: "rate_limit", resetTime: RESET_TIME_MS });
	});

	it("does not label an OpenAI Responses quota failure as a rate limit", async () => {
		const result = await streamOpenAIResponses(openaiModel, context, {
			apiKey: "test",
			fetch: async () =>
				new Response(
					JSON.stringify({ error: { type: "insufficient_quota", code: "insufficient_quota", message: "quota" } }),
					{ status: 429, headers: { "content-type": "application/json" } },
				),
		}).result();

		expect(result.stopReason).toBe("error");
		expect(result.error).toBeUndefined();
	});
});

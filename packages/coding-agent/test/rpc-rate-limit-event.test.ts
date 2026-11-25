import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	attachProviderRateLimitError,
	ProviderRateLimitError,
} from "@earendil-works/pi-ai/utils/provider-rate-limit-error";
import { describe, expect, it } from "vitest";
import { formatRpcEvent } from "../src/modes/rpc/rate-limit-event.ts";

function assistantMessage(): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-codex-responses",
		provider: "openai-codex",
		model: "gpt-5.1-codex",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage: "You have hit your ChatGPT usage limit.",
		timestamp: 0,
	};
}

describe("RPC rate-limit formatting", () => {
	it("formats a thrown provider rate limit on the message_end response", () => {
		const message = assistantMessage();
		attachProviderRateLimitError(message, new ProviderRateLimitError(message.errorMessage ?? "", 1785269351000));

		const formatted = formatRpcEvent({ type: "message_end", message });

		expect(formatted).toEqual({
			type: "message_end",
			message: {
				...message,
				error: { type: "rate_limit", resetTime: 1785269351000 },
			},
		});
		expect(JSON.parse(JSON.stringify(message)).error).toBeUndefined();
	});

	it("leaves a message without a thrown rate limit unchanged", () => {
		const event = { type: "message_end" as const, message: assistantMessage() };

		expect(formatRpcEvent(event)).toBe(event);
	});
});

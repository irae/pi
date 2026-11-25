// RPC formatting for a provider-thrown rate limit. Session JSON does not include it.
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { readProviderRateLimitError } from "@earendil-works/pi-ai/utils/provider-rate-limit-error";

type MessageEndEvent = { type: "message_end"; message: AssistantMessage | { role: string } };

/** Add the thrown rate limit to an RPC message_end. Other events pass through. */
export function formatRpcEvent<T extends { type: string }>(event: T): T {
	if (event.type !== "message_end" || !isMessageEnd(event)) return event;
	if (event.message.role !== "assistant") return event;
	const rateLimitError = readProviderRateLimitError(event.message);
	if (!rateLimitError) return event;
	return { ...event, message: { ...event.message, error: rateLimitError.rateLimit } };
}

function isMessageEnd(event: { type: string }): event is MessageEndEvent {
	return event.type === "message_end" && "message" in event;
}

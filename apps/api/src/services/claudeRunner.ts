import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../lib/logger";

export const CLAUDE_MODEL = "claude-sonnet-5" as const;
export const CLAUDE_MAX_TOKENS = 8192;
/** A call is aborted when Claude sends nothing at all for this long. */
export const CLAUDE_IDLE_TIMEOUT_MS = 60_000;

export type ClaudeTextRunner = (
  input: string,
  timeoutMs: number,
) => Promise<string>;

let client: Anthropic | null = null;

function getClient(apiKey: string): Anthropic {
  if (!client || client.apiKey !== apiKey) {
    client = new Anthropic({ apiKey, maxRetries: 1 });
  }
  return client;
}

/**
 * Sends a single prompt to Claude and returns the text of the reply.
 *
 * The reply is streamed, so long answers (full articles) keep the connection
 * active while they are being written. A call fails when Claude stays silent
 * for `idleTimeoutMs`, or when it takes longer than `timeoutMs` in total.
 *
 * Failures are reduced to a small set of safe error codes so that API
 * responses never contain the API key or an unfiltered provider error:
 * `missing_key`, `invalid_key`, `claude_timeout` and `claude_api_error`.
 */
export async function defaultClaudeTextRunner(
  input: string,
  timeoutMs: number,
  idleTimeoutMs: number = CLAUDE_IDLE_TIMEOUT_MS,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("missing_key");

  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => {
    timedOut = true;
    controller.abort();
  };
  const totalTimer = setTimeout(abort, timeoutMs);
  let idleTimer = setTimeout(abort, Math.min(idleTimeoutMs, timeoutMs));
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(abort, Math.min(idleTimeoutMs, timeoutMs));
  };

  try {
    const stream = getClient(apiKey).messages.stream(
      {
        model: CLAUDE_MODEL,
        max_tokens: CLAUDE_MAX_TOKENS,
        messages: [{ role: "user", content: input }],
      },
      { signal: controller.signal, timeout: timeoutMs },
    );
    stream.on("streamEvent", resetIdleTimer);
    const result = await stream.finalMessage();

    logger.info(
      {
        durationMs: Date.now() - startedAt,
        outputTokens: result.usage.output_tokens,
        stopReason: result.stop_reason,
      },
      "Claude call completed",
    );
    const textBlock = result.content.find((block) => block.type === "text");
    return textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
  } catch (error) {
    const code =
      error instanceof Anthropic.AuthenticationError
        ? "invalid_key"
        : timedOut ||
            error instanceof Anthropic.APIConnectionTimeoutError ||
            (error instanceof Error && error.name === "TimeoutError")
          ? "claude_timeout"
          : "claude_api_error";
    logger.warn(
      {
        durationMs: Date.now() - startedAt,
        code,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        status: error instanceof Anthropic.APIError ? error.status : undefined,
      },
      "Claude call failed",
    );
    throw new Error(code);
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(idleTimer);
  }
}

import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../lib/logger";

export const CLAUDE_MODEL = "claude-sonnet-5" as const;
export const CLAUDE_MAX_TOKENS = 32000;
/** A call is aborted when Claude sends nothing at all for this long. */
export const CLAUDE_IDLE_TIMEOUT_MS = 60_000;
/**
 * Before the first word Claude may need longer: it first reads the whole
 * prompt, which for a large website is tens of thousands of words.
 */
export const CLAUDE_FIRST_EVENT_TIMEOUT_MS = 150_000;
/** Pass as `timeoutMs` to wait for Claude as long as it takes (no timers). */
export const NO_TIME_LIMIT = 0;
/** The SDK needs a number; with no limit we give it one hour. */
const SDK_MAX_WAIT_MS = 60 * 60_000;

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
  const limited = timeoutMs > 0;
  const totalTimer = limited ? setTimeout(abort, timeoutMs) : undefined;
  let idleTimer = limited
    ? setTimeout(abort, Math.min(Math.max(idleTimeoutMs, CLAUDE_FIRST_EVENT_TIMEOUT_MS), timeoutMs))
    : undefined;
  let firstEventMs: number | null = null;
  const resetIdleTimer = () => {
    if (firstEventMs === null) firstEventMs = Date.now() - startedAt;
    clearTimeout(idleTimer);
    if (limited) idleTimer = setTimeout(abort, Math.min(idleTimeoutMs, timeoutMs));
  };

  try {
    const stream = getClient(apiKey).messages.stream(
      {
        model: CLAUDE_MODEL,
        max_tokens: CLAUDE_MAX_TOKENS,
        messages: [{ role: "user", content: input }],
      },
      { signal: controller.signal, timeout: limited ? timeoutMs : SDK_MAX_WAIT_MS },
    );
    stream.on("streamEvent", resetIdleTimer);
    const result = await stream.finalMessage();

    logger.info(
      {
        durationMs: Date.now() - startedAt,
        firstEventMs,
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
        firstEventMs,
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

/**
 * One Claude call with images (screenshots) and a text prompt; returns the text
 * of the reply. Used where the AI must really look at a page.
 */
export async function claudeWithImages(prompt: string, imagesJpegBase64: string[], maxTokens = 4000): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("missing_key");
  const result = await getClient(apiKey).messages.create(
    {
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      messages: [{
        role: "user",
        content: [
          ...imagesJpegBase64.map((data) => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data } })),
          { type: "text" as const, text: prompt },
        ],
      }],
    },
    { timeout: 180_000 },
  );
  const block = result.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text.trim() : "";
}

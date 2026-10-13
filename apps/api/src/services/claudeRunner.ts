import Anthropic from "@anthropic-ai/sdk";

export const CLAUDE_MODEL = "claude-sonnet-5" as const;
export const CLAUDE_MAX_TOKENS = 8192;

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
 * Failures are reduced to a small set of safe error codes so that API
 * responses never contain the API key or an unfiltered provider error:
 * `missing_key`, `invalid_key`, `claude_timeout` and `claude_api_error`.
 */
export async function defaultClaudeTextRunner(
  input: string,
  timeoutMs: number,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("missing_key");

  try {
    const result = await getClient(apiKey).messages.create(
      {
        model: CLAUDE_MODEL,
        max_tokens: CLAUDE_MAX_TOKENS,
        messages: [{ role: "user", content: input }],
      },
      // The caller decides how long a call may take (articles need much longer
      // than short profile drafts), so the same limit applies to the request.
      { timeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs) },
    );
    const textBlock = result.content.find((block) => block.type === "text");
    return textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new Error("invalid_key");
    if (
      error instanceof Anthropic.APIConnectionTimeoutError ||
      error instanceof Anthropic.APIUserAbortError ||
      (error instanceof Error && error.name === "TimeoutError")
    ) {
      throw new Error("claude_timeout");
    }
    throw new Error("claude_api_error");
  }
}

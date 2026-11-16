/** True when the code runs on Cloudflare Workers instead of a Node server. */
export const RUNS_ON_WORKERS =
  typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

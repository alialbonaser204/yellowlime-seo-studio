// Minimal types for the Cloudflare runtime modules used by src/worker.ts.
declare module "cloudflare:node" {
  export function httpServerHandler(options: { port: number }): unknown;
}
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}

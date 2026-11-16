import { env } from "cloudflare:workers";

// The code reads settings from process.env, like on a Node server. Copy the
// Worker's variables and secrets there (text values only; bindings such as
// HYPERDRIVE stay on `env`).
for (const [name, value] of Object.entries(env)) {
  if (typeof value === "string" && process.env[name] === undefined) process.env[name] = value;
}

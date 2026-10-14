export * from "./generated/api";
export * from "./generated/types";
// Orval names both the path-parameter schema (api) and the query-parameter
// type (types) after the operation; the zod schema is the one the API uses.
export { GetPartnerSearchConsoleParams } from "./generated/api";

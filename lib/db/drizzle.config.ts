import { defineConfig } from "drizzle-kit";
import fs from "fs";
import path from "path";

// Load DATABASE_URL from the project's .env file when it exists.
const envFile = path.resolve(__dirname, "../../.env");
if (!process.env.DATABASE_URL && fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Add it to .env or the environment.");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});

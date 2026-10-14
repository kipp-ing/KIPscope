import { resolve } from "node:path";
import { REPO_ROOT } from "../src/config.ts";

try {
  process.loadEnvFile(resolve(REPO_ROOT, ".env"));
} catch {
  // No .env: the test DB defaults in testdb.ts apply.
}

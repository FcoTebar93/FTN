import { existsSync } from "node:fs";
import { join } from "node:path";

const specPath = join(process.cwd(), "docs", "api", "openapi.json");
if (!existsSync(specPath)) {
  console.error("Missing OpenAPI spec:", specPath);
  process.exit(1);
}
console.log("OpenAPI spec present:", specPath);
process.exit(0);

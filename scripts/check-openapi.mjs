import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

const specPath = join(process.cwd(), "docs", "api", "openapi.json");
if (!existsSync(specPath)) {
  console.error("Missing OpenAPI spec:", specPath);
  process.exit(1);
}

let raw;
try {
  raw = await readFile(specPath, "utf8");
} catch (err) {
  console.error("Failed to read OpenAPI spec:", err);
  process.exit(1);
}

let spec;
try {
  spec = JSON.parse(raw);
} catch (err) {
  console.error("OpenAPI spec is not valid JSON:", err);
  process.exit(1);
}

const errors = [];
if (!spec || typeof spec !== "object") {
  errors.push("Root document must be an object.");
} else {
  if (typeof spec.openapi !== "string" || !spec.openapi.startsWith("3.")) {
    errors.push("Field 'openapi' must exist and be 3.x.");
  }
  if (!spec.info || typeof spec.info !== "object") {
    errors.push("Field 'info' must exist.");
  } else {
    if (typeof spec.info.title !== "string" || spec.info.title.trim() === "") {
      errors.push("Field 'info.title' must be a non-empty string.");
    }
    if (typeof spec.info.version !== "string" || spec.info.version.trim() === "") {
      errors.push("Field 'info.version' must be a non-empty string.");
    }
  }
  if (!spec.paths || typeof spec.paths !== "object") {
    errors.push("Field 'paths' must exist and be an object.");
  } else {
    const requiredPaths = ["/health", "/ready", "/workflows", "/auth/login", "/openapi.json"];
    for (const p of requiredPaths) {
      if (!(p in spec.paths)) {
        errors.push(`Missing required path: ${p}`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error("OpenAPI validation failed:");
  for (const e of errors) {
    console.error("-", e);
  }
  process.exit(1);
}

console.log("OpenAPI spec looks valid:", specPath);

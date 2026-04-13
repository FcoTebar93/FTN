import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(__dirname, "../src/infra/main.ts");
let s = fs.readFileSync(p, "utf8");
s = s.replace(/\r\n/g, "\n");

const start = s.indexOf("    try {\n      if (!req.url || !req.method)");
const end = s.indexOf("\n    } catch (err) {", start);
if (start < 0 || end < 0) {
  console.error("markers not found", { start, end });
  process.exit(1);
}

const rep = `    try {
      await handleAppRoutes(
        {
          pool,
          apiSecurity,
          hasDbLogin,
          refreshTtlSeconds,
          requestSubject,
          activities,
          runtime,
          eventStore,
          taskQueue,
          redis,
          enqueueWorkflowStart,
          getIntegrationsStatusForSubject,
        },
        req,
        res
      );
    }`;

s = s.slice(0, start) + rep + s.slice(end);
fs.writeFileSync(p, s.replace(/\n/g, "\r\n"));
console.log("patched main.ts");

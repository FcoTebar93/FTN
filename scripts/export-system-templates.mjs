import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mod = await import(pathToFileURL(join(root, "frontend/src/features/designer/templates.ts")).href);
const out = mod.WORKFLOW_TEMPLATES.map((tpl) => ({
  id: tpl.id,
  label: tpl.label,
  description: tpl.description,
  requiredActivities: tpl.requiredActivities,
  payload: tpl.build(),
}));
const outDir = join(root, "src/app/data");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "system-workflow-templates.json"), JSON.stringify(out, null, 2));
console.log(`Wrote ${out.length} templates`);

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
console.log(`FTN package version: ${pkg.version}`);
console.log("Recuerda: ante cambios breaking en definiciones o actividades, sube la version del workflow o crea un name nuevo.");

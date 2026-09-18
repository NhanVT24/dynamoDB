import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distSrc = join(__dirname, "..", "dist", "src");

rmSync(distSrc, { recursive: true, force: true });

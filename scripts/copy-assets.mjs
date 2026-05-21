import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceLogo = resolve(rootDir, "src/public/logo.png");
const targetLogo = resolve(rootDir, "dist/public/logo.png");

if (!existsSync(sourceLogo)) {
  console.warn(`[copy-assets] source not found: ${sourceLogo}`);
  process.exit(0);
}

mkdirSync(dirname(targetLogo), { recursive: true });
copyFileSync(sourceLogo, targetLogo);
console.log(`[copy-assets] copied ${sourceLogo} -> ${targetLogo}`);

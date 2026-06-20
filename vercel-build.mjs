/**
 * Vercel build script — sets NITRO_PRESET=vercel before running vite build
 * so Nitro outputs to .vercel/output (which Vercel auto-detects).
 */
import { execSync } from "node:child_process";

process.env.NITRO_PRESET = "vercel";
console.log("[vercel-build] NITRO_PRESET =", process.env.NITRO_PRESET);

execSync("npx vite build", {
  stdio: "inherit",
  env: { ...process.env, NITRO_PRESET: "vercel" },
});

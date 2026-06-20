/**
 * Custom Vercel build script for TanStack Start
 * Builds the app then creates proper .vercel/output structure
 */
import { execSync } from "node:child_process";
import fs from "node:fs";

// 1. Run vite build
console.log("▶ Building...");
execSync("npx vite build", { stdio: "inherit" });

// 2. Set up .vercel/output
const out = ".vercel/output";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(`${out}/functions/index.func`, { recursive: true });
fs.mkdirSync(`${out}/static`, { recursive: true });

// 3. Static files → .vercel/output/static
fs.cpSync("dist/client", `${out}/static`, { recursive: true });

// 4. Server bundle → .vercel/output/functions/index.func
fs.cpSync("dist/server", `${out}/functions/index.func`, { recursive: true });

// 5. Function config — server.js exports default fetch handler (Web Fetch API)
fs.writeFileSync(`${out}/functions/index.func/.vc-config.json`, JSON.stringify({
  runtime: "nodejs20.x",
  handler: "server.js",
  launchMode: "server"
}, null, 2));

// 6. Vercel output config — static assets served directly, everything else → function
fs.writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    {
      src: "^/assets/(.+)$",
      headers: { "cache-control": "public,max-age=31536000,immutable" },
      continue: true
    },
    { handle: "filesystem" },
    { src: "/(.*)", dest: "/" }
  ]
}, null, 2));

console.log("✓ Done — .vercel/output ready");

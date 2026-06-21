import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const esbuild = path.join(__dirname, "node_modules/vite/node_modules/esbuild/bin/esbuild");

// Node built-ins to keep external (everything else gets bundled in)
const nodeExternals = [
  "crypto","fs","path","os","stream","http","https","net","tls",
  "events","buffer","util","url","zlib","child_process","worker_threads",
  "async_hooks","perf_hooks","readline","string_decoder","timers",
  "vm","assert","constants","module","process",
].map(m => `--external:node:${m} --external:${m}`).join(" ");

// 1. Vite build
console.log("▶ Building with Vite...");
execSync("npx vite build", { stdio: "inherit" });

// 2. Re-bundle with esbuild → single self-contained file
console.log("▶ Re-bundling server with esbuild...");
execSync(
  `"${esbuild}" dist/server/server.js --bundle --platform=node --format=esm --outfile=dist/server/server-bundle.mjs --allow-overwrite ${nodeExternals} --log-level=warning`,
  { stdio: "inherit", shell: true }
);
console.log(`   Size: ${(fs.statSync("dist/server/server-bundle.mjs").size/1024/1024).toFixed(2)} MB`);

// 3. Set up .vercel/output
const out = ".vercel/output";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(`${out}/functions/index.func`, { recursive: true });
fs.mkdirSync(`${out}/static`, { recursive: true });

// 4. Static assets
fs.cpSync("dist/client", `${out}/static`, { recursive: true });

// 5. Only the bundle — no node_modules needed
fs.copyFileSync("dist/server/server-bundle.mjs", `${out}/functions/index.func/server-bundle.mjs`);
fs.writeFileSync(`${out}/functions/index.func/package.json`, JSON.stringify({ type: "module" }, null, 2));

// 6. Node.js adapter wrapping the fetch handler
fs.writeFileSync(`${out}/functions/index.func/_handler.mjs`, `
import server from "./server-bundle.mjs";
export default async function handler(req, res) {
  try {
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host  = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
    const url   = new URL(req.url, proto + "://" + host);
    const chunks = [];
    await new Promise((ok, fail) => { req.on("data",c=>chunks.push(c)); req.on("end",ok); req.on("error",fail); });
    const headers = new Headers();
    for (const [k,v] of Object.entries(req.headers)) if (v) headers.set(k, Array.isArray(v)?v.join(", "):v);
    const webReq = new Request(url.toString(), {
      method: req.method, headers,
      body: ["GET","HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
      duplex: "half",
    });
    const webRes = await server.fetch(webReq);
    res.statusCode = webRes.status;
    webRes.headers.forEach((v,k) => res.setHeader(k,v));
    res.end(Buffer.from(await webRes.arrayBuffer()));
  } catch(err) {
    console.error("[ssr]", err);
    res.statusCode = 500;
    res.end("Internal Server Error: " + err.message);
  }
}
`);

// 7. Vercel function + routing config
fs.writeFileSync(`${out}/functions/index.func/.vc-config.json`, JSON.stringify({
  runtime: "nodejs20.x", handler: "_handler.mjs", maxDuration: 30
}, null, 2));

fs.writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: "^/assets/(.+)$", headers: { "cache-control": "public,max-age=31536000,immutable" }, continue: true },
    { handle: "filesystem" },
    { src: "/(.*)", dest: "/" }
  ]
}, null, 2));

console.log("✓ .vercel/output ready");

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const esbuild = path.join(__dirname, "node_modules/vite/node_modules/esbuild/bin/esbuild");

// 1. Vite build
console.log("▶ Building with Vite...");
execSync("npx vite build", { stdio: "inherit" });

// 2. Re-bundle as CJS — react-dom uses require() internally so ESM output breaks.
//    CJS format handles mixed ESM+CJS packages correctly.
console.log("▶ Re-bundling server with esbuild (CJS)...");
execSync(
  `"${esbuild}" dist/server/server.js --bundle --platform=node --format=cjs --outfile=dist/server/server-bundle.cjs --allow-overwrite --log-level=warning`,
  { stdio: "inherit", shell: true }
);
console.log(`   Size: ${(fs.statSync("dist/server/server-bundle.cjs").size/1024/1024).toFixed(2)} MB`);

// 3. Set up .vercel/output
const out = ".vercel/output";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(`${out}/functions/index.func`, { recursive: true });
fs.mkdirSync(`${out}/static`, { recursive: true });

// 4. Static assets
fs.cpSync("dist/client", `${out}/static`, { recursive: true });

// 5. CJS bundle into function (no node_modules needed — everything is inlined)
fs.copyFileSync("dist/server/server-bundle.cjs", `${out}/functions/index.func/server-bundle.cjs`);

// Also copy ws since it's loaded dynamically (not bundled by esbuild)
const wsDir = `${out}/functions/index.func/node_modules/ws`;
fs.mkdirSync(wsDir, { recursive: true });
fs.cpSync("node_modules/ws", wsDir, { recursive: true });

// 6. No "type":"module" — CJS doesn't need it
fs.writeFileSync(`${out}/functions/index.func/package.json`, JSON.stringify({}), null, 2);

// 7. Handler — import CJS bundle then adapt fetch → Node.js http
fs.writeFileSync(`${out}/functions/index.func/_handler.js`, `
const server = require("./server-bundle.cjs");
const s = server.default || server;

module.exports = async function handler(req, res) {
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

    const webRes = await s.fetch(webReq);
    res.statusCode = webRes.status;
    webRes.headers.forEach((v,k) => res.setHeader(k,v));
    res.end(Buffer.from(await webRes.arrayBuffer()));
  } catch(err) {
    console.error("[ssr]", err);
    res.statusCode = 500;
    res.end("Internal Server Error: " + err.message);
  }
};
`);

// 8. Function config — CJS handler, no ESM needed
fs.writeFileSync(`${out}/functions/index.func/.vc-config.json`, JSON.stringify({
  runtime: "nodejs20.x",
  handler: "_handler.js",
  maxDuration: 30
}, null, 2));

// 9. Routing
fs.writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: "^/assets/(.+)$", headers: { "cache-control": "public,max-age=31536000,immutable" }, continue: true },
    { handle: "filesystem" },
    { src: "/(.*)", dest: "/" }
  ]
}, null, 2));

console.log("✓ .vercel/output ready");

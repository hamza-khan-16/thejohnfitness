import { execSync } from "node:child_process";
import fs from "node:fs";

// 1. Build
console.log("▶ Building...");
execSync("npx vite build", { stdio: "inherit" });

// 2. Create .vercel/output structure
const out = ".vercel/output";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(`${out}/functions/index.func/node_modules`, { recursive: true });
fs.mkdirSync(`${out}/static`, { recursive: true });

// 3. Static files
fs.cpSync("dist/client", `${out}/static`, { recursive: true });

// 4. Server bundle
fs.cpSync("dist/server", `${out}/functions/index.func`, { recursive: true });

// 5. Copy the external packages the server bundle needs at runtime.
//    These can't be npm installed (h3-v2 is a local prerelease, not on npm).
const runtimePackages = ["h3-v2", "seroval", "h3"];
for (const pkg of runtimePackages) {
  const src = `node_modules/${pkg}`;
  const dest = `${out}/functions/index.func/node_modules/${pkg}`;
  if (fs.existsSync(src)) {
    console.log(`▶ Copying ${pkg}...`);
    fs.cpSync(src, dest, { recursive: true });
  }
}

// 6. package.json with type:module (no dependencies — we copied them manually)
fs.writeFileSync(`${out}/functions/index.func/package.json`, JSON.stringify({
  type: "module"
}, null, 2));

// 7. Node.js adapter
fs.writeFileSync(`${out}/functions/index.func/_handler.mjs`, `
import server from "./server.js";

export default async function handler(req, res) {
  try {
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host  = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
    const url   = new URL(req.url, proto + "://" + host);

    const chunks = [];
    await new Promise((resolve, reject) => {
      req.on("data", c => chunks.push(c));
      req.on("end", resolve);
      req.on("error", reject);
    });

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    }

    const webReq = new Request(url.toString(), {
      method: req.method,
      headers,
      body: ["GET","HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
      duplex: "half",
    });

    const webRes = await server.fetch(webReq);
    res.statusCode = webRes.status;
    webRes.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await webRes.arrayBuffer()));
  } catch (err) {
    console.error("[ssr]", err);
    res.statusCode = 500;
    res.end("Internal Server Error: " + err.message);
  }
}
`);

// 8. Function config
fs.writeFileSync(`${out}/functions/index.func/.vc-config.json`, JSON.stringify({
  runtime: "nodejs20.x",
  handler: "_handler.mjs",
  maxDuration: 30
}, null, 2));

// 9. Routing
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

console.log("✓ .vercel/output ready");

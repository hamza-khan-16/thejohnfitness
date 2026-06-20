import { execSync } from "node:child_process";
import fs from "node:fs";

// 1. Build
console.log("▶ Building...");
execSync("npx vite build", { stdio: "inherit" });

// 2. Create .vercel/output structure
const out = ".vercel/output";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(`${out}/functions/index.func`, { recursive: true });
fs.mkdirSync(`${out}/static`, { recursive: true });

// 3. Static files
fs.cpSync("dist/client", `${out}/static`, { recursive: true });

// 4. Server bundle
fs.cpSync("dist/server", `${out}/functions/index.func`, { recursive: true });

// 5. Node.js adapter — converts Web Fetch handler → Node.js http handler
//    server.js exports { default: { fetch(request) => Response } }
fs.writeFileSync(`${out}/functions/index.func/_node_handler.js`, `
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
    const body = chunks.length ? Buffer.concat(chunks) : undefined;

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    }

    const webReq = new Request(url.toString(), {
      method:  req.method,
      headers,
      body: ["GET","HEAD"].includes(req.method) ? undefined : body,
      duplex: "half",
    });

    const webRes = await server.fetch(webReq);

    res.statusCode = webRes.status;
    webRes.headers.forEach((v, k) => res.setHeader(k, v));

    const buf = await webRes.arrayBuffer();
    res.end(Buffer.from(buf));
  } catch (err) {
    console.error("[handler]", err);
    res.statusCode = 500;
    res.end("Internal Server Error");
  }
}
`);

// 6. Function config pointing to the Node.js adapter
fs.writeFileSync(`${out}/functions/index.func/.vc-config.json`, JSON.stringify({
  runtime: "nodejs20.x",
  handler: "_node_handler.js",
  maxDuration: 30
}, null, 2));

// 7. Output routing config
fs.writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    // Cache static assets permanently
    {
      src: "^/assets/(.+)$",
      headers: { "cache-control": "public,max-age=31536000,immutable" },
      continue: true
    },
    // Serve static files from dist/client if they exist
    { handle: "filesystem" },
    // Everything else → SSR function
    { src: "/(.*)", dest: "/" }
  ]
}, null, 2));

console.log("✓ .vercel/output ready");

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const API_ORIGIN = process.env.API_ORIGIN || "http://localhost:8067";
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon"
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function resolveFilePath(urlPathname) {
  const relative = urlPathname === "/" ? "/index.html" : urlPathname;
  const safePath = path.normalize(relative).replace(/^\.\.(\/|\\|$)/, "");
  return path.join(PUBLIC_DIR, safePath);
}

function serveStatic(req, res, pathname) {
  const filePath = resolveFilePath(pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 400, { error: "Invalid path" });
    return;
  }

  fs.stat(filePath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  });
}

function proxyApi(req, res, parsedUrl) {
  const targetUrl = new URL(parsedUrl.pathname + parsedUrl.search, API_ORIGIN);
  const isHttps = targetUrl.protocol === "https:";
  const transport = isHttps ? https : http;

  const options = {
    protocol: targetUrl.protocol,
    hostname: targetUrl.hostname,
    port: targetUrl.port || (isHttps ? 443 : 80),
    method: req.method,
    path: targetUrl.pathname + targetUrl.search,
    headers: {
      ...req.headers,
      host: targetUrl.host
    }
  };

  const proxyReq = transport.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, {
      ...proxyRes.headers,
      "Access-Control-Allow-Origin": "*"
    });
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (error) => {
    sendJson(res, 502, {
      error: "Gateway request failed",
      message: error.message
    });
  });

  if (req.method === "GET" || req.method === "HEAD") {
    proxyReq.end();
    return;
  }

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url || "/", `http://${req.headers.host}`);

  if (parsedUrl.pathname.startsWith("/api/")) {
    proxyApi(req, res, parsedUrl);
    return;
  }

  if (parsedUrl.pathname === "/openapi.json") {
    const targetUrl = new URL("/openapi.json", API_ORIGIN);
    const transport = targetUrl.protocol === "https:" ? https : http;
    const proxyReq = transport.request(targetUrl, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on("error", () => sendJson(res, 502, { error: "Cannot fetch OpenAPI spec" }));
    proxyReq.end();
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res, parsedUrl.pathname);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
});

server.listen(PORT, () => {
  console.log(`Bus SG app is running at http://localhost:${PORT}`);
  console.log(`Proxying API requests to ${API_ORIGIN}`);
});

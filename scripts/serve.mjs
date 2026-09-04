import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_DIRECTORY = resolve(fileURLToPath(new URL("../public/", import.meta.url)));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "127.0.0.1";
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  response.end(body);
}

const server = createServer(async (request, response) => {
  if (!request.url || !["GET", "HEAD"].includes(request.method || "")) {
    sendText(response, 405, "Method Not Allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname);
  } catch {
    sendText(response, 400, "Bad Request");
    return;
  }

  if (pathname.endsWith("/")) pathname += "index.html";
  const filePath = resolve(PUBLIC_DIRECTORY, pathname.replace(/^\/+/, ""));
  if (filePath !== PUBLIC_DIRECTORY && !filePath.startsWith(`${PUBLIC_DIRECTORY}${sep}`)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const file = await stat(filePath);
    if (!file.isFile()) throw new Error("not a file");
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-length": file.size,
      "content-type": MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, "Not Found");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Repertuar: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
});

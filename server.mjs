import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));
loadEnv(join(rootDir, ".env"));
const port = Number(process.env.PORT || 8787);
const mimeTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function consultarPerformance(url, response) {
  const endpoint = process.env.SUPABASE_FUNCAO_PERFORMANCE_URL?.trim();
  if (!endpoint) return sendJson(response, 503, { erro: "Configure SUPABASE_FUNCAO_PERFORMANCE_URL no arquivo .env após publicar as Edge Functions." });
  const remoto = new URL(endpoint);
  for (const key of ["inicio", "fim", "squad", "pessoa"]) {
    const value = url.searchParams.get(key);
    if (value) remoto.searchParams.set(key, value);
  }
  try {
    const resultado = await fetch(remoto, { headers: { Accept: "application/json" } });
    const body = await resultado.json().catch(() => ({ erro: "Resposta inválida da função de indicadores." }));
    return sendJson(response, resultado.status, body);
  } catch { return sendJson(response, 502, { erro: "Não foi possível alcançar a função de indicadores do Supabase." }); }
}

async function servirArquivo(pathname, response) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const publicDir = resolve(rootDir, "public");
  const filePath = resolve(publicDir, `.${normalize(requested)}`);
  if (!filePath.startsWith(publicDir)) return sendJson(response, 404, { erro: "Não encontrado." });
  try {
    if (!(await stat(filePath)).isFile()) return sendJson(response, 404, { erro: "Não encontrado." });
    response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream", "Cache-Control": "no-cache" });
    response.end(await readFile(filePath));
  } catch { return sendJson(response, 404, { erro: "Não encontrado." }); }
}

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && url.pathname === "/api/performance") return consultarPerformance(url, response);
  if (request.method === "GET") return servirArquivo(url.pathname, response);
  return sendJson(response, 405, { erro: "Método não permitido." });
}).listen(port, () => console.log(`Dashboard de performance disponível em http://localhost:${port}`));

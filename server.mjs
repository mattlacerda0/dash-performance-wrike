import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { criarArquivoTarefas } from "./lib/exportar-tarefas.mjs";

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

async function carregarPerformance(url) {
  const endpoint = process.env.SUPABASE_FUNCAO_PERFORMANCE_URL?.trim();
  if (!endpoint) return { status: 503, body: { erro: "Configure SUPABASE_FUNCAO_PERFORMANCE_URL no arquivo .env após publicar as Edge Functions." } };
  const remoto = new URL(endpoint);
  for (const key of ["inicio", "fim", "squad", "pessoa"]) {
    const value = url.searchParams.get(key);
    if (value) remoto.searchParams.set(key, value);
  }
  try {
    const resultado = await fetch(remoto, { headers: { Accept: "application/json" } });
    const body = await resultado.json().catch(() => ({ erro: "Resposta inválida da função de indicadores." }));
    return { status: resultado.status, body };
  } catch { return { status: 502, body: { erro: "Não foi possível alcançar a função de indicadores do Supabase." } }; }
}

async function consultarPerformance(url, response) {
  const resultado = await carregarPerformance(url);
  return sendJson(response, resultado.status, resultado.body);
}

function configuracaoWrike() {
  const token = process.env.WRIKE_ACCESS_TOKEN?.trim();
  const host = (process.env.WRIKE_API_HOST || "www.wrike.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const espaco = process.env.WRIKE_ESPACO_ID?.trim();
  const bruto = process.env.WRIKE_FOLDER_IDS?.trim() || "";
  let pastas = bruto.split(",").map((id) => id.trim()).filter(Boolean);
  try { const json = JSON.parse(bruto); if (Array.isArray(json)) pastas = json.map(String).map((id) => id.trim()).filter(Boolean); } catch { /* aceita lista separada por vírgulas */ }
  if (!token || (!espaco && !pastas.length)) throw new Error("A extração exige WRIKE_ACCESS_TOKEN e WRIKE_ESPACO_ID ou WRIKE_FOLDER_IDS no .env local.");
  return { token, base: `https://${host}/api/v4`, espaco, pastas };
}

async function consultarWrike(caminho, parametros = {}) {
  const { token, base } = configuracaoWrike();
  const url = new URL(`${base}${caminho}`);
  for (const [chave, valor] of Object.entries(parametros)) if (valor) url.searchParams.set(chave, valor);
  const resposta = await fetch(url, { headers: { Authorization: `bearer ${token}`, Accept: "application/json" } });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.errorDescription || "O Wrike recusou a extração das tarefas.");
  return corpo;
}

async function buscarTarefasWrike() {
  const { espaco, pastas } = configuracaoWrike();
  const tarefas = new Map();
  const campos = ["customFields", "responsibleIds", "parentIds", "superParentIds", "description", "briefDescription", "metadata", "authorIds", "followerIds", "sharedIds", "dependencyIds", "attachmentCount", "hasAttachments", "subTaskIds", "superTaskIds", "customItemTypeId"];
  const escopos = espaco ? [{ caminho: `/spaces/${encodeURIComponent(espaco)}/tasks` }] : pastas.map((pasta) => ({ caminho: `/folders/${encodeURIComponent(pasta)}/tasks` }));
  for (const escopo of escopos) {
    let pagina = "";
    do {
      const corpo = await consultarWrike(escopo.caminho, { descendants: "true", pageSize: "1000", fields: JSON.stringify(campos), nextPageToken: pagina });
      for (const tarefa of corpo.data || []) tarefas.set(tarefa.id, tarefa);
      pagina = corpo.nextPageToken || "";
    } while (pagina);
  }
  return [...tarefas.values()];
}

async function buscarContatosWrike(ids) {
  const contatos = new Map();
  for (let inicio = 0; inicio < ids.length; inicio += 1000) {
    const lote = ids.slice(inicio, inicio + 1000);
    if (!lote.length) continue;
    const corpo = await consultarWrike(`/contacts/${lote.map(encodeURIComponent).join(",")}`);
    for (const contato of corpo.data || []) contatos.set(contato.id, contato);
  }
  return contatos;
}

function textoPlanilha(valor) {
  if (valor == null) return "";
  let texto = typeof valor === "string" ? valor : Array.isArray(valor) ? valor.join(", ") : JSON.stringify(valor);
  try { const json = JSON.parse(texto); texto = Array.isArray(json) ? json.join(", ") : typeof json === "object" ? JSON.stringify(json) : String(json); } catch { /* texto simples */ }
  texto = String(texto).slice(0, 32767);
  return /^[=+\-@]/.test(texto) ? `'${texto}` : texto;
}

function dataPlanilha(valor) {
  if (!valor) return "";
  const data = new Date(valor);
  return Number.isNaN(data.valueOf()) ? textoPlanilha(valor) : data;
}

function nomesContatos(ids, contatos) {
  return (ids || []).map((id) => {
    const contato = contatos.get(id);
    const nome = contato ? [contato.firstName, contato.lastName].filter(Boolean).join(" ") || contato.email : "";
    return nome ? `${nome} (${id})` : id;
  }).join(", ");
}

async function exportarTarefas(url, response) {
  try {
    const escopo = url.searchParams.get("escopo") === "qualidade" ? "qualidade" : "todas";
    const resultado = await criarArquivoTarefas(process.env, escopo);
    response.writeHead(200, { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${resultado.nome}"`, "Cache-Control": "no-store" });
    response.end(resultado.arquivo);
  } catch (error) {
    return sendJson(response, 500, { erro: error instanceof Error ? error.message : "Não foi possível extrair as tarefas do Wrike." });
  }
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
  if (request.method === "GET" && (url.pathname === "/api/exportar-tarefas" || url.pathname === "/api/exportar-tarefas.xlsx")) return exportarTarefas(url, response);
  if (request.method === "GET") return servirArquivo(url.pathname, response);
  return sendJson(response, 405, { erro: "Método não permitido." });
}).listen(port, () => console.log(`Dashboard de performance disponível em http://localhost:${port}`));

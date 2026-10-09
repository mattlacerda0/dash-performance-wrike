import { banco } from "../_shared/supabase.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

function hexadecimal(bytes: ArrayBuffer) { return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function hmac(valor: string, segredo: string) {
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hexadecimal(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(valor)));
}
function tempoSeguro(a: string, b: string) {
  if (a.length !== b.length) return false;
  let resultado = 0; for (let indice = 0; indice < a.length; indice += 1) resultado |= a.charCodeAt(indice) ^ b.charCodeAt(indice);
  return resultado === 0;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ erro: "Método não permitido." }, 405);
  const segredo = Deno.env.get("WRIKE_WEBHOOK_SECRET");
  if (!segredo) return jsonResponse({ erro: "WRIKE_WEBHOOK_SECRET não configurado." }, 503);
  const corpoTexto = await request.text();
  const corpo = JSON.parse(corpoTexto || "{}");
  const assinatura = request.headers.get("x-hook-signature") || "";
  const esperada = await hmac(corpoTexto, segredo);
  if (!tempoSeguro(assinatura.toLowerCase(), esperada.toLowerCase())) return jsonResponse({ erro: "Assinatura inválida." }, 401);
  const desafio = request.headers.get("x-hook-secret");
  if (corpo.requestType === "WebHook secret verification") {
    if (!desafio || desafio.length > 100 || /[{}\[\]]/.test(desafio)) return jsonResponse({ erro: "Desafio inválido." }, 400);
    return new Response(null, { status: 200, headers: { "X-Hook-Secret": await hmac(desafio, segredo) } });
  }
  const chave = await hmac(`${corpo.taskId || corpo.folderId || "sem-id"}:${corpo.eventType || "evento"}:${corpo.lastUpdatedDate || corpoTexto}`, segredo);
  try {
    await banco("eventos_wrike?on_conflict=chave_idempotencia", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ chave_idempotencia: chave, tipo_evento: corpo.eventType || "evento", corpo, processado_em: new Date().toISOString() }) });
    const itens = await banco(`itens_trabalho?select=id&id_wrike=eq.${encodeURIComponent(corpo.taskId || "")}`) as Array<{ id: number }>;
    if (itens[0] && corpo.eventType === "TaskStatusChanged") await banco("historico_status_itens", { method: "POST", body: JSON.stringify({ id_item_trabalho: itens[0].id, id_status_anterior: corpo.oldCustomStatusId || null, nome_status_anterior: corpo.oldStatus || null, id_status_novo: corpo.customStatusId || null, nome_status_novo: corpo.status || null, ocorrido_em: corpo.lastUpdatedDate || new Date().toISOString(), origem: "webhook" }) });
    return jsonResponse({ recebido: true });
  } catch (error) {
    return jsonResponse({ recebido: false, erro: error instanceof Error ? error.message : "Falha ao registrar evento." }, 500);
  }
});

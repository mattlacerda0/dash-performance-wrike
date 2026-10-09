import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { configurarWebhook } from "../_shared/wrike.ts";
import { sincronizarDados } from "../_shared/sincronizar.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const segredo = Deno.env.get("WRIKE_SYNC_SECRET");
  if (!segredo) return jsonResponse({ sucesso: false, erro: "WRIKE_SYNC_SECRET não configurado." }, 503);
  if (request.headers.get("x-wrike-sync-secret") !== segredo) return jsonResponse({ sucesso: false, erro: "Não autorizado." }, 401);
  try {
    const resultado = await sincronizarDados("reconciliacao");
    const webhook = await configurarWebhook(Deno.env.get("WRIKE_ESPACO_ID") || "MQAAAAEPMI9l");
    return jsonResponse({ sucesso: true, ...resultado, webhook });
  } catch (error) {
    return jsonResponse({ sucesso: false, erro: error instanceof Error ? error.message : "Falha ao sincronizar." }, 500);
  }
});

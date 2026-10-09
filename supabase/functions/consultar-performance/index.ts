import { banco } from "../_shared/supabase.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

function dataValida(valor: string | null, padrao: string) {
  return valor && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : padrao;
}
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(request.url);
  const hoje = new Date(); const inicioPadrao = new Date(hoje); inicioPadrao.setDate(hoje.getDate() - 30);
  const inicio = dataValida(url.searchParams.get("inicio"), inicioPadrao.toISOString().slice(0, 10));
  const fim = dataValida(url.searchParams.get("fim"), hoje.toISOString().slice(0, 10));
  const idSquad = url.searchParams.get("squad"); const idPessoa = url.searchParams.get("pessoa");
  try {
    const dados = await banco("rpc/consultar_performance_wrike", { method: "POST", body: JSON.stringify({ p_inicio: inicio, p_fim: fim, p_id_squad: idSquad ? Number(idSquad) : null, p_id_pessoa: idPessoa ? Number(idPessoa) : null }) });
    return jsonResponse(dados);
  } catch (error) {
    return jsonResponse({ erro: error instanceof Error ? error.message : "Falha ao consultar indicadores." }, 500);
  }
});

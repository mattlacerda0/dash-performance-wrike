import * as XLSX from "npm:xlsx@0.18.5";
import { corsHeaders } from "../_shared/cors.ts";
import { buscarCampos, buscarContatos, requisicaoWrike } from "../_shared/wrike.ts";

const camposDaTarefa = ["customFields", "responsibleIds", "parentIds", "superParentIds", "description", "briefDescription", "metadata", "authorIds", "followerIds", "sharedIds", "dependencyIds", "attachmentCount", "hasAttachments", "subTaskIds", "superTaskIds", "customItemTypeId"];

function textoPlanilha(valor: unknown) {
  if (valor == null) return "";
  let texto = typeof valor === "string" ? valor : Array.isArray(valor) ? valor.join(", ") : JSON.stringify(valor);
  try { const json = JSON.parse(texto); texto = Array.isArray(json) ? json.join(", ") : typeof json === "object" ? JSON.stringify(json) : String(json); } catch { /* texto simples */ }
  texto = String(texto).slice(0, 32767);
  return /^[=+\-@]/.test(texto) ? `'${texto}` : texto;
}

function dataPlanilha(valor?: string) {
  if (!valor) return "";
  const data = new Date(valor);
  return Number.isNaN(data.valueOf()) ? textoPlanilha(valor) : data;
}

function valorCampo(tarefa: { customFields?: Array<{ id: string; value?: string }> }, idCampo?: string) {
  return (tarefa.customFields || []).find((campo) => campo.id === idCampo)?.value || "";
}

function listaDoCampo(valor: string) {
  if (!valor) return [];
  try { const json = JSON.parse(valor); return Array.isArray(json) ? json.map(String) : [String(json)]; } catch { return [valor]; }
}

function pendencias(tarefa: { description?: string; dates?: { due?: string }; responsibleIds?: string[]; customFields?: Array<{ id: string; value?: string }> }, campos: { okr?: string; itens?: string }) {
  const problemas = [];
  if (!tarefa.description?.trim()) problemas.push("Sem descrição");
  if (!tarefa.dates?.due) problemas.push("Sem prazo");
  if (!(tarefa.responsibleIds || []).length) problemas.push("Sem responsável");
  const okr = valorCampo(tarefa, campos.okr).trim();
  if (!okr || okr.toLowerCase() === "nenhum") problemas.push("OKR ausente ou Nenhum");
  const itens = listaDoCampo(valorCampo(tarefa, campos.itens));
  if (!itens.length) problemas.push("Itens ausente");
  if (itens.some((item) => item.trim().toLowerCase() === "outro")) problemas.push("Itens contém Outro");
  return problemas;
}

function nomes(ids: string[] | undefined, contatos: Map<string, { firstName?: string; lastName?: string; email?: string }>) {
  return (ids || []).map((id) => {
    const contato = contatos.get(id);
    const nome = contato ? [contato.firstName, contato.lastName].filter(Boolean).join(" ") || contato.email : "";
    return nome ? `${nome} (${id})` : id;
  }).join(", ");
}

async function buscarTarefas(idEspaco: string) {
  const tarefas: Array<Record<string, unknown>> = [];
  let pagina = "";
  do {
    const resposta = await requisicaoWrike(`/spaces/${encodeURIComponent(idEspaco)}/tasks`, { descendants: "true", pageSize: "1000", fields: JSON.stringify(camposDaTarefa), nextPageToken: pagina });
    tarefas.push(...(resposta.data || []));
    pagina = resposta.nextPageToken || "";
  } while (pagina);
  return tarefas;
}

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "GET") return Response.json({ erro: "Método não permitido." }, { status: 405, headers: corsHeaders });
    const idEspaco = Deno.env.get("WRIKE_ESPACO_ID");
    if (!idEspaco) return Response.json({ erro: "WRIKE_ESPACO_ID não configurado." }, { status: 503, headers: corsHeaders });
    try {
      const [tarefasOriginais, camposPersonalizados] = await Promise.all([buscarTarefas(idEspaco), buscarCampos()]);
      const porTitulo = new Map(camposPersonalizados.map((campo: { id: string; title?: string }) => [String(campo.title || "").trim().toLowerCase(), campo.id]));
      const titulos = new Map(camposPersonalizados.map((campo: { id: string; title?: string }) => [campo.id, campo.title || campo.id]));
      const comPendencias = tarefasOriginais.map((tarefa) => ({ tarefa, problemas: pendencias(tarefa as { description?: string; dates?: { due?: string }; responsibleIds?: string[]; customFields?: Array<{ id: string; value?: string }> }, { okr: porTitulo.get("okr"), itens: porTitulo.get("itens") }) }));
      const selecionadas = new URL(request.url).searchParams.get("escopo") === "qualidade" ? comPendencias.filter((item) => item.problemas.length) : comPendencias;
      const ids = [...new Set(selecionadas.flatMap(({ tarefa }) => [...((tarefa.responsibleIds as string[]) || []), ...((tarefa.authorIds as string[]) || []), ...((tarefa.followerIds as string[]) || [])]))];
      const contatos = new Map((await buscarContatos(ids)).map((contato) => [contato.id, contato]));
      const camposNasTarefas = [...new Set(selecionadas.flatMap(({ tarefa }) => ((tarefa.customFields as Array<{ id: string }> | undefined) || []).map((campo) => campo.id)))];
      const cabecalhos = ["ID", "Título", "Link no Wrike", "Status", "ID do status personalizado", "Importância", "Criado em", "Atualizado em", "Concluído em", "Tipo de datas", "Início planejado", "Prazo", "Duração (minutos)", "Descrição", "Descrição breve", "Responsáveis", "Autores", "Seguidores", "Pastas pai (IDs)", "Superpastas (IDs)", "Subtarefas (IDs)", "Tarefas pai (IDs)", "Dependências (IDs)", "Compartilhado com (IDs)", "Tipo personalizado", "Quantidade de anexos", "Possui anexos", "Metadados", "Pendências de qualidade", ...camposNasTarefas.map((id) => `Campo: ${titulos.get(id) || id}`)];
      const linhas = selecionadas.map(({ tarefa, problemas }) => {
        const valores = new Map(((tarefa.customFields as Array<{ id: string; value?: string }> | undefined) || []).map((campo) => [campo.id, campo.value]));
        const datas = (tarefa.dates as Record<string, string> | undefined) || {};
        return [tarefa.id, tarefa.title, tarefa.permalink, tarefa.status, tarefa.customStatusId, tarefa.importance, dataPlanilha(tarefa.createdDate as string), dataPlanilha(tarefa.updatedDate as string), dataPlanilha(tarefa.completedDate as string), datas.type, dataPlanilha(datas.start), dataPlanilha(datas.due), datas.duration, textoPlanilha(tarefa.description), textoPlanilha(tarefa.briefDescription), textoPlanilha(nomes(tarefa.responsibleIds as string[], contatos)), textoPlanilha(nomes(tarefa.authorIds as string[], contatos)), textoPlanilha(nomes(tarefa.followerIds as string[], contatos)), textoPlanilha(tarefa.parentIds), textoPlanilha(tarefa.superParentIds), textoPlanilha(tarefa.subTaskIds), textoPlanilha(tarefa.superTaskIds), textoPlanilha(tarefa.dependencyIds), textoPlanilha(tarefa.sharedIds), tarefa.customItemTypeId, tarefa.attachmentCount, tarefa.hasAttachments ? "Sim" : "Não", textoPlanilha(tarefa.metadata), textoPlanilha(problemas), ...camposNasTarefas.map((id) => textoPlanilha(valores.get(id)))];
      });
      const planilha = XLSX.utils.aoa_to_sheet([cabecalhos, ...linhas], { cellDates: true });
      planilha["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: cabecalhos.length - 1, r: linhas.length } }) };
      planilha["!cols"] = cabecalhos.map((cabecalho) => ({ wch: cabecalho.includes("Descrição") ? 60 : Math.min(Math.max(cabecalho.length + 3, 14), 36) }));
      const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, planilha, "Tarefas");
      const nome = new URL(request.url).searchParams.get("escopo") === "qualidade" ? "tarefas-wrike-pendencias-qualidade" : "tarefas-wrike-todas";
      return new Response(XLSX.write(workbook, { bookType: "xlsx", type: "array", compression: true, cellDates: true }), { headers: { ...corsHeaders, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename=\"${nome}-${new Date().toISOString().slice(0, 10)}.xlsx\"`, "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ erro: error instanceof Error ? error.message : "Não foi possível extrair as tarefas do Wrike." }, { status: 500, headers: corsHeaders });
    }
  },
};

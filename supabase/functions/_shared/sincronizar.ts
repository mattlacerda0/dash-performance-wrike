import { banco, inserirOuAtualizar } from "./supabase.ts";
import { buscarCampos, buscarContatos, buscarEspacoEFolders, buscarTodasTarefas, buscarWorkflows, itensDoCampo, nomePessoa, padraoStatus } from "./wrike.ts";

const espacoPadrao = "MQAAAAEPMI9l";
const agora = () => new Date().toISOString();

export async function sincronizarDados(tipo: "inicial" | "reconciliacao" | "webhook" = "reconciliacao") {
  const idEspaco = Deno.env.get("WRIKE_ESPACO_ID") || espacoPadrao;
  const execucao = await inserirOuAtualizar("sincronizacoes_wrike", [{ tipo, resultado: "em_andamento" }], "id");
  const idSincronizacao = execucao[0]?.id;
  try {
    const [estrutura, tarefas, campos, workflows] = await Promise.all([buscarEspacoEFolders(idEspaco), buscarTodasTarefas(idEspaco), buscarCampos(), buscarWorkflows()]);
    const filhosDiretos = new Set<string>(estrutura.root?.childIds || []);
    const grupos = estrutura.folders.filter((folder: { id: string }) => filhosDiretos.has(folder.id)).map((folder: { id: string; title?: string }) => ({
      id_wrike: folder.id, nome: folder.title || "Sem nome", tipo_grupo: (folder.title || "").trim().toLowerCase().startsWith("squad_") ? "squad" : "area", ativo: true,
    }));
    const squads = await inserirOuAtualizar("squads", grupos, "id_wrike");
    const porFolder = new Map(squads.map((squad) => [String(squad.id_wrike), Number(squad.id)]));
    const porCampo = new Map(campos.map((campo: { id: string; title?: string }) => [campo.title?.toLowerCase(), campo.id]));
    const idOkr = porCampo.get("okr");
    const idItens = porCampo.get("itens");
    const idsResponsaveis = [...new Set(tarefas.flatMap((tarefa) => tarefa.responsibleIds || []))];
    const contatos = await buscarContatos(idsResponsaveis);
    const pessoas = await inserirOuAtualizar("pessoas", contatos.map((contato) => ({ id_wrike: contato.id, nome: nomePessoa(contato), email: contato.email || null, ativo: true })), "id_wrike");
    const porResponsavel = new Map(pessoas.map((pessoa) => [String(pessoa.id_wrike), Number(pessoa.id)]));
    const status = workflows.flatMap((workflow: { customStatuses?: Array<{ id: string; name?: string; group?: string }> }) => workflow.customStatuses || []);
    const porIdStatus = new Map(status.map((item: { id: string; name?: string; group?: string }) => [item.id, item]));
    await inserirOuAtualizar("mapeamentos_status", status.map((item: { id: string; name?: string; group?: string }) => {
      const regra = padraoStatus(item.name, item.group);
      return { id_status_wrike: item.id, nome_status: item.name || "Sem status", etapa_analitica: regra.etapa, considera_execucao: regra.execucao, encerra_ciclo: regra.encerra, ativo: true };
    }), "id_status_wrike");
    const itens = await inserirOuAtualizar("itens_trabalho", tarefas.map((tarefa) => {
      const camposTarefa = new Map((tarefa.customFields || []).map((campo) => [campo.id, campo.value]));
      const folder = (tarefa.parentIds || []).find((id) => porFolder.has(id));
      const statusPersonalizado = tarefa.customStatusId ? porIdStatus.get(tarefa.customStatusId) : undefined;
      return {
        id_wrike: tarefa.id, titulo: tarefa.title || "Sem título", link_wrike: tarefa.permalink || null, id_squad: folder ? porFolder.get(folder) : null,
        nome_status: statusPersonalizado?.name || tarefa.status || "Sem status", grupo_status: statusPersonalizado?.group || tarefa.status || "Active", id_status_wrike: tarefa.customStatusId || null,
        itens: itensDoCampo(idItens ? camposTarefa.get(idItens) : undefined), okr: idOkr ? camposTarefa.get(idOkr) || null : null,
        criado_no_wrike_em: tarefa.createdDate || null, inicio_planejado_em: tarefa.dates?.start || null, prazo_em: tarefa.dates?.due || null,
        concluido_em: tarefa.completedDate || null, atualizado_no_wrike_em: tarefa.updatedDate || null, descricao_preenchida: Boolean(tarefa.description?.trim()),
      };
    }), "id_wrike");
    const porTarefa = new Map(itens.map((item) => [String(item.id_wrike), Number(item.id)]));
    await banco("responsaveis_itens?ativo=eq.true", { method: "PATCH", body: JSON.stringify({ ativo: false }) });
    const relacoes = tarefas.flatMap((tarefa) => (tarefa.responsibleIds || []).flatMap((idResponsavel) => {
      const idItem = porTarefa.get(tarefa.id); const idPessoa = porResponsavel.get(idResponsavel);
      return idItem && idPessoa ? [{ id_item_trabalho: idItem, id_pessoa: idPessoa, associado_em: agora(), ativo: true }] : [];
    }));
    await inserirOuAtualizar("responsaveis_itens", relacoes, "id_item_trabalho,id_pessoa");
    await banco(`sincronizacoes_wrike?id=eq.${encodeURIComponent(String(idSincronizacao))}`, { method: "PATCH", body: JSON.stringify({ finalizado_em: agora(), itens_lidos: tarefas.length, itens_atualizados: itens.length, resultado: "sucesso" }) });
    return { itens_lidos: tarefas.length, itens_atualizados: itens.length, grupos: squads.length };
  } catch (error) {
    if (idSincronizacao) await banco(`sincronizacoes_wrike?id=eq.${encodeURIComponent(String(idSincronizacao))}`, { method: "PATCH", body: JSON.stringify({ finalizado_em: agora(), resultado: "erro", detalhe_erro: error instanceof Error ? error.message : "Erro desconhecido" }) }).catch(() => undefined);
    throw error;
  }
}

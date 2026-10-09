import XLSX from "xlsx";

const camposDaTarefa = ["customFields", "responsibleIds", "parentIds", "superParentIds", "description", "briefDescription", "metadata", "authorIds", "followerIds", "sharedIds", "dependencyIds", "attachmentCount", "hasAttachments", "subTaskIds", "superTaskIds", "customItemTypeId"];

function configuracaoWrike(ambiente) {
  const token = ambiente.WRIKE_ACCESS_TOKEN?.trim();
  const host = (ambiente.WRIKE_API_HOST || "www.wrike.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const espaco = ambiente.WRIKE_ESPACO_ID?.trim();
  const bruto = ambiente.WRIKE_FOLDER_IDS?.trim() || "";
  let pastas = bruto.split(",").map((id) => id.trim()).filter(Boolean);
  try { const json = JSON.parse(bruto); if (Array.isArray(json)) pastas = json.map(String).map((id) => id.trim()).filter(Boolean); } catch { /* aceita lista separada por vírgulas */ }
  if (!token || (!espaco && !pastas.length)) throw new Error("A extração exige WRIKE_ACCESS_TOKEN e WRIKE_ESPACO_ID ou WRIKE_FOLDER_IDS configurados no ambiente.");
  return { token, base: `https://${host}/api/v4`, espaco, pastas };
}

async function consultarWrike(ambiente, caminho, parametros = {}) {
  const { token, base } = configuracaoWrike(ambiente);
  const url = new URL(`${base}${caminho}`);
  for (const [chave, valor] of Object.entries(parametros)) if (valor) url.searchParams.set(chave, valor);
  const resposta = await fetch(url, { headers: { Authorization: `bearer ${token}`, Accept: "application/json" } });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.errorDescription || "O Wrike recusou a extração das tarefas.");
  return corpo;
}

async function buscarTarefasWrike(ambiente) {
  const { espaco, pastas } = configuracaoWrike(ambiente);
  const tarefas = new Map();
  const escopos = espaco ? [{ caminho: `/spaces/${encodeURIComponent(espaco)}/tasks` }] : pastas.map((pasta) => ({ caminho: `/folders/${encodeURIComponent(pasta)}/tasks` }));
  for (const escopo of escopos) {
    let pagina = "";
    do {
      const corpo = await consultarWrike(ambiente, escopo.caminho, { descendants: "true", pageSize: "1000", fields: JSON.stringify(camposDaTarefa), nextPageToken: pagina });
      for (const tarefa of corpo.data || []) tarefas.set(tarefa.id, tarefa);
      pagina = corpo.nextPageToken || "";
    } while (pagina);
  }
  return [...tarefas.values()];
}

async function buscarContatosWrike(ambiente, ids) {
  const contatos = new Map();
  for (let inicio = 0; inicio < ids.length; inicio += 1000) {
    const lote = ids.slice(inicio, inicio + 1000);
    if (!lote.length) continue;
    const corpo = await consultarWrike(ambiente, `/contacts/${lote.map(encodeURIComponent).join(",")}`);
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

function valorDoCampo(tarefa, idCampo) {
  return (tarefa.customFields || []).find((campo) => campo.id === idCampo)?.value || "";
}

function itensDoCampo(valor) {
  if (!valor) return [];
  try { const dado = JSON.parse(valor); return Array.isArray(dado) ? dado.map(String) : [String(dado)]; } catch { return [String(valor)]; }
}

function pendenciasDeQualidade(tarefa, idsCampos) {
  const pendencias = [];
  if (!tarefa.description?.trim()) pendencias.push("Sem descrição");
  if (!tarefa.dates?.due && !tarefa.dates?.dueDate) pendencias.push("Sem prazo");
  if (!(tarefa.responsibleIds || []).length) pendencias.push("Sem responsável");
  const okr = valorDoCampo(tarefa, idsCampos.okr).trim();
  if (!okr || okr.toLowerCase() === "nenhum") pendencias.push("OKR ausente ou Nenhum");
  const itens = itensDoCampo(valorDoCampo(tarefa, idsCampos.itens));
  if (!itens.length) pendencias.push("Itens ausente");
  if (itens.some((item) => item.trim().toLowerCase() === "outro")) pendencias.push("Itens contém Outro");
  return pendencias;
}

export async function criarArquivoTarefas(ambiente, escopo = "todas") {
  const somentePendencias = escopo === "qualidade";
  const [tarefasOriginais, camposPersonalizados] = await Promise.all([
    buscarTarefasWrike(ambiente),
    consultarWrike(ambiente, "/customfields").then((corpo) => corpo.data || []),
  ]);
  const titulosCampos = new Map(camposPersonalizados.map((campo) => [campo.id, campo.title || campo.id]));
  const idsCampos = Object.fromEntries(camposPersonalizados.map((campo) => [String(campo.title || "").trim().toLowerCase(), campo.id]));
  const tarefasComPendencias = tarefasOriginais.map((tarefa) => ({ tarefa, pendencias: pendenciasDeQualidade(tarefa, idsCampos) }));
  const tarefas = somentePendencias ? tarefasComPendencias.filter(({ pendencias }) => pendencias.length) : tarefasComPendencias;
  const idsPessoas = [...new Set(tarefas.flatMap(({ tarefa }) => [...(tarefa.responsibleIds || []), ...(tarefa.authorIds || []), ...(tarefa.followerIds || [])]))];
  const contatos = await buscarContatosWrike(ambiente, idsPessoas);
  const camposNasTarefas = [...new Set(tarefas.flatMap(({ tarefa }) => (tarefa.customFields || []).map((campo) => campo.id)))];
  const cabecalhos = ["ID", "Título", "Link no Wrike", "Status", "ID do status personalizado", "Importância", "Criado em", "Atualizado em", "Concluído em", "Tipo de datas", "Início planejado", "Prazo", "Duração (minutos)", "Descrição", "Descrição breve", "Responsáveis", "Autores", "Seguidores", "Pastas pai (IDs)", "Superpastas (IDs)", "Subtarefas (IDs)", "Tarefas pai (IDs)", "Dependências (IDs)", "Compartilhado com (IDs)", "Tipo personalizado", "Quantidade de anexos", "Possui anexos", "Metadados", "Pendências de qualidade", ...camposNasTarefas.map((id) => `Campo: ${titulosCampos.get(id) || id}`)];
  const linhas = tarefas.map(({ tarefa, pendencias }) => {
    const valores = new Map((tarefa.customFields || []).map((campo) => [campo.id, campo.value]));
    const datas = tarefa.dates || {};
    return [tarefa.id, tarefa.title, tarefa.permalink, tarefa.status, tarefa.customStatusId, tarefa.importance, dataPlanilha(tarefa.createdDate), dataPlanilha(tarefa.updatedDate), dataPlanilha(tarefa.completedDate), datas.type, dataPlanilha(datas.start || datas.startDate), dataPlanilha(datas.due || datas.dueDate), datas.duration, textoPlanilha(tarefa.description), textoPlanilha(tarefa.briefDescription), textoPlanilha(nomesContatos(tarefa.responsibleIds, contatos)), textoPlanilha(nomesContatos(tarefa.authorIds, contatos)), textoPlanilha(nomesContatos(tarefa.followerIds, contatos)), textoPlanilha(tarefa.parentIds), textoPlanilha(tarefa.superParentIds), textoPlanilha(tarefa.subTaskIds), textoPlanilha(tarefa.superTaskIds), textoPlanilha(tarefa.dependencyIds), textoPlanilha(tarefa.sharedIds), tarefa.customItemTypeId, tarefa.attachmentCount, tarefa.hasAttachments ? "Sim" : "Não", textoPlanilha(tarefa.metadata), textoPlanilha(pendencias), ...camposNasTarefas.map((id) => textoPlanilha(valores.get(id)))];
  });
  const planilha = XLSX.utils.aoa_to_sheet([cabecalhos, ...linhas], { cellDates: true });
  planilha["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: cabecalhos.length - 1, r: linhas.length } }) };
  planilha["!cols"] = cabecalhos.map((cabecalho) => ({ wch: cabecalho.includes("Descrição") ? 60 : Math.min(Math.max(cabecalho.length + 3, 14), 36) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, planilha, "Tarefas");
  const data = new Date().toISOString().slice(0, 10);
  const sufixo = somentePendencias ? "pendencias-qualidade" : "todas";
  return { arquivo: XLSX.write(workbook, { bookType: "xlsx", type: "buffer", compression: true, cellDates: true }), nome: `tarefas-wrike-${sufixo}-${data}.xlsx`, quantidade: tarefas.length };
}

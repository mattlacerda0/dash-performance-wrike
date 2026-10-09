const camposTarefa = ["customFields", "responsibleIds", "parentIds", "superParentIds", "description"];

export type TarefaWrike = {
  id: string; title?: string; permalink?: string; status?: string; customStatusId?: string;
  customFields?: Array<{ id: string; value?: string }>;
  responsibleIds?: string[]; parentIds?: string[]; dates?: { start?: string; due?: string };
  createdDate?: string; completedDate?: string; updatedDate?: string; description?: string;
};

function configuracao() {
  const token = Deno.env.get("WRIKE_ACCESS_TOKEN");
  const host = (Deno.env.get("WRIKE_API_HOST") || "www.wrike.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!token) throw new Error("WRIKE_ACCESS_TOKEN não configurado.");
  return { token, base: `https://${host}/api/v4` };
}

export async function requisicaoWrike(caminho: string, parametros: Record<string, string> = {}, init: RequestInit = {}) {
  const { token, base } = configuracao();
  const url = new URL(`${base}${caminho}`);
  for (const [chave, valor] of Object.entries(parametros)) if (valor) url.searchParams.set(chave, valor);
  const response = await fetch(url, { ...init, headers: { Authorization: `bearer ${token}`, Accept: "application/json", ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Wrike: ${response.status} ${body.errorDescription || body.error || "erro desconhecido"}`);
  return body;
}

export async function buscarTodasTarefas(idEspaco: string) {
  const tarefas: TarefaWrike[] = [];
  let proximaPagina = "";
  do {
    const body = await requisicaoWrike(`/spaces/${encodeURIComponent(idEspaco)}/tasks`, {
      descendants: "true", pageSize: "1000", fields: JSON.stringify(camposTarefa), nextPageToken: proximaPagina,
    });
    tarefas.push(...(body.data || []));
    proximaPagina = body.nextPageToken || "";
  } while (proximaPagina);
  return tarefas;
}

export async function buscarEspacoEFolders(idEspaco: string) {
  // A API v4 de projetos expõe a árvore do espaço nesta rota. A rota
  // /root/folder pertence à API Data Hub e responde 400 neste contexto.
  const raiz = await requisicaoWrike(`/spaces/${encodeURIComponent(idEspaco)}/folders`);
  const root = (raiz.data || [])[0];
  const body = root ? await requisicaoWrike(`/folders/${encodeURIComponent(root.id)}/folders`, { descendants: "true" }) : { data: [] };
  return { root, folders: body.data || [] };
}

export async function buscarCampos() {
  const body = await requisicaoWrike("/customfields");
  return body.data || [];
}

export async function buscarContatos(ids: string[]) {
  const contatos: Array<{ id: string; firstName?: string; lastName?: string; email?: string }> = [];
  for (let inicio = 0; inicio < ids.length; inicio += 1000) {
    const lote = ids.slice(inicio, inicio + 1000);
    if (!lote.length) continue;
    const body = await requisicaoWrike(`/contacts/${lote.map(encodeURIComponent).join(",")}`);
    contatos.push(...(body.data || []));
  }
  return contatos;
}

export async function buscarWorkflows() {
  const body = await requisicaoWrike("/workflows");
  return body.data || [];
}

export async function configurarWebhook(idEspaco: string) {
  const hookUrl = Deno.env.get("WRIKE_WEBHOOK_URL");
  const segredo = Deno.env.get("WRIKE_WEBHOOK_SECRET");
  if (!hookUrl || !segredo) return { configurado: false, motivo: "URL ou segredo do webhook não configurado." };
  const existentes = await requisicaoWrike("/webhooks");
  if ((existentes.data || []).some((webhook: { hookUrl?: string }) => webhook.hookUrl === hookUrl)) return { configurado: true, criado: false };
  await requisicaoWrike(`/spaces/${encodeURIComponent(idEspaco)}/webhooks`, {
    // A carga de reconciliação já cobre os demais atributos; o webhook é
    // reservado ao histórico de transições de status, que exige precisão.
    hookUrl, secret: segredo, recursive: "true", events: "[TaskStatusChanged]",
  }, { method: "POST" });
  return { configurado: true, criado: true };
}

export function nomePessoa(contato: { firstName?: string; lastName?: string; email?: string }) {
  return [contato.firstName, contato.lastName].filter(Boolean).join(" ") || contato.email || "Sem nome";
}

export function itensDoCampo(valor?: string) {
  if (!valor) return [];
  try { const dado = JSON.parse(valor); return Array.isArray(dado) ? dado.map(String) : [String(dado)]; } catch { return [valor]; }
}

export function padraoStatus(nome = "", grupo = "") {
  const normalizado = nome.trim().toLowerCase();
  if (["sprint planning", "to do", "backlog", "new"].includes(normalizado)) return { etapa: "planejamento", execucao: false, encerra: false };
  if (["doing", "in progress", "validation", "valitadion"].includes(normalizado)) return { etapa: "execucao", execucao: true, encerra: false };
  if (["done", "completed"].includes(normalizado) || grupo === "Completed") return { etapa: "concluido", execucao: false, encerra: true };
  return { etapa: "nao_classificado", execucao: false, encerra: false };
}

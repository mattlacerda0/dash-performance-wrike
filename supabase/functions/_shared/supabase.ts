const schema = "_performance_wrike";

function config() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Segredos do Supabase não configurados.");
  return { url, key };
}

export async function banco(caminho: string, opcoes: RequestInit = {}) {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${caminho}`, {
    ...opcoes,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Profile": schema,
      "Accept-Profile": schema,
      "Content-Type": "application/json",
      ...(opcoes.headers || {}),
    },
  });
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(`Banco: ${response.status} ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}

export async function inserirOuAtualizar(tabela: string, dados: unknown[], conflito: string) {
  if (!dados.length) return [];
  return banco(`${tabela}?on_conflict=${encodeURIComponent(conflito)}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(dados),
  }) as Promise<Array<Record<string, unknown>>>;
}

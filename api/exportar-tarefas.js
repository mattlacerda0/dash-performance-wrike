export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ erro: "Método não permitido." });
  const origem = process.env.SUPABASE_FUNCAO_PERFORMANCE_URL?.trim();
  if (!origem) return response.status(503).json({ erro: "Configure SUPABASE_FUNCAO_PERFORMANCE_URL nas variáveis de ambiente da Vercel." });
  const chavePublica = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  if (!chavePublica) return response.status(503).json({ erro: "Configure SUPABASE_PUBLISHABLE_KEY nas variáveis de ambiente da Vercel para autorizar a exportação." });
  try {
    const destino = new URL(origem);
    destino.pathname = destino.pathname.replace(/\/consultar-performance$/, "/exportar-tarefas-wrike");
    destino.searchParams.set("escopo", request.query?.escopo === "qualidade" ? "qualidade" : "todas");
    const resultado = await fetch(destino, { headers: { Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Authorization: `Bearer ${chavePublica}`, apikey: chavePublica } });
    if (!resultado.ok) return response.status(resultado.status).json(await resultado.json().catch(() => ({ erro: "Não foi possível extrair as tarefas do Wrike." })));
    response.setHeader("Content-Type", resultado.headers.get("content-type") || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", resultado.headers.get("content-disposition") || "attachment; filename=\"tarefas-wrike.xlsx\"");
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).send(Buffer.from(await resultado.arrayBuffer()));
  } catch (error) {
    return response.status(500).json({ erro: error instanceof Error ? error.message : "Não foi possível extrair as tarefas do Wrike." });
  }
}

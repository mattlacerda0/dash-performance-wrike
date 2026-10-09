export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ erro: "Método não permitido." });
  const endpoint = process.env.SUPABASE_FUNCAO_PERFORMANCE_URL?.trim();
  if (!endpoint) return response.status(503).json({ erro: "Configure SUPABASE_FUNCAO_PERFORMANCE_URL nas variáveis de ambiente da Vercel." });
  try {
    const remoto = new URL(endpoint);
    for (const chave of ["inicio", "fim", "squad", "pessoa"]) {
      const valor = Array.isArray(request.query?.[chave]) ? request.query[chave][0] : request.query?.[chave];
      if (valor) remoto.searchParams.set(chave, valor);
    }
    const resultado = await fetch(remoto, { headers: { Accept: "application/json" } });
    const corpo = await resultado.json().catch(() => ({ erro: "Resposta inválida da função de indicadores." }));
    return response.status(resultado.status).json(corpo);
  } catch {
    return response.status(502).json({ erro: "Não foi possível alcançar a função de indicadores do Supabase." });
  }
}

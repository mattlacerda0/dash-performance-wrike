# Dashboard de performance de squads

Painel executivo que conecta tarefas do Wrike à execução das squads, qualidade do backlog e cobertura de OKRs. O frontend não conhece o token do Wrike nem acessa tabelas do Supabase.

## Componentes

- `supabase/migrations/`: estrutura privada `_performance_wrike`, índices, RLS e consulta agregada.
- `supabase/functions/`: webhook seguro, reconciliação do Wrike e consulta pública apenas de agregados.
- `public/`: painel local com filtros por intervalo, squad/área e pessoa.

## Configuração local

1. Copie `.env.example` para `.env`.
2. Preencha `SUPABASE_FUNCAO_PERFORMANCE_URL` com a URL de `consultar-performance`.
3. Rode `npm start` e abra `http://localhost:8787`.

## Segredos no Supabase

Configure somente nas Edge Functions: `WRIKE_ACCESS_TOKEN`, `WRIKE_API_HOST`, `WRIKE_ESPACO_ID`, `WRIKE_WEBHOOK_SECRET` e `WRIKE_WEBHOOK_URL`. A reconciliação usa o espaço `MQAAAAEPMI9l` por padrão.

Para o agendamento, crie no Vault o segredo `performance_wrike_sync_secret` com o mesmo valor de `WRIKE_SYNC_SECRET` das Edge Functions e aplique a segunda migração. Ela chama `sincronizar-wrike` a cada 15 minutos, sem incluir chaves no SQL. O schema `_performance_wrike` continua sem permissões para `anon` e `authenticated`; a única rota pública é `consultar-performance`, que retorna agregados.

## Limitações conscientes

Cycle time e gargalos começam a ser medidos após o webhook ser ativado. Bugs críticos e validação de hipóteses aparecem como dependentes de classificação enquanto os campos correspondentes não existirem no Wrike.

## Publicação na Vercel

A Vercel serve o painel e encaminha as rotas `/api/performance` e `/api/exportar-tarefas` para as Edge Functions do Supabase. Configure `SUPABASE_FUNCAO_PERFORMANCE_URL` e `SUPABASE_PUBLISHABLE_KEY` nas variáveis de ambiente da Vercel. A chave pública autoriza a chamada à Edge Function; o token do Wrike permanece somente nos segredos das Edge Functions.

O botão de exportação permite escolher entre todas as tarefas e apenas tarefas com pendências de qualidade. A segunda opção considera descrição, prazo, responsável, OKR e o campo `Itens`.

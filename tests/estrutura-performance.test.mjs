import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../supabase/migrations/20261008170000_criar_performance_wrike.sql", import.meta.url);
const migration = await readFile(migrationPath, "utf8");

test("cria as tabelas analíticas com nomenclatura em português", () => {
  for (const table of ["squads", "pessoas", "itens_trabalho", "responsaveis_itens", "historico_status_itens", "mapeamentos_status", "eventos_wrike", "sincronizacoes_wrike"]) {
    assert.match(migration, new RegExp(`create table if not exists _performance_wrike\\.${table}`));
  }
  assert.match(migration, /itens jsonb not null default '\[\]'::jsonb/);
  assert.match(migration, /descricao_preenchida boolean not null default false/);
});

test("protege tabelas contra papéis públicos e mantém RLS ativo", () => {
  assert.match(migration, /revoke all on all tables in schema _performance_wrike from public, anon, authenticated/);
  assert.match(migration, /alter table _performance_wrike\.itens_trabalho enable row level security/);
  assert.match(migration, /grant select, insert, update, delete on all tables in schema _performance_wrike to service_role/);
});

test("inclui índices para filtros, relacionamentos e histórico", () => {
  for (const index of ["itens_trabalho_squad_status_idx", "responsaveis_itens_pessoa_idx", "historico_status_item_ocorrido_idx", "eventos_wrike_recebido_idx"]) {
    assert.match(migration, new RegExp(`create index if not exists ${index}`));
  }
});

test("consulta pública retorna agregados, auditoria e avisos metodológicos", () => {
  for (const key of ["metricas", "squads", "pessoas", "top_itens", "gargalos", "auditoria", "avisos"]) {
    assert.match(migration, new RegExp(`'${key}'`));
  }
  assert.match(migration, /security invoker/);
});

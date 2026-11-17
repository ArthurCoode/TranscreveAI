-- 002_lockdown_rls.sql
-- Fecha o acesso direto ao banco pela anon key (que é pública por natureza:
-- fica no JavaScript do site). Depois desta versão, o navegador NÃO lê nem
-- grava nenhuma tabela diretamente — tudo passa pelas rotas /api, que usam
-- a service role (que ignora RLS). O navegador só usa o Supabase Auth
-- (recuperação/definição de senha), que não depende destas tabelas.
--
-- COMO RODAR: SQL Editor do Supabase, DEPOIS de publicar esta versão do
-- código (antes disso, o painel admin antigo ainda grava banners pela anon key).
-- Recomendado: faça backup / teste num projeto de staging primeiro.

-- ---------------------------------------------------------------------------
-- 0) DIAGNÓSTICO (opcional — rode antes para ver o estado atual)
-- ---------------------------------------------------------------------------
-- Tabelas sem RLS:
--   select tablename from pg_tables where schemaname = 'public' and not rowsecurity;
-- Policies existentes:
--   select schemaname, tablename, policyname, roles, cmd from pg_policies
--   where schemaname in ('public', 'storage') order by 1, 2;
-- Funções que anon/authenticated podem executar:
--   select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');

begin;

-- ---------------------------------------------------------------------------
-- 1) RLS ligado em TODAS as tabelas do schema public
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Remove policies antigas do schema public
--    (ex: policies que deixavam anon inserir em dashboard_banner).
--    Sem policies + RLS ligado = anon/authenticated não acessam nada;
--    a service role (backend) continua com acesso total.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Funções (RPC) só podem ser chamadas pelo backend.
--    Antes, qualquer pessoa com a anon key podia chamar, por exemplo,
--    incrementar_uso(p_user_id => <id de outra pessoa>, ...) direto no PostgREST.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public grant execute on functions to service_role;

-- ---------------------------------------------------------------------------
-- 4) Storage: uploads só pelo backend.
--    O avatar agora é enviado por /api/avatar (service role). Remove as
--    policies que permitiam upload/alteração anônima nos buckets.
--    O bucket "avatars" continua PÚBLICO para leitura (URL pública da foto);
--    o bucket "audios" deve continuar PRIVADO (download por URL assinada).
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(avatars|audios)'
  loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end $$;

update storage.buckets set public = false where id = 'audios';

commit;

-- ---------------------------------------------------------------------------
-- ATENÇÃO: se houver um trigger em auth.users que cria a linha em
-- public.usuarios no cadastro, confirme que a função é SECURITY DEFINER
-- (padrão do Supabase). Caso contrário, o cadastro pode falhar com RLS ligado:
--   select proname, prosecdef from pg_proc where proname ilike '%new_user%';
-- ---------------------------------------------------------------------------

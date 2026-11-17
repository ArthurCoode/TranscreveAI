-- 001_convites_time.sql
-- Convites de time com aceite explícito.
--
-- Antes, /api/team/invite colocava QUALQUER usuário (buscado pelo e-mail)
-- direto no time de quem convidava, sem o convidado concordar — e o admin
-- do time passava a ler todas as reuniões dessa pessoa. Agora o convite
-- fica pendente até o próprio convidado aceitar, logado na conta dele.
--
-- Rode no SQL Editor do Supabase antes de publicar esta versão.

create table if not exists public.convites_time (
  id            uuid primary key default gen_random_uuid(),
  team_id       text not null, -- mesmo valor de usuarios.team_id (guardado como texto)
  email         text not null,
  role          text not null check (role in ('viewer', 'editor', 'admin')),
  token_hash    text not null unique,
  convidado_por uuid not null,
  status        text not null default 'pendente'
                check (status in ('pendente', 'aceito', 'cancelado', 'expirado')),
  criado_em     timestamptz not null default now(),
  expira_em     timestamptz not null default (now() + interval '7 days'),
  aceito_em     timestamptz
);

create index if not exists convites_time_email_idx on public.convites_time (lower(email));
create index if not exists convites_time_team_idx on public.convites_time (team_id);

-- Acesso só pelo backend (service role). Sem policies = anon/authenticated
-- não leem nem escrevem nada nesta tabela.
alter table public.convites_time enable row level security;

# TranscreveAI

Transcrição e inteligência de reuniões em português: transcrição em tempo real (extensão do Chrome + Whisper/Groq), resumo executivo, insights comerciais, atividades extraídas automaticamente, assistente **Theo** com memória das reuniões e painel de supervisão para times.

## Stack

- **Next.js 15** (Pages Router — apenas rotas `/api`; o front são páginas HTML/JS em `public/`)
- **Supabase** (Postgres, Auth, Storage)
- **Groq** (Whisper para transcrição, Llama para resumo e Theo)
- **Mercado Pago** (cartão, Pix, boleto) · **Resend** (e-mails) · **Google Calendar**
- Deploy na **Vercel** (com Vercel Cron)

## Rodando localmente

```bash
npm install
cp .env.example .env.local   # preencha os valores
npm run dev
```

Requer Node.js 18.18+.

## Variáveis de ambiente

Todas estão documentadas em [`.env.example`](.env.example). As obrigatórias para subir:

| Variável | Para quê |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Acesso ao banco pelo backend (service role — **nunca** no front) |
| `JWT_SECRET` | Assina as sessões do site. Gere com `openssl rand -base64 48` |
| `ADMIN_PLANO_ID` | UUID do plano que libera o `/admin.html` |
| `PUBLIC_BASE_URL` | URL pública (links de e-mail, webhook do Mercado Pago) |
| `CRON_SECRET` | Protege o job diário. **Sem ele o job não roda** |
| `GROQ_KEY`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `RESEND_API_KEY`, `SUPPORT_EMAIL` | Integrações |

## Banco de dados

Rode as migrações em `supabase/migrations/` no SQL Editor do Supabase, **em ordem**:

1. `001_convites_time.sql` — convites de time com aceite explícito.
2. `002_lockdown_rls.sql` — liga RLS em todas as tabelas, remove policies antigas, impede que a anon key chame funções (RPC) e bloqueia upload anônimo no Storage. **Rode depois de publicar esta versão do código.**

## Modelo de segurança

- **Autenticação:** JWT próprio (HS256, `JWT_SECRET`), sempre verificado por `lib/auth.js → autenticarReq`. Nunca decodifique token sem verificar.
- **Banco:** o backend usa a service role (ignora RLS), então **toda rota filtra pelo usuário autenticado**. O navegador não acessa tabelas diretamente — só usa o Supabase Auth com a anon key.
- **Pagamentos:** o valor é sempre calculado no servidor a partir da tabela `planos` (`lib/planos.js`). O webhook confere o valor pago antes de ativar o plano. Alterar o plano de uma conta existente exige estar logado nela.
- **Times:** só admin do time convida ou remove membros; o convidado precisa aceitar o convite logado na própria conta.
- **CORS:** restrito ao site e à extensão do Chrome (`lib/cors.js`).
- **Front:** todo dado vindo do banco, de outros usuários ou da IA é escapado (`escHtml` em `public/assets/js/utils.js`) antes de ir para `innerHTML`.
- **Rate limit:** `lib/rateLimit.js` (em memória, por instância). Veja os próximos passos.

## Próximos passos conhecidos

- **Cobrança recorrente:** hoje o pagamento é avulso e o plano expira ao fim do período (30/365 dias) pelo job diário. O próximo passo é migrar para assinatura recorrente do Mercado Pago (preapproval).
- **Upload de áudio grande:** funções da Vercel aceitam no máximo ~4,5 MB por requisição. Áudios longos devem ir direto para o Storage com *signed upload URL*.
- **Rate limit global:** trocar a implementação em memória por Upstash Redis mantendo a mesma interface.
- **Content-Security-Policy completa:** exige remover scripts inline e handlers `onclick` das páginas.
- **Testes automatizados** para pagamento, permissões e cota.
- **LGPD:** aviso aos participantes gravados, política de retenção e exclusão de dados, registro de subprocessadores (Groq, Resend, Supabase).

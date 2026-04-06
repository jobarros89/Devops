# Devops

## Gestor Financeiro com WhatsApp + Supabase

Este projeto contém um app financeiro em `vagrant-lab/html` com integração por API serverless em `api/`.

### 1) Criar tabela no Supabase

Execute no SQL Editor:

```sql
create table if not exists public.transactions (
  id bigint primary key,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  type text not null check (type in ('credito', 'debito')),
  category text not null,
  date date not null,
  source text not null default 'web',
  created_at timestamptz not null default now()
);
```

### 2) Variáveis de ambiente na Vercel

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_TRANSACTIONS_TABLE` (opcional, padrão `transactions`)
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_GRAPH_API_VERSION` (opcional, padrão `v21.0`)

### 3) Configurar Webhook WhatsApp Cloud API

- URL do webhook: `https://SEU_DOMINIO/api/whatsapp-webhook`
- Verify token: igual ao `WHATSAPP_VERIFY_TOKEN`

### 4) Formato de mensagem

- `credito 120.50 almoço #alimentacao`
- `debito 89.90 uber #transporte`

Quando a mensagem for válida, o sistema grava no Supabase e responde no WhatsApp com confirmação.


### 5) Dashboard de saúde financeira (Open Source)

A página `dashboard.html` usa **Chart.js** (open source, licença MIT) para:
- monitorar saúde financeira (crédito > débito)
- mostrar gráfico de evolução por data
- mostrar distribuição crédito x débito
- detalhar todos os itens de crédito e débito em tabelas separadas


## Manual para usuários leigos

Consulte o arquivo `MANUAL-USABILIDADE.md` para instruções passo a passo em linguagem simples.

## Verificação de conflitos de merge

Se aparecer erro de conflito como `<<<<<<<`, `=======` e `>>>>>>>`, execute:

```bash
./scripts/check-merge-conflicts.sh
```

Esse script valida o repositório e falha se encontrar marcadores de conflito em arquivos de código.

### Erro comum: `cd: too many arguments`

Isso acontece quando `cd` e o script ficam colados na mesma linha sem separador.

❌ Errado:
```bash
cd /workspace/Devops./scripts/connect-and-clone.sh --repo jobarros89/Devops --https
```

✅ Correto (com `&&`):
```bash
cd /workspace/Devops && ./scripts/connect-and-clone.sh --repo jobarros89/Devops --https
```

✅ Também funciona em duas linhas:
```bash
cd /workspace/Devops
./scripts/connect-and-clone.sh --repo jobarros89/Devops --https
```

## Gerar comando `git clone`

Use o helper abaixo para gerar o clone (HTTPS/SSH) e os comandos de conexão do repositório local:

```bash
./scripts/connect-and-clone.sh --repo jobarros89/Devops --https
```

Opção SSH:

```bash
./scripts/connect-and-clone.sh --repo jobarros89/Devops --ssh
```

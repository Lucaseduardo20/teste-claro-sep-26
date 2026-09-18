# Cancelamento com Retenção Inteligente

PoC de um fluxo de auto-atendimento de cancelamento de assinatura com uma camada de IA que
decide, caso a caso, o que fazer — e mede quanto isso economiza.

## O problema

Antes deste sistema, **todo** cancelamento ia para retenção humana: um especialista atendia
cada assinante que clicava em "cancelar", a R$ 15 por caso, inclusive os que já tinham decidido
e não mudariam de ideia.

Quando um cancelamento começa, um **Agente de Scoring** atribui um risco de churn (0.00 a 1.00)
a partir do histórico do assinante — engajamento, pagamentos, tempo de casa, o motivo escrito.
Esse risco separa três caminhos:

| Risco                 | Faixa             | O que o sistema faz                   |
| --------------------- | ----------------- | ------------------------------------- |
| `< 0.30`              | baixo             | cancela direto, sem oferta            |
| `>= 0.30` e `<= 0.70` | **zona cinzenta** | encaminha para retenção humana        |
| `> 0.70`              | alto              | faz uma oferta de retenção automática |

Com uma regra secundária: numa assinatura de **alto valor recorrente**, a oferta automática é
interceptada e o caso vai para um humano — nesses, vale pagar o atendimento.

O ganho é o que sobra no meio: os extremos passam a ser resolvidos sozinhos, e só a zona
cinzenta chega ao especialista. É esse **custo evitado** que a PoC existe para demonstrar.

## Rodar

Pré-requisitos: **Node 22+**, **pnpm 11+**, **Docker com Compose V2** (`docker compose`, com
espaço).

### Caminho 1 — subir tudo com um comando

```bash
cp .env.example .env     # credenciais do Postgres (só na primeira vez)
docker compose up        # Postgres + API + frontend
```

O container da API aplica as migrations e carrega os 7 cenários antes de começar a servir, então
o sistema já sobe navegável. Quando os três estiverem de pé:

| O quê                | Onde                           |
| -------------------- | ------------------------------ |
| Fluxo (frontend)     | <http://localhost:3001>        |
| API                  | <http://localhost:3000>        |
| Documentação OpenAPI | <http://localhost:3000/docs>   |
| Saúde da API         | <http://localhost:3000/health> |

> **Nota honesta:** o `docker compose up` completo **não foi executado nesta máquina** — o
> Docker daqui é 20.10, só com Compose V1. O que **foi** validado: `docker build` de cada
> Dockerfile passa, o servidor standalone do frontend roda e serve as telas com dados reais, e
> o `docker-compose.yml` é YAML válido com os três serviços. A orquestração em si é o item que
> pede uma conferida num ambiente com Compose V2.

### Caminho 2 — desenvolvimento

```bash
pnpm install
cp .env.example .env                             # credenciais do compose
cp apps/backend/.env.example apps/backend/.env   # DATABASE_URL e PORT
cp apps/frontend/.env.example apps/frontend/.env # URL da API

pnpm db:up                                       # só o Postgres, em localhost:5432
pnpm --filter @repo/backend db:migrate           # cria o schema
pnpm --filter @repo/backend db:seed              # carrega os 7 cenários

pnpm dev                                         # API em :3000, frontend em :3001
```

Para rodar só um dos dois: `pnpm dev:backend` ou `pnpm dev:frontend`.

A lista completa de comandos do dia a dia (banco, Prisma, qualidade, `psql`) está na
[seção 6 do DECISIONS.md](./DECISIONS.md).

### Testes

```bash
pnpm verify    # lint + typecheck + testes unitários + e2e, nos três pacotes
```

São **142 testes**: 12 no contracts, 98 unitários no backend, 19 e2e e 13 no frontend.

Os e2e batem num Postgres de verdade. Sem o banco de pé eles são **pulados com aviso**, para o
`verify` continuar verde num clone sem Docker; no CI, `E2E_REQUIRE_DB=1` transforma a ausência
do banco em erro. O raciocínio está na [seção 31](./DECISIONS.md).

## Arquitetura

```
packages/contracts            especificação congelada (tipos, enums, limiares, 7 cenários)
        │
        ▼
src/decision/                 REGRA PURA — risco → faixa → outcome
        │                     sem HTTP, sem banco, sem framework
        ▼
src/scoring/                  PORT & ADAPTER — agente de scoring + deadline real
        │                     o mock demora; quem corta é o Promise.race do service
        ▼
src/plans/                    ALTO VALOR — corte derivado de SELECT DISTINCT price_cents
        │
        ▼
src/cancellations/            USE CASE — orquestra os três acima e persiste
        │                     testável sem HTTP e sem banco
        ▼
src/*/​*.controller.ts         HTTP — controllers finos, validação por DTO, filtro global
        │
        ▼
apps/frontend                 4 telas: lista → motivo → processando → resultado
```

As decisões-âncora, uma frase cada — o detalhe está no
[**DECISIONS.md**](./DECISIONS.md), que é o documento de defesa técnica:

- **A regra de decisão é pura e isolada** (§8–§13). `toBand(risk)` e `decideOutcome(band,
isHighValue)` não importam nada além dos limiares do contracts; é isso que permite 41 testes
  de fronteira rodando em ~120 ms.
- **Os limites são exclusivos, e isso é testado** (§11). `0.30` e `0.70` exatos caem na zona
  cinzenta; verifiquei por mutação que os testes quebram se alguém trocar `<` por `<=`.
- **O timeout do scoring é real** (§16–§18). O mock **espera** de verdade e quem decide "demorou
  demais" é um `Promise.race` no orquestrador, não uma flag devolvida pelo agente.
- **O alto valor é derivado do banco** (§26). `k = ceil(HIGH_VALUE_PERCENTILE * n)` sobre os
  preços distintos cadastrados — mude os preços do seed e o corte muda junto.
- **Os campos indecididos são nullable sem default** (§1.2). Um cancelamento nasce antes de ser
  decidido, e `NULL` é o único valor que significa "ainda não sei".
- **Prisma como ORM** (§2), com os índices justificados um a um e `EXPLAIN` medido em dois
  níveis de volume (§4).

## Escopo: o que está pronto e o que ficou de fora

### Entregue e testado

| Área                | O que tem                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Modelagem           | 7 entidades, 9 enums nativos, 6 índices justificados, migration versionada, seed idempotente |
| Regras de decisão   | camada pura, limites exclusivos, interceptação de alto valor, fallback de timeout            |
| Agente de Scoring   | mock determinístico por `subscriptionId`, deadline real por `Promise.race`, DI por token     |
| Endpoints de núcleo | `POST /cancellations`, `GET /subscriptions`, `GET /cancellations/:id`                        |
| Frontend            | as 4 telas do fluxo, Server Components, Server Action, `<Suspense>`, acessibilidade básica   |
| Infra transversal   | validação por DTO, exception filter global, logging estruturado (pino), OpenAPI em `/docs`   |
| Testes              | 142, em três níveis: função pura, use case sem I/O, e2e com Postgres real                    |
| Entrega             | `docker compose up` com os três serviços, CI no GitHub Actions                               |

### Deixado de fora, conscientemente

Não é lista de pendências esquecidas: é **priorização**. O núcleo avaliado — decisão, scoring,
orquestração, persistência — está completo e testado. Os cortes são todos de borda, e cada um
tem um motivo:

| Fora                                              | Por quê                                                                                                                                                                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agente de Classificação** (categoria do motivo) | Opcional no escopo, e **a decisão não depende dele**: o outcome sai do risco e do valor da assinatura. A coluna `reason_category` já existe no schema, nullable, esperando.                                                                    |
| **`POST /cancellations/:id/accept` e `/decline`** | Stretch. O fluxo _até_ a oferta está completo — ela é criada, persistida e mostrada na tela; o que falta é a ação sobre ela. Na tela, os botões aparecem desabilitados com aviso, em vez de escondidos.                                        |
| **`GET /metrics`** (custo evitado agregado)       | Stretch. O dado já está no banco e o índice `(outcome_type, band)` foi criado e medido justamente para essa agregação (§4) — falta expor.                                                                                                      |
| **LLM real no scoring**                           | Stretch. A arquitetura port/adapter deixa isso a **uma linha de distância**: trocar `useFactory` por `useClass: OpenAIScoringAgent` no `scoring.module.ts` (§16). O mock determinístico cobre o fluxo inteiro e torna os testes reprodutíveis. |
| **Testes de browser (Playwright)**                | Stretch. O fluxo foi percorrido à mão no browser nos quatro desfechos, e a lógica não-óbvia do front (moeda, mapa de mensagens) tem teste unitário.                                                                                            |

## Observações sobre o material recebido

Duas coisas encontradas durante a implementação, registradas porque o TESTE.md pede:

**1. Uma tensão na spec.** `ScoringResult` declara `risk: number` (obrigatório) e, no mesmo
tipo, `timedOut: boolean`. Quando o agente estoura o `SCORING_TIMEOUT_MS` não existe risco para
reportar — e a spec é clara ao dizer que nesse caso o risco fica indefinido. O tipo, portanto,
não consegue representar o estado que a própria spec descreve. **Não alterei o contracts**: o
adapter continua honrando `ScoringResult`, e o service devolve um tipo próprio
(`ScoringOutcome`), uma união discriminada em que o ramo de timeout não tem onde guardar um
risco. Raciocínio completo na [seção 20](./DECISIONS.md).

**2. Duas quebras pré-existentes do scaffold, corrigidas.** Nenhuma aparecia no `pnpm verify`,
porque o build do backend não está entre as tarefas que ele roda:

- `nest build` e `nest start` morriam no Node 22 antes de ler o projeto: o
  `@angular-devkit/schematics` faz `require()` de `ora@9` (ESM) dentro de um ciclo de módulos, e
  o Node recusa com `ERR_REQUIRE_CYCLE_MODULE`. Corrigido com um override transitivo fixando
  `ora` em 5.x, escopado ao `@nestjs/cli`.
- `pnpm dev:backend` nunca subiu: o `nest start` não roda o `tsc-alias`, então os aliases `@/*`
  chegavam sem resolver ao `dist`. O script `dev` agora roda `tsc --watch`, `tsc-alias --watch`
  e `node --watch` juntos.

Diagnóstico completo na [seção 30](./DECISIONS.md).

## Mapa do repositório

| Caminho               | O que é                                                                       |
| --------------------- | ----------------------------------------------------------------------------- |
| `packages/contracts/` | **Especificação congelada.** Tipos, enums, limiares e os 7 cenários. Intacta. |
| `apps/backend/`       | API NestJS + Prisma + Postgres                                                |
| `apps/frontend/`      | Next.js 16 (App Router) + Tailwind 4 + shadcn/ui                              |
| `DECISIONS.md`        | **A defesa técnica.** Uma seção por etapa, com o porquê de cada decisão.      |
| `CONTEXT.md`          | Linguagem ubíqua do domínio (pt-BR)                                           |
| `TESTE.md`            | O enunciado original                                                          |

## Uso de IA

Este projeto foi feito **com assistência de IA** (Claude Code), em sessão interativa, com
revisão minha a cada passo. Assumo a responsabilidade pelo resultado e consigo defender cada
decisão.

Cada etapa tem a sua própria seção "Uso de IA" no [DECISIONS.md](./DECISIONS.md) (§7, §15, §22,
§33, §40), registrando o que foi dirigido por mim, o que foi discutido e — principalmente — **o
que a verificação empírica mudou no código**. Alguns exemplos do que está lá:

- Um `operation.catch()` no wrapper de timeout foi escrito, **testado sem ele, provado
  desnecessário e removido** — `Promise.race` já anexa o handler. Teria ficado para sempre no
  código com um comentário convincente e errado.
- Os testes das regras de decisão foram validados **por mutação**: quebrei a regra de quatro
  formas e conferi que os testes certos falham em cada caso.
- O `EXPLAIN` foi medido em dois níveis de volume, e a primeira medição **contrariou** o que eu
  tinha escrito. Investiguei (era o _visibility map_ não marcado dentro de uma transação aberta),
  refiz num laboratório isolado e documentei os dois resultados em vez de apagar o que não bateu.

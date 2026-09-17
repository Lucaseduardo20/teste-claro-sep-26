# Teste técnico - Dev Sr Fullstack (Claro / Experimentações)

Cenário: **Cancelamento com Retenção Inteligente**. PoC fullstack de auto-atendimento de cancelamento de assinatura com uma camada de IA que reduz o custo de retenção humana.

> [`TESTE.md`](./TESTE.md) reúne escopo, regras, prazos e critérios de aceite.

## A PoC

Antes desta automação, todo cancelamento de assinatura ia para a retenção humana, valorado a R$ 15 por caso. A maior parte não precisa de gente: uma parte dos assinantes vai cancelar de todo modo e outra aceita uma oferta.

A PoC coloca um Agente de Scoring na frente da decisão. Quando o assinante inicia um cancelamento, o agente estima o risco de churn (0.00 a 1.00) a partir dos dados do assinante e da assinatura, e o risco escolhe o caminho:

| Faixa         | Risco                 | Caminho                       |
| ------------- | --------------------- | ----------------------------- |
| Baixo risco   | `< 0.30`              | Cancela direto, sem oferta    |
| Zona cinzenta | `>= 0.30` e `<= 0.70` | Retenção humana               |
| Alto risco    | `> 0.70`              | Oferta de retenção automática |

Duas exceções seguem para humano: a zona cinzenta (o agente não tem certeza) e a assinatura de alto valor em risco alto, cuja oferta automática é interceptada. Alto valor é o top 20% dos preços de plano distintos.

Um segundo agente, opcional no escopo, classifica o motivo do cancelamento em categoria canônica. Falha dele não derruba o resultado.

O ganho que a PoC mede é o custo evitado: casos que iriam para humano antes, menos os que vão agora, a R$ 15 cada. Regras completas e fórmulas em [`TESTE.md`](./TESTE.md#regras-de-decisão), linguagem do domínio em [`CONTEXT.md`](./CONTEXT.md).

## Mapa do repositório

Monorepo com [pnpm workspaces](https://pnpm.io/workspaces) e [Turborepo](https://turborepo.com).

```text
.
├── TESTE.md               # especificação do desafio (leia primeiro)
├── RUBRICA.md             # critérios de avaliação e pesos
├── AVALIACAO.md           # ficha preenchível de avaliação
├── CONTEXT.md             # linguagem ubíqua do domínio
├── VAGA.md                # descrição da vaga
├── AGENTS.md              # instruções para agentes de código
├── apps/
│   ├── backend/           # @repo/backend  - NestJS 12 + Postgres (scaffold)
│   └── frontend/          # @repo/frontend - Next.js 16 + Tailwind 4 (scaffold)
├── packages/
│   ├── contracts/         # @repo/contracts       - ESPECIFICAÇÃO CONGELADA
│   ├── tsconfig/          # @repo/tsconfig        - tsconfigs compartilhados
│   ├── lint/              # @repo/lint            - ESLint compartilhado
│   └── prettier-config/   # @repo/prettier-config - Prettier compartilhado
├── docker-compose.yml     # Postgres (você adiciona API e frontend)
├── turbo.json             # pipeline de tarefas
└── pnpm-workspace.yaml    # pacotes do workspace
```

## Começar

Requisitos: Node 22+, pnpm 11+, Docker.

```bash
pnpm install         # instala e liga os pacotes do workspace
cp .env.example .env # variáveis do docker compose (Postgres)
pnpm db:up           # sobe o Postgres
pnpm dev:backend     # API em http://localhost:3000 (GET /health)
pnpm dev:frontend    # UI em http://localhost:3001
```

Cada app tem seu próprio `.env.example` (`apps/backend/`, `apps/frontend/`); copie para `.env` na mesma pasta se precisar mudar porta ou URL.

## Verificar

```bash
pnpm verify   # lint + typecheck + testes dos três pacotes, via turbo
```

Saída esperada hoje (baseline do scaffold): tudo verde.

```text
@repo/contracts: lint, typecheck, test (12 testes)   -> verde
@repo/backend:   lint, typecheck, test, test:e2e     -> verde
@repo/frontend:  lint, typecheck                     -> verde
Tasks: 10 successful, 10 total
```

Outros comandos úteis:

| Comando                                | O que faz                                                     |
| -------------------------------------- | ------------------------------------------------------------- |
| `pnpm build`                           | build de produção dos três pacotes, na ordem das dependências |
| `pnpm test`                            | testes unitários                                              |
| `pnpm lint` / `pnpm typecheck`         | tarefas isoladas                                              |
| `pnpm format`                          | Prettier em todos os pacotes                                  |
| `pnpm --filter @repo/backend <script>` | roda um script em um pacote específico                        |

O turbo cacheia cada tarefa: rodar `pnpm verify` duas vezes sem mudar nada é instantâneo.

## O que este repositório já entrega

O objetivo do scaffold é remover o atrito de infraestrutura (monorepo configurado, banco, conexão, build, lint, typecheck, testes rodando), **não** o trabalho avaliado. Nada de modelagem, regra de decisão, agente ou tela vem pronto.

| Já pronto                                                                                                     | É o teste (você faz)                                                     |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Monorepo com turbo (build ordenado, cache, tarefas por pacote) e configs compartilhadas de TS/ESLint/Prettier | Migrations, seed, modelagem, os 6+ endpoints, agentes, regras de decisão |
| Bootstrap do Nest com `/health`, pool `pg` injetável e middleware de log                                      | Serviços de API e frontend no compose                                    |
| Compose com Postgres + healthcheck                                                                            | As 4 telas do fluxo, Server Actions, `<Suspense>`, acessibilidade        |
| Next.js 16 com Tailwind 4, shadcn/ui, tokens, layout `pt-BR`                                                  | Testes do caminho crítico (regras de decisão, fluxo de cancelamento)     |
| Testes de exemplo verdes (contracts, backend unit e e2e)                                                      | Consumir `@repo/contracts` e mapear o domínio para o schema              |
| `@repo/contracts` compilado e testado                                                                         | CI do repositório                                                        |

Detalhes de cada pacote: [`packages/contracts/README.md`](./packages/contracts/README.md), [`apps/backend/README.md`](./apps/backend/README.md) e [`apps/frontend/README.md`](./apps/frontend/README.md).

## Observação sobre a spec

`packages/contracts/` é especificação congelada e não foi alterada. Uma ambiguidade encontrada
ao implementar o Agente de Scoring, registrada aqui conforme pede o
[`TESTE.md`](./TESTE.md):

**`ScoringResult.risk` é obrigatório (`risk: number`), mas o mesmo tipo declara
`timedOut: boolean`.** Quando o agente estoura o `SCORING_TIMEOUT_MS` não existe risco para
reportar — e a spec é clara em outro ponto ao dizer que, no timeout, o risco fica indefinido
("não invente um número"). O tipo, portanto, não consegue representar o estado que a própria
spec descreve.

Não alterei o contracts. O adapter continua honrando `ScoringResult`, e o `ScoringService`
devolve um tipo próprio (`ScoringOutcome`), uma união discriminada em que o ramo de timeout
simplesmente não tem onde guardar um risco. O raciocínio completo está na seção 20 do
[`DECISIONS.md`](./DECISIONS.md).

## Uso de IA

Você pode usar IA para fazer o teste. Revise o resultado, entenda as decisões e esteja pronto para explicar o código na conversa final. Registre no README como usou a ferramenta ou diga que não usou. Nenhuma das duas escolhas reduz a nota; o que reprova está na seção **Uso de IA** de [`TESTE.md`](./TESTE.md#uso-de-ia).

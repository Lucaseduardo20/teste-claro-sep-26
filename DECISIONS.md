# DECISIONS.md

Registro incremental das decisões técnicas do teste **Cancelamento com Retenção Inteligente**.
Cada tarefa acrescenta uma seção nova; as anteriores não são reescritas.

---

## Tarefa 01 — Modelagem, schema Prisma, migration e seed

### 1. Leitura da spec: o domínio em `packages/contracts/`

Antes de escrever qualquer código, li `packages/contracts/src/types.ts`,
`packages/contracts/src/scenarios.ts` e `packages/contracts/README.md`. O resumo abaixo é a
minha leitura do domínio — é ela que o schema tenta traduzir fielmente para o Postgres.

`packages/contracts/` é **especificação congelada**: eu consumo, nunca altero. Nenhum arquivo
desse pacote foi tocado nesta tarefa.

#### 1.1 As sete entidades e como se relacionam

São duas entidades de **cadastro** (mudam pouco, são "dimensões"), duas de **evento**
(append-only, crescem sem parar) e três do **fluxo de cancelamento**.

| Entidade          | Papel no domínio (CONTEXT.md)                                            | Natureza |
| ----------------- | ------------------------------------------------------------------------ | -------- |
| `Plan`            | Plano — tipo contratado: benefícios, valor recorrente, ciclo de cobrança | cadastro |
| `Subscriber`      | Assinante — pessoa titular da assinatura                                 | cadastro |
| `Subscription`    | Assinatura — contrato recorrente entre assinante e provedor              | cadastro |
| `EngagementEvent` | Evento de Engajamento — login, playback, download, interação             | evento   |
| `PaymentEvent`    | Evento de Pagamento — cobrança em dia, atrasada ou falha                 | evento   |
| `Cancellation`    | Cancelamento — solicitação de encerramento iniciada pelo assinante       | fluxo    |
| `Offer`           | Oferta de Retenção — desconto, upgrade ou pausa proposta ao assinante    | fluxo    |

As relações, lidas direto das interfaces de `types.ts`:

```
Subscriber ──1:N──> Subscription <──N:1── Plan
                         │
                         ├──1:N──> EngagementEvent   (EngagementEvent.subscriptionId)
                         ├──1:N──> PaymentEvent      (PaymentEvent.subscriptionId)
                         └──1:N──> Cancellation      (Cancellation.subscriptionId)
                                        │
                                        └──1:0..1──> Offer   (Offer.cancellationId)
```

Em texto, e por que cada cardinalidade é essa:

- **`Subscription` é o centro do grafo.** Ela aponta para o assinante (`subscriberId`) e para o
  plano (`planId`), e é o ponto de ancoragem de tudo que é transacional. Isso não é acidente: o
  `ScoringInput` da spec é exatamente `{ subscriber, subscription, plan, engagementEvents,
paymentEvents, rawReason }` — ou seja, dado um `subscriptionId` eu tenho que conseguir montar
  a entrada inteira do Agente de Scoring. O schema é desenhado para que essa montagem seja
  barata (ver a seção de índices).
- **`Subscriber` 1:N `Subscription`.** Um assinante pode ter mais de uma assinatura. Nos 7
  cenários do seed a relação é 1:1 na prática (cada cenário tem seu próprio assinante), mas o
  contrato não impõe unicidade e modelar como 1:N é o que reflete o domínio.
- **`Plan` 1:N `Subscription`.** O plano é compartilhado: os 7 cenários usam apenas 3 planos
  (`Basic`, `Standard`, `Premium`) — Premium aparece em três cenários distintos. Plano é
  cadastro, não é cópia por assinatura.
- **`Subscription` 1:N `EngagementEvent` / `PaymentEvent`.** Histórico, append-only. São as
  entradas complementares do Agente de Scoring.
- **`Subscription` 1:N `Cancellation`.** _Não_ é 1:1. Um cancelamento que cai em retenção
  humana, ou cuja oferta é recusada, pode ser seguido de nova tentativa do assinante mais
  tarde. O contrato não declara unicidade e eu não vou inventá-la — uma constraint `UNIQUE`
  aqui quebraria o segundo cancelamento de uma mesma assinatura.
- **`Cancellation` 1:0..1 `Offer`.** Aqui _há_ unicidade: `CancellationOutcome.offer` é um
  objeto único (não uma lista). Um cancelamento tem no máximo uma oferta, e só no caminho
  `AUTOMATIC_OFFER`. Nos outros dois caminhos (`CANCELLED`, `HUMAN_RETENTION`) não existe
  oferta nenhuma.

#### 1.2 Campos opcionais em `Cancellation` → colunas nullable

Este é o ponto mais importante da modelagem, e o TESTE.md o destaca explicitamente:
_"`Cancellation.outcome` é opcional e o schema tem de refletir isso ... não invente um valor
default"_.

A interface da spec:

```ts
export interface Cancellation {
  id: UUID;
  subscriptionId: UUID;
  rawReason: string;
  reasonCategory?: ReasonCategory; // opcional
  risk?: number; // opcional
  band?: RiskBand; // opcional
  outcome?: CancellationOutcome; // opcional
  createdAt: ISO8601;
  updatedAt: ISO8601;
}
```

Quatro campos opcionais, e o motivo é o mesmo para os quatro: **um cancelamento nasce antes de
ser decidido**. A linha do tempo de um `POST /cancellations` é:

1. O assinante envia `{ subscriptionId, rawReason }`. Isso é tudo que se sabe. A linha é
   gravada com `risk`, `band`, `reasonCategory` e outcome **vazios**.
2. O Agente de Scoring roda e devolve `risk`. O Agente de Classificação roda e devolve
   `reasonCategory`.
3. A regra de faixas converte `risk` em `band`, a regra de alto valor pode interceptar, e só
   então nasce o `outcome`.

Entre o passo 1 e o passo 3 existe um estado real e legítimo do banco em que esses campos não
têm valor. Mais que isso: no `scenario-timeout` o Agente de Scoring **estoura o
`SCORING_TIMEOUT_MS`** e `expectedRisk` é literalmente `undefined` — existe um cancelamento
que termina em `HUMAN_RETENTION` sem nunca ter tido um `risk`. A ausência é informação de
domínio, não lacuna acidental.

Por isso, no Postgres:

- `risk`, `band`, `reason_category`, `outcome_type` e `human_reason` são **`NULL`-able**;
- **nenhum deles tem `DEFAULT`**. Um default aqui seria mentira: `band = 'GREY'` por default
  diria "já sei que é zona cinzenta" quando na verdade o scoring nem rodou. `NULL` é o único
  valor que significa "ainda não determinado", e o `?` do TypeScript mapeia exatamente para
  isso. O código de decisão vai ter que tratar o `null` de propósito — é a spec forçando a
  distinção entre _"não decidido"_ e _"decidido como X"_.

`rawReason` continua **`NOT NULL`**: é o que o assinante escreveu, chega junto com o request e
nunca falta.

#### 1.3 Como funcionam os ids

Os ids são **UUID v7 (RFC 9562)** — string com formato validado em runtime por `isUUIDv7()` /
`assertUUIDv7()` no contracts, e tipo _branded_ (`UUIDv7`) no TypeScript para que um `string`
qualquer não seja atribuível por acidente.

Há duas origens de id, e elas não competem:

- **Ids fixos (seed).** Os 7 cenários têm ids **determinísticos**: `scenarios.ts` deriva cada
  id de um seed estável via `fnv1a` + `uuidv7(seed)` — por exemplo `uuidv7("subscription:
scenario-low")`. O resultado é o mesmo byte a byte em toda execução. É isso que permite um
  teste escrever "o cenário `scenario-timeout` tem que cair em `HUMAN_RETENTION`" e encontrar
  a linha pelo id, e é isso que permite ao mock determinístico do Agente de Scoring usar
  `subscriptionId` como chave de lookup (`scenario-*` → `expectedRisk`). Se o banco gerasse
  ids, essa ponte entre seed, mock e teste se perderia.
- **Ids novos (runtime).** Um cancelamento criado por `POST /cancellations` não existe em
  `scenarios.ts`. Ele precisa de um id novo, gerado na hora — e gerado como UUID v7, para
  continuar passando no `assertUUIDv7` do contracts e para manter a ordenação temporal que o
  v7 dá de graça (os 48 bits mais significativos são o timestamp em ms).

A conciliação no schema está na seção 4.4: **`id` é `String @id @db.Uuid` sem `@default`** — o
banco nunca inventa id, quem escreve sempre informa. O seed informa o id fixo do contracts; o
app, em runtime, informa um UUID v7 recém-gerado. Um único caminho de código, duas origens de
valor.

<!-- as seções seguintes são preenchidas na implementação desta tarefa -->

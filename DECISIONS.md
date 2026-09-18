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

A conciliação no schema está na seção 3.6: **`id` é `String @id @db.Uuid` sem `@default`** — o
banco nunca inventa id, quem escreve sempre informa. O seed informa o id fixo do contracts; o
app, em runtime, informa um UUID v7 recém-gerado. Um único caminho de código, duas origens de
valor.

### 2. Escolha do ORM: Prisma

O scaffold já vinha com o driver `pg` cru (`DbModule`, `Pool` injetável). Ele continua no
projeto — o `/health` usa e o `@prisma/adapter-pg` roda por cima dele — mas o acesso a dados do
domínio passa pelo **Prisma 7**.

**Por que Prisma:**

- **Schema declarativo como fonte da verdade.** `schema.prisma` é um arquivo só, legível, que
  descreve as sete entidades. Numa entrevista técnica eu consigo abrir esse arquivo lado a lado
  com `types.ts` e mostrar linha a linha que a tradução é fiel. Com SQL cru a mesma informação
  fica espalhada entre migrations.
- **Migrations versionadas e determinísticas.** `prisma migrate dev` gera SQL explícito em
  `prisma/migrations/<timestamp>_<nome>/migration.sql`, que vai para o Git e é revisável. Não é
  um `sync` mágico: o SQL que roda em produção é exatamente o que está commitado. E o Prisma
  detecta _drift_ (banco fora de sincronia com as migrations), o que dá segurança para o
  avaliador reproduzir.
- **Tipos derivados do schema.** O client gerado é tipado a partir do schema, então o contrato
  `types.ts` → schema → código fica checado pelo compilador em vez de por convenção. Isso
  importa muito aqui, porque a rubrica trata `any` em ponto de decisão como reprovação: com
  Prisma eu não preciso de `any` para mapear um `row` de `pg`.
- **SQL continua acessível.** Prisma não me tranca fora do banco: `prisma.$queryRaw` existe
  para o que o ORM não expressa bem. Isso é decisivo em dois pontos deste teste — a **regra de
  alto valor**, que a spec exige derivar dos dados (`SELECT DISTINCT price_cents ...`), e o
  `EXPLAIN` que justifica os índices. O ORM não pode ser uma parede entre mim e o plano de
  execução.

**Alternativas consideradas:**

| Alternativa          | Por que não                                                                                                                                                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Drizzle ORM**      | Foi a alternativa séria, e em alguns aspectos superior: SQL mais próximo, sem engine externa, bundle menor. Perdeu por causa das migrations — o `drizzle-kit` é bem menos maduro em detecção de drift e em _reset_ reprodutível, e esta entrega precisa que o avaliador rode migration + seed do zero e dê certo. |
| **TypeORM**          | Padrão histórico no ecossistema NestJS, mas o modelo de entidades por decorator espalha a spec em sete arquivos e as migrations geradas têm fama merecida de imprevisíveis. Não quero depurar migration durante a defesa.                                                                                         |
| **`pg` puro + Knex** | Controle total do SQL, zero abstração — mas todo o mapeamento `row → entidade` vira código manual e não tipado, exatamente onde a rubrica pune `any`. O custo não se paga num domínio de sete tabelas.                                                                                                            |

**O que o Prisma 7 mudou e como configurei.** Na versão 7 a URL de conexão **saiu** do
`schema.prisma` (`datasource { url = env(...) }` foi removido) e o client passou a exigir um
_driver adapter_. Então:

- `apps/backend/prisma.config.ts` carrega `dotenv/config` e entrega a `DATABASE_URL` ao CLI
  (migrate, seed, generate);
- em runtime o `PrismaClient` recebe `new PrismaPg({ connectionString })`, reaproveitando o
  driver `pg` que já era dependência do projeto;
- o fallback (`postgres://postgres:postgres@localhost:5432/smart_retention`) é o mesmo de
  `src/db/db.module.ts`, então clone limpo sem `.env` continua funcionando, como o
  `.env.example` promete.

> **Ponto a revisar:** essa string de fallback aparece hoje em três lugares
> (`db.module.ts`, `prisma.config.ts`, `prisma/seed.ts`). Deixei duplicada de propósito nesta
> tarefa para não refatorar o `DbModule` fora de escopo; na tarefa em que o `PrismaService`
> entrar no Nest, ela vira uma função só.

### 3. Fidelidade à spec: as decisões de modelagem não óbvias

#### 3.1 Enums como tipos nativos do Postgres

Os nove enums viraram `CREATE TYPE ... AS ENUM`, não `TEXT` com `CHECK`. Motivo: o banco passa
a recusar `'MAYBE'` em `band` na hora do `INSERT`, então a spec é garantida na camada mais
baixa, e não só pelo TypeScript (que some em runtime). O custo conhecido é que adicionar um
valor exige `ALTER TYPE` — mas a spec está **congelada**, então esse custo não existe aqui.

#### 3.2 Colunas em `snake_case`

Cada campo tem `@map` e cada modelo tem `@@map`. Isso é mais verboso no schema, e foi de
propósito: o Postgres rebaixa identificadores não aspeados para minúsculas, então uma coluna
`priceCents` só é consultável como `"priceCents"`, com aspas, em todo SQL escrito à mão. O
README do contracts já escreve `SELECT DISTINCT price_cents ...` ao fixar a fórmula da regra de
alto valor, e vamos colar `EXPLAIN` aqui neste documento. SQL cru legível vale a verbosidade.

#### 3.3 `outcome` achatado + `Offer` em tabela própria

`CancellationOutcome { type, offer?, humanReason? }` é um objeto aninhado no TypeScript, e
objeto aninhado não existe em tabela relacional. Duas partes, dois destinos:

- **`type` e `humanReason` viram colunas de `cancellations`** (`outcome_type`, `human_reason`,
  ambas nullable). São escalares que pertencem ao próprio cancelamento e são lidos junto com
  ele em todas as consultas (`GET /cancellations/:id`, `/metrics`). Criar uma tabela
  `outcomes` 1:1 só para eles custaria um JOIN em toda leitura para não ganhar nada.
- **`offer` vira a tabela `offers`**, ligada 1:0..1 por `UNIQUE (cancellation_id)`. Aqui a
  separação se paga: `Offer` é uma entidade de primeira classe no contracts (tem `id` próprio,
  `createdAt`, `updatedAt` e **ciclo de vida independente** — os endpoints
  `POST /cancellations/:id/accept` e `/decline` mudam `Offer.status` sem mexer no
  cancelamento). Achatá-la em `cancellations` criaria cinco colunas nullable extras que só
  fazem sentido em um dos três caminhos do outcome, e perderia o `updated_at` da oferta.

Então o "objeto outcome" da API é **reconstruído na borda**: o mapper lê `outcome_type`,
`human_reason` e a `offer` relacionada e monta o `CancellationOutcome` da resposta. Se
`outcome_type` for `NULL`, `outcome` é `undefined` — que é exatamente o que a spec descreve.

Alternativa descartada: guardar `outcome` como `JSONB`. Seria fiel ao formato, mas o
`/metrics` precisa agrupar por `outcome_type` e por `band`; fazer isso dentro de JSONB troca
colunas tipadas e indexáveis por expressões, sem nenhum ganho, num objeto cujo formato é
congelado.

#### 3.4 Nullable sem default

Detalhado na seção 1.2. Em resumo: `reason_category`, `risk`, `band`, `outcome_type` e
`human_reason` são `NULL`-able e **sem `DEFAULT`**, porque "ainda não decidido" é um estado
real do domínio e qualquer default mentiria sobre ele. `scenario-timeout` é a prova viva —
termina em `HUMAN_RETENTION` com `risk` nunca preenchido.

#### 3.5 `risk` como `numeric(3,2)`, não `float`

Risco é uma grandeza limitada (`0.00`–`1.00`) com duas casas decimais, e os limiares
`LOW_RISK_THRESHOLD` / `HIGH_RISK_THRESHOLD` são **exclusivos** — a spec insiste que `0.30` e
`0.70` exatos caem na zona cinzenta. Em ponto flutuante binário `0.3` não é representável
exatamente; em `numeric(3,2)` é. Como a fronteira é justamente onde a regra decide, escolhi o
tipo exato.

O custo é que o Prisma devolve `Decimal` (decimal.js) e o contracts pede `number` — então tem
um `.toNumber()` no mapeamento. Esse custo é ~zero na prática, porque um mapper já era
inevitável: o contracts tipa todos os timestamps como `ISO8601` (string) e o Prisma devolve
`Date`. A camada de tradução banco → contrato existe de qualquer jeito.

`numeric(3,2)` também já limita a escala e o valor máximo a `9.99`. Uma constraint
`CHECK (risk BETWEEN 0 AND 1)` seria mais precisa, mas o Prisma não a representa no schema e
ela apareceria como _drift_ nas próximas `migrate dev`. Optei por manter o schema como fonte
única e deixar o intervalo para a validação da camada de aplicação.

#### 3.6 Ids: `String @id @db.Uuid`, sem `@default`

Como explicado em 1.3, o banco **nunca** gera id. Nem `@default(uuid())`, nem
`@default(dbgenerated("gen_random_uuid()"))` — os dois gerariam **UUID v4**, que falharia no
`assertUUIDv7()` do contracts (o nibble de versão tem que ser `7`), e ambos atropelariam os ids
fixos do seed.

`@db.Uuid` usa o tipo `uuid` nativo do Postgres: 16 bytes em vez dos 36 de um `text`, com
comparação e índice mais baratos. E UUID v7 tem um bônus real aqui: os 48 bits mais
significativos são o timestamp em ms, então ids gerados em sequência são quase ordenados — o
B-tree da PK sofre muito menos fragmentação do que sofreria com v4 aleatório.

`created_at` e `updated_at` têm `@default(now())` — isso é só conveniência para o runtime e
não conflita com o seed, que sempre passa os valores explícitos do contracts.

#### 3.7 Por que **não** usei `@updatedAt`

O atalho natural seria `updatedAt DateTime @updatedAt`, deixando o Prisma gerenciar. Não usei:
o seed é idempotente via `upsert`, e um `updated_at` gerenciado pelo ORM seria reescrito para
`now()` a cada execução — as linhas parariam de ser idênticas entre execuções, que é
exatamente a propriedade que o enunciado pede ("rodar duas vezes não duplica"). Além disso, no
contracts `updatedAt` é **dado de domínio** (cada cenário declara o seu), não metadado do ORM.
Quem escreve informa o valor; o `@default(now())` cobre o caso comum de criação em runtime.

Isso é verificável: rodei o seed duas vezes e comparei o `md5` do conteúdo das tabelas —
idêntico.

#### 3.8 `benefits` como `text[]`

`Plan.benefits: string[]` virou array nativo do Postgres. Uma tabela `plan_benefits` seria mais
"normalizada", mas benefícios aqui são uma lista ordenada de rótulos de exibição: nunca são
consultados isoladamente, nunca são filtrados, nunca têm atributos próprios. Tabela filha só
traria um JOIN e a obrigação de guardar a ordem à mão.

#### 3.9 Comportamento de deleção (`onDelete`)

Escolhi explicitamente em vez de aceitar o default:

| Relação                            | `onDelete` | Por quê                                                                                                          |
| ---------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `Subscription` → `Subscriber`      | `Restrict` | Não se apaga um assinante deixando assinatura órfã; a remoção é uma decisão de negócio, não um efeito colateral. |
| `Subscription` → `Plan`            | `Restrict` | Plano em uso não pode sumir — inclusive porque o corte de alto valor é derivado dos preços cadastrados.          |
| `EngagementEvent` → `Subscription` | `Cascade`  | Histórico de uso não tem significado sem a assinatura.                                                           |
| `PaymentEvent` → `Subscription`    | `Cascade`  | Idem.                                                                                                            |
| `Cancellation` → `Subscription`    | `Restrict` | Cancelamento é registro de decisão e alimenta o `/metrics` (custo evitado). Não pode evaporar num cascade.       |
| `Offer` → `Cancellation`           | `Cascade`  | Oferta não existe sem o cancelamento que a originou.                                                             |

#### 3.10 `Subscriber.email` como `UNIQUE`

O contracts não declara a constraint, mas e-mail é a chave natural de um assinante e permitir
dois cadastros com o mesmo e-mail é um bug de domínio esperando acontecer. A constraint traz um
índice junto, que serve a qualquer busca por e-mail. É a única regra que acrescentei além da
spec — registro aqui para ficar explícito.

### 4. Índices

Regra que segui: **cada índice precisa de uma consulta que o justifique**. Índice não é grátis
— custa escrita em todo `INSERT`/`UPDATE` e ocupa espaço. Ficaram seis (três deles vêm de
constraints de unicidade, que o Postgres implementa com índice):

| #   | Índice                                                          | Tabela              | Consulta que serve                                               |
| --- | --------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------- |
| 1   | `cancellations_subscription_id_idx` (`subscription_id`)         | `cancellations`     | histórico de cancelamentos de uma assinatura + integridade da FK |
| 2   | `cancellations_outcome_type_band_idx` (`outcome_type`, `band`)  | `cancellations`     | agregações do `GET /metrics`                                     |
| 3   | `engagement_events_subscription_id_occurred_at_idx`             | `engagement_events` | eventos de engajamento de uma assinatura, mais recentes primeiro |
| 4   | `payment_events_subscription_id_date_idx`                       | `payment_events`    | eventos de pagamento de uma assinatura, mais recentes primeiro   |
| 5   | `subscriptions_subscriber_id_idx` / `subscriptions_plan_id_idx` | `subscriptions`     | FKs — verificação de integridade e navegação reversa             |
| 6   | `offers_cancellation_id_key` (UNIQUE)                           | `offers`            | impõe o 1:0..1 e é o caminho de leitura da oferta                |

Um a um:

**1. `cancellations (subscription_id)`**
O Postgres **não** cria índice automático para chave estrangeira — cria só para PK e UNIQUE.
Sem este índice, toda consulta por assinatura vira _seq scan_, e a verificação de integridade
ao mexer em `subscriptions` também. Serve a:

```sql
SELECT * FROM cancellations WHERE subscription_id = $1 ORDER BY created_at DESC;
```

Por que não `UNIQUE`: como argumentado em 1.1, a mesma assinatura pode gerar mais de um
cancelamento (retenção humana que não resolve, oferta recusada, nova tentativa depois).

**2. `cancellations (outcome_type, band)`**
Este é o índice do `GET /metrics`. O `MetricsResponse` pede, tudo sobre a mesma tabela:
`totalCancellations`, `automaticCancellations`, `humanRetentions` (contagens por
`outcome_type`) e `riskDistribution` (contagem por `band`).

```sql
SELECT outcome_type, band, count(*)
FROM cancellations
GROUP BY outcome_type, band;
```

Um índice composto `(outcome_type, band)` **cobre** essa consulta: as duas colunas estão no
índice, então o Postgres pode resolver tudo com _index-only scan_, sem tocar no heap — e a
tupla do índice é bem mais estreita que a linha inteira (que carrega `raw_reason`, texto
livre). Escolhi um composto em vez de dois índices de coluna única porque duas colunas de
baixa cardinalidade separadas quase nunca são escolhidas pelo planner, enquanto o composto
serve tanto o agrupamento duplo quanto, pelo prefixo à esquerda, um filtro só por
`outcome_type`.

**Honestidade sobre o tamanho:** com as dezenas de linhas que a PoC gera, o planner vai
preferir _seq scan_ mesmo com o índice existindo — ler 1 página inteira é mais barato que
qualquer índice. Este índice é uma aposta de escala, não um ganho hoje, e o `EXPLAIN` abaixo
vai mostrar isso. Mantive porque `/metrics` é a consulta que mais cresce com o volume e é a
única agregação recorrente do sistema.

**3. `engagement_events (subscription_id, occurred_at)` e 4. `payment_events (subscription_id, date)`**
São as tabelas que mais crescem — cada login, cada playback, cada cobrança vira uma linha. E
são lidas sempre do mesmo jeito, porque o `ScoringInput` da spec exige montar o histórico de
**uma** assinatura:

```sql
SELECT * FROM engagement_events WHERE subscription_id = $1 ORDER BY occurred_at DESC;
SELECT * FROM payment_events    WHERE subscription_id = $1 ORDER BY date        DESC;
```

O composto faz três trabalhos com um índice só: (a) indexa a FK, (b) resolve o `WHERE` pelo
prefixo à esquerda, (c) entrega as linhas **já ordenadas**, eliminando o passo de `Sort`. Não
declarei `sort: Desc` porque o Postgres percorre um B-tree ascendente de trás para frente sem
custo adicional — o índice serve `ASC` e `DESC` igualmente.

**5. `subscriptions (subscriber_id)` e `subscriptions (plan_id)`**
Os dois são índices de FK. A razão principal é de integridade, não de leitura: sem índice no
lado filho, todo `UPDATE`/`DELETE` em `subscribers` ou `plans` obriga o Postgres a varrer
`subscriptions` inteira para checar a constraint. São também o caminho natural de "assinaturas
deste assinante" e "assinaturas neste plano". São os índices mais especulativos do conjunto
(nenhum endpoint do escopo filtra por eles hoje) e os primeiros que eu removeria se o perfil de
escrita apertasse.

**6. `offers (cancellation_id)` UNIQUE**
Não é otimização, é **modelagem**: o `UNIQUE` é o que impõe "no máximo uma oferta por
cancelamento". O índice vem junto, de graça, e é por ele que se lê a oferta ao montar o
outcome e nos endpoints de accept/decline.

**O que decidi NÃO indexar, e por quê:**

- `cancellations (created_at)` — nenhum contrato pede recorte por período: o `MetricsResponse`
  não tem filtro de data. Entra no dia em que existir "métricas dos últimos 30 dias".
- `plans (price_cents)` — a regra de alto valor faz `SELECT DISTINCT price_cents FROM plans`,
  mas `plans` é tabela de dimensão com um punhado de linhas. Índice aqui só adicionaria custo
  de escrita.
- `subscriptions (status)` — cardinalidade três. Um índice em coluna de baixíssima
  cardinalidade quase nunca é usado; se a listagem passar a filtrar `ACTIVE` sobre um volume
  grande, o certo é um índice **parcial** (`WHERE status = 'ACTIVE'`), não um b-tree completo.
- `cancellations (band)` sozinho — já é servido pelo composto do item 2 quando combinado com
  `outcome_type`; sozinho tem cardinalidade três e o mesmo problema acima.

#### Verificação com `EXPLAIN`

Com o banco populado, os planos de execução se conferem assim (o `ANALYZE` executa de verdade
e mostra o tempo real, não só a estimativa):

```bash
docker exec -it smart-retention-db psql -U postgres -d smart_retention
```

```sql
-- 1. histórico de cancelamentos de uma assinatura  → cancellations_subscription_id_idx
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM cancellations WHERE subscription_id = '<uuid>' ORDER BY created_at DESC;

-- 2. agregação do GET /metrics  → cancellations_outcome_type_band_idx
EXPLAIN (ANALYZE, BUFFERS)
SELECT outcome_type, band, count(*) FROM cancellations GROUP BY outcome_type, band;

-- 3. engajamento de uma assinatura  → engagement_events_subscription_id_occurred_at_idx
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM engagement_events WHERE subscription_id = '<uuid>' ORDER BY occurred_at DESC;

-- 4. pagamentos de uma assinatura  → payment_events_subscription_id_date_idx
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM payment_events WHERE subscription_id = '<uuid>' ORDER BY date DESC;
```

Um `<uuid>` de assinatura sai de `SELECT id FROM subscriptions LIMIT 1;`.

Lembrete ao ler a saída: com o volume do seed é normal aparecer `Seq Scan` — o planner está
certo, varrer uma tabela de uma página é mais barato que qualquer índice. Para ver o índice
sendo escolhido, ou se popula volume, ou se força com `SET enable_seqscan = off;` (só para
inspeção, nunca como configuração).

<!-- EXPLAIN aqui -->

### 5. Como rodar

Pré-requisitos: Node 22+, pnpm 11+, Docker.

```bash
# 1. Postgres
cp .env.example .env          # credenciais do docker compose (só na primeira vez)
pnpm db:up                    # sobe o Postgres em localhost:5432

# 2. Variáveis do backend
cp apps/backend/.env.example apps/backend/.env   # DATABASE_URL e PORT

# 3. Client do Prisma (o postinstall já faz isso depois de `pnpm install`)
pnpm --filter @repo/backend db:generate

# 4. Migration
pnpm --filter @repo/backend db:migrate           # prisma migrate dev

# 5. Seed dos 7 cenários
pnpm --filter @repo/backend db:seed
```

Saída esperada do seed:

```
seed concluido {
  scenarios: 7,
  plans: 3,
  subscribers: 7,
  subscriptions: 7,
  engagementEvents: 13,
  paymentEvents: 11
}
```

São 3 planos (e não 7) porque os cenários compartilham `Basic`, `Standard` e `Premium` — três
cenários diferentes usam o Premium. É o esperado.

| Script (em `apps/backend`) | O que faz                                                               |
| -------------------------- | ----------------------------------------------------------------------- |
| `pnpm db:generate`         | gera o Prisma Client a partir do schema                                 |
| `pnpm db:migrate`          | `prisma migrate dev` — cria e aplica migration a partir do schema       |
| `pnpm db:migrate:deploy`   | `prisma migrate deploy` — aplica migrations existentes (CI/produção)    |
| `pnpm db:seed`             | `prisma db seed` — carrega os 7 cenários (idempotente)                  |
| `pnpm db:status`           | `prisma migrate status` — diz se o banco está em dia com as migrations  |
| `pnpm db:studio`           | `prisma studio` — GUI para navegar nos dados                            |
| `pnpm db:reset`            | `prisma migrate reset` — **apaga o banco**, reaplica tudo e roda o seed |

O comando de seed está registrado em `apps/backend/prisma.config.ts`
(`migrations.seed: "pnpm exec tsx prisma/seed.ts"`). No Prisma 7 essa configuração mora aí, e
não mais na chave `prisma` do `package.json`.

Para conferir que o banco populou:

```bash
docker exec -it smart-retention-db psql -U postgres -d smart_retention \
  -c "select name, price_cents from plans order by price_cents;" \
  -c "select count(*) from subscriptions;"
```

### 6. Comandos úteis (referência)

Tudo roda **a partir da raiz do repositório**. Sem exceção: `pnpm --filter <pacote> <script>`
funciona de qualquer diretório e é o que evita rodar o script errado no pacote errado.

#### Banco (Docker)

| Comando                     | O que faz                                               |
| --------------------------- | ------------------------------------------------------- |
| `pnpm db:up`                | sobe o Postgres em `localhost:5432` (docker compose)    |
| `pnpm db:down`              | derruba os containers (o volume de dados **permanece**) |
| `docker compose down -v`    | derruba **e apaga o volume** — banco zerado de verdade  |
| `docker compose logs -f db` | acompanha o log do Postgres                             |
| `docker compose ps`         | mostra o estado e o healthcheck do container            |

#### Prisma (schema, migrations, seed)

Todos com o prefixo `pnpm --filter @repo/backend`:

| Comando                    | O que faz                                                                   |
| -------------------------- | --------------------------------------------------------------------------- |
| `db:generate`              | gera o Prisma Client a partir do schema (roda sozinho no `postinstall`)     |
| `db:migrate`               | `prisma migrate dev` — detecta mudança no schema, cria e aplica a migration |
| `db:migrate --name <nome>` | idem, nomeando a migration em vez de responder ao prompt                    |
| `db:migrate:deploy`        | `prisma migrate deploy` — só aplica o que já existe; é o comando de CI/prod |
| `db:status`                | diz se o banco está em dia com as migrations, e o que falta aplicar         |
| `db:seed`                  | carrega os 7 cenários (idempotente — pode rodar quantas vezes quiser)       |
| `db:reset`                 | **apaga o banco**, reaplica todas as migrations e roda o seed               |
| `db:studio`                | abre o Prisma Studio (GUI) em `localhost:5555`                              |

Dois comandos sem script, para quando precisar:

```bash
# valida o schema.prisma sem tocar no banco
pnpm --filter @repo/backend exec prisma validate

# formata o schema.prisma (alinha colunas, ordena atributos)
pnpm --filter @repo/backend exec prisma format
```

**Qual usar quando:**

- mexeu no `schema.prisma` → `db:migrate` (gera a migration nova)
- acabou de clonar, ou quer o banco limpo com os 7 cenários → `db:reset`
- só quer repopular sem perder o schema → `db:seed`
- o Prisma reclamou de tipo que não existe depois de um `git pull` → `db:generate`
- "será que minha migration aplicou?" → `db:status`

#### Desenvolvimento

| Comando                                  | O que faz                                    |
| ---------------------------------------- | -------------------------------------------- |
| `pnpm install`                           | instala o workspace (e gera o Prisma Client) |
| `pnpm dev:backend`                       | API em `http://localhost:3000` (watch)       |
| `pnpm dev:frontend`                      | UI em `http://localhost:3001`                |
| `pnpm dev`                               | os dois ao mesmo tempo                       |
| `pnpm --filter @repo/backend start:repl` | REPL do Nest, para chamar service na mão     |
| `pnpm build`                             | build dos três pacotes, na ordem certa       |

Instalar dependência — **sempre com filtro, a partir da raiz**:

```bash
pnpm --filter @repo/backend  add <pkg>        # dependência de runtime
pnpm --filter @repo/backend  add -D <pkg>     # dependência de desenvolvimento
pnpm --filter @repo/frontend add <pkg>
```

#### Qualidade

| Comando                                  | O que faz                                        |
| ---------------------------------------- | ------------------------------------------------ |
| `pnpm verify`                            | **o portão**: lint + typecheck + test + test:e2e |
| `pnpm lint` / `pnpm typecheck`           | só a etapa correspondente, nos três pacotes      |
| `pnpm test`                              | testes unitários dos três pacotes                |
| `pnpm --filter @repo/backend test:watch` | vitest em watch, só no backend                   |
| `pnpm --filter @repo/backend test:cov`   | cobertura do backend                             |
| `pnpm format`                            | prettier nos pacotes                             |
| `pnpm format:root`                       | prettier nos `.md` da raiz (inclui este arquivo) |

O turbo cacheia por conteúdo: repetir `pnpm verify` sem mudar nada termina em milissegundos
(`>>> FULL TURBO`). Se desconfiar do cache, `pnpm clean` derruba tudo — mas ele **também apaga
`node_modules`** e exige `pnpm install` depois.

#### `psql` no banco populado

```bash
# sessão interativa
docker exec -it smart-retention-db psql -U postgres -d smart_retention
```

Dentro do `psql`: `\dt` lista as tabelas, `\d cancellations` descreve uma tabela **com os
índices**, `\di` lista todos os índices, `\q` sai.

Consultas de conferência que uso direto:

```bash
# o que o seed carregou
docker exec -it smart-retention-db psql -U postgres -d smart_retention -c "
  select 'plans' t, count(*) from plans
  union all select 'subscribers',       count(*) from subscribers
  union all select 'subscriptions',     count(*) from subscriptions
  union all select 'engagement_events', count(*) from engagement_events
  union all select 'payment_events',    count(*) from payment_events
  union all select 'cancellations',     count(*) from cancellations
  union all select 'offers',            count(*) from offers;"

# o corte de alto valor, derivado dos dados (nunca hardcoded)
docker exec -it smart-retention-db psql -U postgres -d smart_retention -c "
  select distinct price_cents from plans order by price_cents;"

# prova de que o seed é idempotente: rode duas vezes, o hash não muda
docker exec -it smart-retention-db psql -U postgres -d smart_retention -At -c "
  select md5(string_agg(t::text, '|' order by t::text)) from (select * from subscriptions) t;"
```

### 7. Uso de IA

Esta tarefa (modelagem, `schema.prisma`, migration e seed) foi feita **com assistência de IA**
— Claude Code, em sessão interativa, com revisão minha a cada passo.

Como foi o processo, para ficar registrado com precisão:

- **Eu dirigi o escopo e as restrições**: não tocar em `packages/contracts/`, não hardcodar
  limiares, manter `pnpm verify` verde, commits incrementais.
- **O agente leu a spec primeiro** (`types.ts`, `scenarios.ts`, `README.md`) e produziu o
  resumo do domínio da seção 1 **antes** de gerar qualquer arquivo — foi essa leitura que
  guiou a modelagem, em vez de o schema sair de um palpite sobre nomes de entidade.
- **As decisões que exigiam julgamento foram discutidas, não delegadas**: `numeric(3,2)` vs
  `float` para o risco, achatar o outcome vs tabela `outcomes`, não usar `@updatedAt`, e
  principalmente quais índices criar e quais recusar. Cada uma está justificada acima com a
  consulta que a motiva.
- **Verificação empírica, não confiança**: a migration foi aplicada num Postgres real, o seed
  rodou duas vezes e a idempotência foi conferida comparando o `md5` do conteúdo das tabelas,
  e `pnpm verify` foi executado ao final.

Assumo a responsabilidade pelo resultado e consigo defender cada decisão deste documento.

---

## Tarefa 02 — Regras de decisão (camada pura)

Esta é a camada que decide, a partir do risco de churn, o que acontece com um cancelamento.
Ela não sabe o que é HTTP, não sabe o que é Postgres e não sabe o que é NestJS.

Dois arquivos, sem dependência de framework:

| Arquivo                                       | Contém                                                          |
| --------------------------------------------- | --------------------------------------------------------------- |
| `apps/backend/src/decision/risk-band.ts`      | Regra 1 — `toBand(risk)`: risco → faixa                         |
| `apps/backend/src/decision/decision.rules.ts` | Regras 2 e 3 — `decideOutcome`, `decide`, os três `humanReason` |

### 8. Por que a camada é pura e isolada

"Pura" aqui significa literalmente: mesma entrada, mesma saída, sempre; nenhum efeito
colateral; nenhuma leitura do mundo externo. Sem `fetch`, sem `prisma`, sem `Date.now()`, sem
`process.env`, sem `@Injectable()`.

Três razões, em ordem de importância para este teste:

**1. É a parte que mais é testada, então precisa ser a mais fácil de testar.** Um teste de
fronteira aqui é literalmente `expect(toBand(0.3)).toBe(RiskBand.GREY)` — sem subir módulo do
Nest, sem mockar repositório, sem banco, sem `async`. Os 41 testes rodam em ~120 ms. Se a regra
estivesse dentro de um service com `@Inject(PrismaService)`, cada caso de fronteira exigiria um
`Test.createTestingModule` e um mock, e o custo de escrever o 15º caso de teste desencorajaria
escrever o 15º caso de teste. A facilidade de testar não é conforto: é o que determina quantos
casos vão existir de fato.

**2. A regra de negócio fica legível como regra de negócio.** `decision.rules.ts` pode ser lido
por alguém que não programa em TypeScript — é um `switch` sobre três faixas. Quando a área de
negócio mudar a política ("agora alto valor também intercepta em GREY"), a mudança é uma linha,
num arquivo, com um teste que falha se a mudança for parcial.

**3. Separação de responsabilidade, com um caso concreto: `isHighValue`.** Ver seção 12.

### 9. Por que separei `toBand` do mapa de outcome

São **duas decisões de negócio independentes**, que mudam por motivos diferentes e em ritmos
diferentes:

- `toBand` responde _"quão arriscado é este cancelamento?"_ — é calibração de modelo. Mexer nos
  limiares é uma decisão de data science.
- `decideOutcome` responde _"o que a empresa faz com esse nível de risco?"_ — é política
  comercial. Interceptar alto valor é uma decisão de operação/retenção.

Se estivessem na mesma função, todo teste de política teria que passar por um risco numérico
(`decide({ risk: 0.85, ... })`), e eu estaria testando duas regras ao mesmo tempo: um teste de
interceptação de alto valor que falha não diria se o bug é na faixa ou no mapa. Separadas,
`decideOutcome(RiskBand.HIGH, true)` testa a política **sem tocar em número nenhum** — repare
que `decision.rules.spec.ts` inteiro, na parte da Regra 2, não tem um único risco.

`decide(input)` existe por cima das duas, como a composição que o chamador vai usar de fato. É
a única das três que conhece o timeout.

### 10. Os três caminhos até a retenção humana

Este é o ponto mais sutil da tarefa, e o que eu mais quero defender. **Três causas diferentes
produzem o mesmo par `band = GREY` / `outcome = HUMAN_RETENTION`** — mas não são a mesma coisa,
e achatar as três num motivo só destruiria informação:

| Caminho                        | `humanReason`                       | O que realmente aconteceu                                                   |
| ------------------------------ | ----------------------------------- | --------------------------------------------------------------------------- |
| Risco entre os limiares        | `grey zone`                         | O modelo respondeu, e a resposta dele é "não sei o suficiente para decidir" |
| `HIGH` + alto valor recorrente | `high recurring value at high risk` | O modelo respondeu com confiança; a **política** é que vetou o automático   |
| Timeout do Agente de Scoring   | `scoring agent timeout`             | O modelo **não respondeu**. Não houve decisão nenhuma, houve uma falha      |

Por que a distinção importa, concretamente:

- **Para quem atende.** O especialista que abre a fila de retenção humana precisa de abordagens
  diferentes. `grey zone` é um caso comum. `high recurring value at high risk` é um assinante
  caro prestes a sair — tem urgência e provavelmente alçada maior de desconto. `scoring agent
timeout` é um caso que nem foi avaliado: pode ser um cancelamento trivial que só caiu ali por
  azar de infraestrutura.
- **Para quem opera o sistema.** Um pico de `grey zone` diz que o modelo está mal calibrado. Um
  pico de `scoring agent timeout` é **incidente de produção** e acorda alguém. Se as duas coisas
  compartilhassem a mesma string, esse alerta seria impossível de escrever.
- **Para a métrica de Custo Evitado.** A PoC existe para provar redução de casos que vão para o
  humano. Casos que foram para o humano por falha técnica são custo que o sistema deveria ter
  evitado e não evitou — contá-los junto com a zona cinzenta legítima mascararia exatamente o
  número que o projeto quer mostrar.

Por isso o fallback de timeout, em `decide()`, **não** reaproveita `decideOutcome(GREY, ...)`.
Seria tentador (o resultado é o mesmo par), e estaria errado: o `humanReason` sairia como
`grey zone`, afirmando uma indecisão do modelo que nunca existiu.

Os três textos vivem numa constante `HUMAN_REASON` no módulo da regra, e não espalhados por
`return`s. Assim é impossível haver dois lugares escrevendo "grey zone" com grafias diferentes,
e o teste "os três motivos são distintos entre si" tem onde olhar.

### 11. Por que os limites são exclusivos, e como os testes garantem isso

A spec é explícita: `risk < 0.30` é `LOW`, `risk > 0.70` é `HIGH`, e **`0.30` e `0.70` exatos
caem em `GREY`**. A faixa cinzenta é fechada dos dois lados; as pontas são abertas.

A lógica de negócio por trás disso é conservadora, e é coerente: na dúvida, um humano decide. O
limiar é uma linha arbitrária traçada sobre um número contínuo — um risco de exatamente `0.700`
não é materialmente diferente de `0.699`. Empurrar o valor de fronteira para a ação automática
significaria automatizar justamente o caso mais próximo da incerteza.

**Como implementei.** Não como uma cadeia de três comparações, mas assim:

```ts
if (risk < LOW_RISK_THRESHOLD) return RiskBand.LOW;
if (risk > HIGH_RISK_THRESHOLD) return RiskBand.HIGH;

return RiskBand.GREY; // tudo que sobrou
```

`GREY` é o **resto**, não uma faixa testada. Isso não é economia de linha: é o que torna
estruturalmente impossível existir um risco sem faixa (buraco) ou em duas faixas
(sobreposição). O bug clássico dessa regra é escrever `<=` onde devia ser `<`; aqui, a única
forma de errar é inverter um dos dois operadores — e é exatamente isso que os testes atacam.

**Como os testes garantem.** Em três camadas:

1. **Fronteiras exatas**, asseridas contra as constantes importadas, não contra literais:
   `expect(toBand(LOW_RISK_THRESHOLD)).toBe(RiskBand.GREY)`. Se alguém mudar o limiar no
   contracts, o teste continua testando a _regra_ (o limiar exato é cinzento), não um número.
2. **Vizinhança**: `0.29` → LOW, `0.31` → GREY, `0.69` → GREY, `0.71` → HIGH. Fecham o cerco
   dos dois lados de cada fronteira.
3. **Varredura completa**: de `0.00` a `1.00` de centésimo em centésimo — que é exatamente a
   escala que o banco guarda em `numeric(3,2)` (ver seção 3.5 da Tarefa 01) — conferindo que toda entrada
   cai em uma e só uma faixa.

Verifiquei que esses testes **mordem**, não só passam. Mutei a regra de propósito e rodei:

| Mutação aplicada                                  | Testes que quebraram |
| ------------------------------------------------- | -------------------- |
| `<` → `<=` no limiar inferior                     | 3                    |
| `>` → `>=` no limiar superior                     | 4                    |
| interceptação de alto valor estendida para `GREY` | 4                    |
| `humanReason` do timeout trocado por `grey zone`  | 4                    |

Um teste que passa não prova nada sozinho; um teste que falha quando o código quebra, sim.

### 12. Por que a regra recebe `isHighValue` pronto

Esta é a decisão de design que mais vale defender, porque a alternativa é sedutora.

A regra de alto valor da spec é: ordene os `priceCents` **distintos** cadastrados, calcule
`k = ceil(HIGH_VALUE_PERCENTILE * n)`, e os `k` maiores preços são de alto valor. Seria natural
a função de decisão receber a assinatura e calcular isso. Não recebe: ela recebe um `boolean`
já resolvido.

**Porque são duas responsabilidades diferentes, e só uma delas é uma regra:**

- _"quais planos são de alto valor"_ é uma pergunta **sobre o estado do banco**. A resposta
  muda quando alguém cadastra um plano novo, sem nenhuma regra ter mudado. Exige
  `SELECT DISTINCT price_cents FROM plans` — I/O, assíncrono, falível.
- _"o que fazer com um cancelamento de alto risco numa assinatura de alto valor"_ é uma
  **política**. Não depende de estado nenhum.

Se a regra pura fizesse a consulta, ela deixaria de ser pura e de ser síncrona, e todo teste de
política precisaria de um banco ou de um mock de repositório — matando as três vantagens da
seção 8 de uma vez.

E há uma consequência prática imediata: o corte é **derivado dos dados**, como a spec exige
("o avaliador pode alterar preços do seed e revalidar"). A camada que calcula o booleano lê os
preços reais; a regra não precisa saber que percentil existe. Repare que `decision.rules.ts`
**não importa `HIGH_VALUE_PERCENTILE`** — a constante só aparece em quem deriva o corte.

O mesmo raciocínio vale para `timedOut`: quem cronometra o `SCORING_TIMEOUT_MS` é o orquestrador
do agente, não a regra. A regra só recebe o veredito.

**Onde isso aparece hoje:** em `scenarios.spec.ts` há uma função `highValuePriceCents()` que
aplica a fórmula sobre os `plans` do contracts. Ela está marcada no código como **andaime de
teste**, não implementação: serve para traduzir "qual plano" em `isHighValue` e alimentar a
regra na validação cruzada. A versão de produção, que lê do banco, é de uma tarefa futura — e o
fato de a regra não notar a diferença entre as duas é justamente a prova de que a separação
funciona.

### 13. Formato da entrada e da saída

**Entrada — união discriminada, não campos opcionais:**

```ts
type DecisionInput =
  { timedOut: true } | { timedOut: false; risk: number; isHighValue: boolean };
```

A alternativa seria `{ timedOut: boolean; risk?: number; isHighValue: boolean }`. Rejeitada:
ela permite escrever o estado impossível `{ timedOut: true, risk: 0.85 }`, e obriga todo leitor
de `risk` a lembrar de checar `undefined`. Com a união, o compilador só libera `input.risk`
depois de o código provar que o scoring respondeu. **No timeout não existe risco — e não existir
é diferente de ser zero.** Zero seria o risco mais baixo possível e levaria a `CANCELLED`, que é
o oposto do que a spec manda.

`isHighValue` também só aparece no ramo com risco: no timeout a decisão é conservadora
independentemente do valor da assinatura, e oferecer o campo ali sugeriria uma influência que
não existe.

**Saída — `risk` não faz parte da `Decision`:**

```ts
interface Decision {
  band: RiskBand;
  outcomeType: OutcomeType;
  humanReason?: HumanReason; // só quando outcomeType é HUMAN_RETENTION
}
```

Quem tinha o risco é o chamador — ele já o conhece e é quem vai persistir. Devolvê-lo criaria
duas fontes para o mesmo dado, e no caminho de timeout não haveria valor nenhum para colocar
(cair num `risk: 0` de conveniência seria exatamente a invenção de número que a spec proíbe).

`humanReason` é opcional **e tipado como união dos três motivos** (`HumanReason`), não como
`string` solta: um motivo novo tem que ser declarado em `HUMAN_REASON` para existir.

### 14. Validação cruzada com os 7 cenários

Os testes de regra provam que cada peça faz o que eu digo que faz. `scenarios.spec.ts` prova
que o conjunto bate com a spec congelada: para cada um dos 7 cenários, a decisão tem que
reproduzir o `expectedBand`, o `expectedOutcome.type` e o `expectedOutcome.humanReason` que o
contracts declara.

| Cenário                    | Entrada           | Faixa | Outcome           | `humanReason`                       |
| -------------------------- | ----------------- | ----- | ----------------- | ----------------------------------- |
| `scenario-low`             | 0.15              | LOW   | `CANCELLED`       | —                                   |
| `scenario-grey`            | 0.50              | GREY  | `HUMAN_RETENTION` | `grey zone`                         |
| `scenario-high`            | 0.85, Basic       | HIGH  | `AUTOMATIC_OFFER` | —                                   |
| `scenario-high-value-high` | 0.80, **Premium** | HIGH  | `HUMAN_RETENTION` | `high recurring value at high risk` |
| `scenario-timeout`         | timeout           | GREY  | `HUMAN_RETENTION` | `scoring agent timeout`             |
| `scenario-high-value-low`  | 0.10, **Premium** | LOW   | `CANCELLED`       | —                                   |
| `scenario-grey-high-value` | 0.55, **Premium** | GREY  | `HUMAN_RETENTION` | `grey zone`                         |

Os três últimos são os casos de borda que o contracts colocou de propósito: Premium em `LOW`
cancela direto, e Premium em `GREY` sai com `grey zone` — o alto valor não encosta em nenhum
dos dois. **Os 7 batem.**

A comparação do `humanReason` é por igualdade literal com a string do cenário. A spec diz que a
avaliação olha a semântica, não a letra — mas, já que os cenários trazem exemplos, usar
exatamente esses textos torna o teste uma verificação forte em vez de uma aproximação.

### 15. Uso de IA (Tarefa 02)

Feita com assistência de IA (Claude Code), com revisão minha a cada passo, nos mesmos termos da
seção 7 (Uso de IA) da Tarefa 01.

Nesta tarefa vale registrar dois pontos específicos:

- **A separação em duas regras e o formato da entrada foram decisão de design discutida**, não
  geração automática: união discriminada em vez de `risk?: number`, `risk` fora da `Decision`,
  e o timeout não reaproveitando `decideOutcome(GREY, ...)`. Cada uma está defendida acima.
- **Os testes foram verificados por mutação.** Não aceitei "41 testes passando" como prova:
  quebrei a regra de quatro formas diferentes (as da tabela da seção 11) e confirmei que os
  testes certos falham em cada caso. Essa é a diferença entre ter cobertura e ter garantia.

---

## Tarefa 03 — Agente de Scoring e timeout

O Agente de Scoring é o componente que atribui o risco de churn a um cancelamento em
andamento. No núcleo deste teste ele é um **mock determinístico** — não há LLM nenhum. Mas a
forma como ele é montado é a parte que interessa: o agente é um _port_, o mock é um _adapter_,
e o **deadline mora fora dos dois**.

Quatro arquivos em `apps/backend/src/scoring/`:

| Arquivo                 | Papel                                                                   |
| ----------------------- | ----------------------------------------------------------------------- |
| `mock-scoring-agent.ts` | Adapter determinístico. Só produz risco e demora. Não conhece deadline. |
| `with-deadline.ts`      | A corrida contra o relógio. Genérica, sem framework.                    |
| `scoring.service.ts`    | Orquestra: injeta o agente, aplica o prazo, traduz a saída.             |
| `scoring.module.ts`     | Liga o port ao adapter pelo token `SCORING_AGENT`.                      |

### 16. Por que o timeout é do wrapper e não do mock

O enunciado é explícito ao proibir `timedOut: true` devolvido na hora, e vale entender por que
isso não é frescura de teste.

**Um agente não sabe que está atrasado.** Um adapter de LLM faz uma chamada HTTP e espera. Ele
não tem opinião sobre orçamento de tempo — quem tem é o caso de uso. A mesma chamada que é
"rápida demais para se preocupar" num job noturno é "inaceitável" num fluxo de auto-atendimento
em que o assinante está olhando para uma tela.

Colocar o deadline dentro do agente teria três consequências ruins:

1. **Cada adapter futuro reimplementaria a política.** Um `OpenAIScoringAgent` teria que
   lembrar de aplicar o mesmo prazo, com o mesmo fallback. Alguém esqueceria.
2. **Não daria para testar o mecanismo.** Se o mock decide sozinho que estourou, o teste do
   timeout está testando um `if` que lê uma flag, não a corrida contra o relógio.
3. **Seria a abstração errada.** "Quanto tempo eu topo esperar" é uma decisão de produto, do
   mesmo tipo que os limiares de risco da Tarefa 02. Ela pertence à camada que orquestra.

Por isso a divisão é literal no código: o mock **só demora** (`setTimeout` de
`SCORING_TIMEOUT_MS + 500ms` no cenário de timeout), e quem decide "demorou demais" é o
`ScoringService`.

**Ports & Adapters, concretamente.** `ScoringAgent` é uma interface da spec — o _port_.
`MockScoringAgent` é um _adapter_; um `OpenAIScoringAgent` seria outro. Ninguém depende de uma
implementação: o `ScoringService` depende do token, e o token é resolvido no
`scoring.module.ts`. Trocar o mock por um LLM é **uma linha, num arquivo**:

```ts
{ provide: SCORING_AGENT, useClass: OpenAIScoringAgent }
```

Nada mais muda — nem o service, nem o deadline, nem a regra de decisão da Tarefa 02, nem
nenhum teste que não seja do próprio adapter. E repare que o deadline aplicado por fora fica
_mais_ importante com um LLM real do que com o mock, não menos.

### 17. Como o `Promise.race` funciona, e por que isso é o caminho real

```ts
return await Promise.race([
  operation.then((value) => ({ timedOut: false, value })),
  deadline, // resolve { timedOut: true } depois de deadlineMs
]);
```

O ponto que costuma ser mal entendido: **`Promise.race` não cancela ninguém.** JavaScript não
tem como cancelar uma promessa já criada — a chamada de rede já saiu, o `setTimeout` já está
agendado. O que a corrida faz é decidir **de quem a gente vai ouvir a resposta**. O perdedor
continua rodando em segundo plano até terminar sozinho, e o resultado dele é descartado.

Isso não é limitação: é exatamente a semântica que um deadline de atendimento quer. "Passou do
tempo, eu sigo sem você" — e se a resposta chegar depois, paciência, a decisão já foi tomada.

**Por que isso exerce o caminho real.** No `scenario-timeout`, o mock agenda um `setTimeout` de
3500ms e realmente espera. O relógio do wrapper dispara aos 3000ms. A corrida acontece de
verdade, com dois timers reais competindo. Não há flag sendo lida em lugar nenhum.

Conferi por mutação que o teste prova isso, e não outra coisa:

| Mutação                                                          | Testes que quebraram |
| ---------------------------------------------------------------- | -------------------- |
| deadline afrouxado (`SCORING_TIMEOUT_MS * 10`)                   | 2                    |
| mock respondendo na hora em vez de esperar (o que a spec proíbe) | 3                    |

A primeira prova que é o **race** que produz o timeout; a segunda, que é o **mock esperando de
verdade** que faz o race valer. Se qualquer um dos dois fosse fingido, os testes ficariam
verdes indevidamente — e não ficam.

O teste do timeout leva **~3 segundos de relógio de parede, de propósito**. Com relógio falso
ele passaria em milissegundos e provaria bem menos. Os outros testes da suíte usam
`vi.useFakeTimers()`, porque neles a latência é acidental; só o teste do deadline paga o preço
real, e o comentário no arquivo diz isso para ninguém "otimizar" depois.

### 18. O timer que precisa ser limpo — e o que eu achei que precisava e não precisava

**O vazamento real: o timer do deadline.** Se a operação responde primeiro e ninguém chama
`clearTimeout`, o `setTimeout` continua agendado até o fim do prazo. Em produção isso é memória
retida a cada chamada. Em teste é pior: o Node mantém o event loop vivo enquanto houver timer
pendente, então a suíte **trava** esperando um relógio que não interessa mais — 3 segundos por
chamada bem-sucedida, num fluxo que deveria terminar em 300ms.

O `finally` limpa nos três desfechos: operação ganhou, deadline ganhou, operação falhou.

```ts
try {
  return await Promise.race([...]);
} finally {
  clearTimeout(timer);
}
```

O teste mede isso diretamente com `vi.getTimerCount()`, e não por sintoma.

**O vazamento que eu achei que existia e não existe.** O reflexo seguinte é proteger contra a
_rejeição tardia_: se o deadline vence e a operação rejeita depois, aquela promessa perdedora
viraria `unhandledRejection` — que no Node moderno derruba o processo. Escrevi um
`operation.catch(() => {})` para isso.

Depois testei **sem** ele: o teste continua passando. O motivo é que `Promise.race` anexa um
handler a _todas_ as promessas que recebe, e esse handler continua lá depois de a corrida estar
decidida. A rejeição tardia já é observada. O `.catch()` extra era código morto se passando por
proteção, então saiu — e o teste que o justificaria ficou, agora documentando o comportamento
real do `Promise.race` em vez de uma defesa imaginária.

Registro isso porque é o tipo de linha que sobrevive anos num código com um comentário
convincente e errado.

**Um detalhe que os testes também pegaram:** nos testes de rejeição, a asserção
`expect(promise).rejects` precisa ser montada **antes** de adiantar o relógio falso. Montar
depois deixa a promessa rejeitada sem ouvinte por um tick, e o Node dispara
`PromiseRejectionHandledWarning`. Os testes ficaram com um comentário explicando, porque é uma
armadilha de teste assíncrono que se repete.

### 19. Por que `latencyMs` é a latência simulada, não o tempo de parede

`ScoringResult.latencyMs` reporta a latência que o agente **simula**, não um cronômetro.

O motivo fica óbvio quando se pergunta para que serve o número. Ele é um dado de domínio:
"quanto o Agente de Scoring levou para responder" — a métrica que diria se vale trocar o modelo,
se o p95 está perto do orçamento, se o timeout está bem calibrado. Medido com relógio de parede
num mock, ele viraria uma medição do event loop do Node, que não significa nada.

Pior: no cenário de timeout, um cronômetro reportaria ~3000ms de parede — o tempo que _o
wrapper_ esperou — e alguém leria isso como "o agente respondeu em 3s", quando o agente não
respondeu coisa nenhuma.

Por isso a separação é explícita:

- **Caminho normal:** `latencyMs` vem do agente, determinístico por hash do `subscriptionId`,
  dentro de 200–1500ms. A mesma assinatura "demora" sempre o mesmo tanto, o que permite ao teste
  afirmar o valor exato em vez de checar um intervalo.
- **Caminho de timeout:** o service devolve `latencyMs: SCORING_TIMEOUT_MS` — o **orçamento
  gasto**, não uma medição. Esperamos o prazo inteiro e desistimos; quanto o agente ainda
  levaria é justamente o que não se sabe.

O teste que prova isso usa um agente fake que responde **instantaneamente** declarando
`latencyMs: 1234`. Se o service medisse o tempo de parede, viria ~0.

### 20. Por que, no timeout, o risco fica indefinido — e uma tensão na spec

No timeout o resultado **não tem risco**. Não é zero, não é o neutro: não existe.

Isso conecta direto com a união discriminada da Tarefa 02 (seção 13). Se o timeout produzisse
`risk: 0`, a regra classificaria como `LOW` e o cancelamento seguiria direto para `CANCELLED` —
o **oposto** do que a spec manda (`scenario-timeout` tem que ir para retenção humana). Um valor
default aqui não é conveniência, é um bug de negócio.

**A tensão na spec.** O `ScoringResult` do contracts declara `risk: number` — obrigatório.
Ou seja, **o tipo da spec não consegue representar o estado "estourou o prazo e não há risco"**,
apesar de o mesmo tipo ter um campo `timedOut: boolean` que descreve exatamente esse estado. As
duas coisas não fecham.

Não toquei no contracts (é congelado, e alterá-lo reprova). Resolvi introduzindo um tipo meu na
saída do service:

```ts
export type ScoringOutcome =
  | {
      timedOut: false;
      risk: number;
      rationale?: string | undefined;
      latencyMs: number;
    }
  | { timedOut: true; latencyMs: number };
```

O agente continua honrando o contrato da spec (`ScoringResult`); o **service** devolve
`ScoringOutcome`. E não é coincidência que essa união tenha a mesma forma da `DecisionInput` da
Tarefa 02 — o encaixe entre as duas camadas fica direto:

```ts
const outcome = await scoring.score(input);

const decision = decide(
  outcome.timedOut
    ? { timedOut: true }
    : { timedOut: false, risk: outcome.risk, isHighValue },
);
```

Sem adaptação forçada, sem `if` traduzindo formato. (A orquestração em si é da Tarefa 04 — aqui
só deixei o encaixe pronto.)

Consequência prática no mock: como `ScoringResult.risk` é obrigatório, o `MockScoringAgent`
precisa devolver _algum_ número mesmo no cenário de timeout. Ele devolve o risco neutro — um
valor **inalcançável na prática**, porque o deadline corta a corrida antes. Está comentado no
código para ninguém achar que é significativo.

### 21. Decisões menores, registradas

**Risco para assinatura desconhecida.** Uma assinatura que não é nenhum dos 7 cenários recebe
`(LOW_RISK_THRESHOLD + HIGH_RISK_THRESHOLD) / 2` — o **meio exato da zona cinzenta**, derivado
dos dois limiares, nunca escrito como `0.5`. A escolha é conservadora e coerente com o fallback
de timeout: sem informação para decidir, um humano decide. Nunca cancela sozinho nem dá desconto
sozinho.

**Margem do cenário de timeout.** O mock espera `SCORING_TIMEOUT_MS + 500ms`, derivado da
constante. Se a spec afrouxar o deadline, o cenário continua estourando. A margem existe para o
teste não depender de o agendador do Node acordar no milissegundo exato.

**`useFactory` em vez de `useClass` no módulo.** É o que mantém o `MockScoringAgent` sem
`@Injectable()` e sem nenhum import do Nest. O adapter não precisa saber que existe um container
de DI para ser um adapter — e isso deixa ele instanciável direto em teste (`new
MockScoringAgent()`), sem subir módulo.

**Token em arquivo próprio (`scoring.tokens.ts`).** O módulo importa o service, e o service
precisa do token; com o token dentro do módulo, os dois arquivos se importariam mutuamente. E o
token é um `Symbol` porque `ScoringAgent` é uma **interface**, que some em runtime — não dá para
usar a própria classe como token sem amarrar o consumidor a uma implementação.

**`ScoringModule` registrado no `AppModule`.** Nada consome o service ainda (o POST é da Tarefa
04), mas registrar agora faz o e2e do `/health` subir o grafo de DI inteiro — se o módulo
estivesse mal montado, o teste que já existia acusaria.

### 22. Uso de IA (Tarefa 03)

Feita com assistência de IA (Claude Code), revisada por mim, nos mesmos termos das tarefas
anteriores.

O registro específico desta tarefa é sobre **o que a verificação empírica mudou no código**:

- O `operation.catch()` do `withDeadline` foi escrito, testado, **provado desnecessário** e
  removido (seção 18). Sem rodar o teste sem a linha, ela teria ficado ali para sempre com um
  comentário convincente e falso.
- O teste de timeout foi validado por mutação nos dois sentidos — afrouxando o deadline e
  fazendo o mock responder na hora — para confirmar que ele prova o mecanismo, e não a leitura
  de uma flag.
- A tensão em `ScoringResult.risk` (seção 20) foi identificada lendo o contracts, não presumida:
  é o tipo da spec que não expressa o estado que a própria spec descreve. Está registrada aqui,
  como o TESTE.md pede, em vez de contornada em silêncio.

---

## Tarefa 04 — Endpoints e orquestração

Aqui as camadas anteriores se encontram. O `POST /cancellations` chama o Agente de Scoring sob
deadline (Tarefa 03), deriva o booleano de alto valor a partir dos preços do banco, entrega os
dois para a regra pura (Tarefa 02) e persiste o resultado.

| Camada                     | Arquivo                                                      |
| -------------------------- | ------------------------------------------------------------ |
| Controller (fino)          | `cancellations.controller.ts`, `subscriptions.controller.ts` |
| Use case (orquestração)    | `create-cancellation.use-case.ts`                            |
| Regra de alto valor        | `plans/high-value.ts` (fórmula) + `high-value.service.ts`    |
| Portas de dados            | `*.repository.ts` (interface + token)                        |
| Adapters Prisma            | `prisma-*.repository.ts`                                     |
| Tradução banco → contracts | `persistence/domain-mapper.ts`                               |

### 23. Controller fino, use case robusto

O controller tem três linhas de corpo. Não é minimalismo estético — é que **tudo que ele
poderia fazer já tem um lugar melhor**:

- validar → declarativo no DTO, aplicado pelo `ValidationPipe` global;
- decidir → `decide()`, da Tarefa 02;
- orquestrar → o use case;
- traduzir erro em status → o `AllExceptionsFilter`.

O que sobra é a forma da resposta (`{ cancellation }`), que é de fato assunto do controller.

**O teste é a prova de que a separação é real.** `create-cancellation.use-case.spec.ts` sobe o
use case com dublês dos dois repositórios, do `ScoringService` e do `HighValueService` — **sem
servidor HTTP, sem Postgres, sem Prisma**. Se a orquestração estivesse no controller, cada um
desses 10 testes precisaria de `supertest` e de um banco, e eles simplesmente não existiriam
nessa quantidade.

O use case também não lança `NotFoundException` do Nest: lança `SubscriptionNotFoundError`, um
erro de domínio. Quem traduz para 404 é o filtro, na borda. Assim o mesmo use case serve um
controller REST hoje e um consumidor de fila amanhã, sem que "não encontrei" vire "404" no
lugar errado.

### 24. A ordem do fluxo, e por que persistir "nu" antes de decidir

```
findContext  →  createPending  →  score  →  isHighValue  →  applyDecision
   (404?)        (grava nu)      (deadline)   (query)       (transação)
```

Essa ordem é asserida literalmente num teste (`expect(log.calls).toEqual([...])`), porque ela é
uma decisão, não um acaso.

**Por que gravar antes de decidir.** O pedido de cancelamento é um **fato do domínio**: o
assinante clicou, e isso aconteceu. Se eu só gravasse no fim, todo caminho que falhasse depois
deste ponto — scoring travado, processo reiniciado, banco caindo no meio — sumiria sem deixar
rastro. E são justamente esses os casos que alguém vai querer investigar depois.

Isso só é possível porque o schema da Tarefa 01 **admite** esse estado: `risk`, `band`,
`outcome_type` e `human_reason` são nullable e sem default (seção 1.2). Um cancelamento sem
outcome não é uma linha corrompida — é "o assinante pediu, o sistema ainda não decidiu". Foi
para isso que os nullables existem, e é aqui que a decisão de modelagem se paga.

**Por que a consulta de alto valor vem depois do scoring, e não antes.** Porque no timeout ela
é irrelevante: a regra é conservadora independentemente do valor da assinatura. Consultar antes
seria uma ida ao banco jogada fora em todo caso de timeout. Tem teste para isso — "nem consulta
a regra de alto valor" verifica que o método nem é chamado.

### 25. Por que a gravação final é transacional

`applyDecision` faz duas escritas: o `UPDATE` da decisão no cancelamento e, quando o caminho é
`AUTOMATIC_OFFER`, o `INSERT` da oferta. As duas rodam dentro de `prisma.$transaction`.

Sem isso existiria uma janela em que o banco poderia ficar com
`outcome_type = 'AUTOMATIC_OFFER'` e **nenhuma linha em `offers`**. Esse estado:

- não é previsto pela spec (`CancellationOutcome` com `type: AUTOMATIC_OFFER` implica uma
  oferta);
- quebraria a tela de resultado, que não teria o que mostrar;
- e é **invisível** para as constraints do banco — a FK garante que toda oferta tem
  cancelamento, mas nada garante o contrário.

Ou seja: é exatamente o tipo de inconsistência que o schema não consegue impedir sozinho, e por
isso a aplicação tem que impedir. Uma transação de duas escritas é barata; um relatório de
métricas com cancelamentos fantasma não é.

### 26. Onde mora a regra de alto valor, e por que é derivada do banco

A Tarefa 02 recebe `isHighValue` pronto (seção 12). **Esta tarefa é a outra metade**, e ela
ficou dividida em três pedaços, cada um com uma responsabilidade só:

| Pedaço                               | Responsabilidade               | Sabe de banco? |
| ------------------------------------ | ------------------------------ | -------------- |
| `deriveHighValueCut(precos, pct)`    | a **fórmula** da spec          | não            |
| `PlansRepository.distinctPriceCents` | de **onde vêm os preços**      | sim            |
| `HighValueService`                   | junta os dois                  | via a porta    |
| `decide(...)` (Tarefa 02)            | o que **fazer** com o booleano | não            |

A fórmula é a do README do contracts: ordene os `priceCents` **distintos**,
`k = ceil(HIGH_VALUE_PERCENTILE * n)`, os `k` maiores são de alto valor. A query é literalmente
`SELECT DISTINCT price_cents FROM plans ORDER BY price_cents`.

**"Só o Premium" é consequência, nunca premissa.** Não existe no código nenhuma comparação com
`19900`, nem com o nome "Premium". Quatro testes atacam exatamente isso:

- com `[1000, 5000, 7000]` → o corte é `{7000}`, e `19900` nem aparece;
- com um plano "Ultra" de `49900` entrando no catálogo → o corte vira `{49900}` e **o Premium
  deixa de ser alto valor**;
- com `19900` sendo o preço mais **barato** dos três → ele não é alto valor;
- com preços repetidos → o `n` conta preços **distintos**, não planos (seis planos e três
  preços dão `k=1`, não `k=2`).

Se o avaliador mudar os preços do seed e revalidar, como a spec avisa que pode, o
comportamento acompanha.

**Sem cache, de propósito.** `plans` é tabela de dimensão com um punhado de linhas, e a consulta
roda uma vez por cancelamento. Um cache precisaria ser invalidado quando um plano fosse
cadastrado ou tivesse o preço alterado — exatamente o cenário que a spec diz que será
exercitado. O ganho seria imperceptível e o risco de servir um corte velho, real.

### 27. Montagem do `ScoringInput` e o N+1 que não existe

`SubscriptionContext` é, por construção, **o `ScoringInput` da spec menos o `rawReason`** (que
vem do request, não do banco). Não é coincidência: modelado assim, a montagem do input do
agente no use case é um objeto literal direto, sem o use case precisar saber quais campos
existem nem de onde cada um veio.

As duas consultas do módulo são **uma query cada**, com `include`:

```ts
// GET /subscriptions — um JOIN, não 1 + 2N
this.prisma.subscription.findMany({
  include: { subscriber: true, plan: true },
});

// POST /cancellations — assinante, plano e os dois históricos de evento de uma vez
this.prisma.subscription.findUnique({
  where: { id },
  include: {
    subscriber: true,
    plan: true,
    engagementEvents: { orderBy: { occurredAt: "desc" } },
    paymentEvents: { orderBy: { date: "desc" } },
  },
});
```

Com as 7 assinaturas do seed a diferença é invisível. Com 7 mil, a versão ingênua faria 14 mil
round-trips só para montar a tela inicial.

A segunda consulta é **exatamente a que os índices compostos da Tarefa 01 servem**
(`engagement_events (subscription_id, occurred_at)` e `payment_events (subscription_id, date)`):
filtro pelo prefixo à esquerda e ordenação entregue pelo índice, sem passo de `Sort`. O
`GET /cancellations/:id` idem, com `cancellations (subscription_id)`.

### 28. O valor da oferta

A spec define o **tipo** e o **status inicial** da oferta (`DEFAULT_OFFER_TYPE`,
`INITIAL_OFFER_STATUS`, ambos importados do contracts — nada escrito à mão), mas não diz quanto
descontar. Escolhi **20% do valor recorrente do plano**, e a justificativa é a métrica da
própria PoC:

- Um caso de retenção humana custa `HUMAN_RETENTION_COST_CENTS` (R$ 15). No plano Basic
  (R$ 29), 20% são **R$ 5,80 por ciclo** — a oferta se paga contra o custo de um atendimento
  logo no primeiro mês. O desconto é mais barato que o humano que ele evita, que é a tese do
  projeto.
- 5% não muda a decisão de quem já decidiu cancelar; 50% destruiria a margem de quem talvez
  ficasse de graça.

Duas notas:

- **`amountCents` é o valor do desconto por ciclo**, não o preço novo. A spec não desambigua o
  campo; escolhi a leitura em que o número é o benefício, porque é assim que ele aparece na tela
  ("economize R$ 5,80"). Está documentado no código para não virar adivinhação depois.
- O `0.2` **coincide numericamente com `HIGH_VALUE_PERCENTILE` por acidente**. São grandezas
  sem relação (fração de preço vs. percentil de uma distribuição), então a constante é própria
  (`RETENTION_DISCOUNT_RATE`). Reaproveitar a do contracts aqui seria um acoplamento invisível
  que só apareceria no dia em que alguém mudasse uma das duas.

### 29. Validação, exception filter e logging

**Validação — `class-validator` com `ValidationPipe` global.** Configurado com `whitelist` (o
que não está no DTO não chega ao use case) e `forbidNonWhitelisted` (mandar campo desconhecido
é **erro explícito**, não descarte silencioso — um cliente que envia `risk: 0.99` achando que
manda no resultado merece um 400, não um sucesso enganoso).

O DTO declara `implements CreateCancellationRequest`. Não é decoração: é o compilador impedindo
que a validação e a documentação desviem do contrato congelado. Se o contracts ganhar um campo,
a classe para de compilar.

E o validador de UUID delega para o **`isUUIDv7()` do contracts**, em vez de usar o `@IsUUID()`
do class-validator — que só conhece as versões 3, 4 e 5 e aceitaria um v4 alegremente. Mesma
coisa no `ParseUUIDv7Pipe` do parâmetro de rota. Ter duas definições de "UUID válido" no projeto
é garantia de que uma hora elas discordam.

**Exception filter global — três caminhos:**

| Exceção                            | Resposta     | Por quê                                               |
| ---------------------------------- | ------------ | ----------------------------------------------------- |
| Erro de domínio (`*NotFoundError`) | 404          | É aqui que "não encontrei" vira status — e só aqui    |
| `HttpException`                    | o próprio    | preserva a lista de erros de campo do class-validator |
| Qualquer outra coisa               | 500 genérico | **stack no log, nunca na resposta**                   |

A última linha é a que importa: vazar stack trace entrega caminho de arquivo, versão de
dependência e estrutura interna a quem estiver sondando. Tem teste e2e afirmando que o corpo do
erro não contém `"at "` nem `stack`.

Filtro e pipe entram por `APP_FILTER` / `APP_PIPE` (provider) em vez de `app.useGlobalFilters`,
porque assim recebem injeção de dependência — o filtro precisa do logger.

**Logging — `nestjs-pino`, substituindo o `AppLoggerMiddleware` do scaffold.** O middleware
montava a linha de log à mão, com códigos de cor ANSI embutidos na string. Era legível para um
humano no terminal e inútil para qualquer outra coisa. Com pino, o mesmo evento vira JSON com
campos:

```json
{ "event": "scoring.timed_out", "cancellationId": "01a0…", "latencyMs": 3000 }
```

A diferença prática é poder filtrar por `cancellationId`, agrupar por `event` e **alertar em
cima de `scoring.timed_out`** — exatamente a distinção que a Tarefa 02 (seção 10) argumentou que
precisava existir. Uma string colorida não sustenta nenhuma das três.

Três ajustes por ambiente: silencioso em teste (log de 30 requisições esconde a falha que
interessa), `pino-pretty` em desenvolvimento, JSON puro em produção. `authorization` e `cookie`
vão **redacted**.

**OpenAPI** em `/docs`, com os três endpoints, os status possíveis e os campos do corpo.

### 30. Duas quebras pré-existentes do scaffold que precisei consertar

Nenhuma das duas tem relação com o código do teste, e nenhuma aparecia no `pnpm verify` —
porque `verify` roda lint, typecheck e testes, e o **build do backend não está entre eles**.
Registro porque afetam qualquer pessoa que rode o projeto.

**1. O `@nestjs/cli` não roda no Node 22.** `nest build` e `nest start` morriam _antes de ler o
projeto_:

```
Error [ERR_REQUIRE_CYCLE_MODULE]: Cannot require() ES Module .../ora/index.js in a cycle
  (from .../@angular-devkit/schematics/tasks/package-manager/executor.js)
```

O `@angular-devkit/schematics` faz `require()` de `ora@9`, que é ESM, dentro de um ciclo de
módulos — e o Node 22 recusa. Confirmei que é pré-existente por dois caminhos: a versão do `ora`
no lockfile é idêntica antes e depois das minhas instalações, e o stack trace inteiro está
dentro do CLI, antes de qualquer arquivo meu ser carregado.

Correção: override transitivo fixando `ora` em 5.x (a última versão CJS), escopado a
`@nestjs/cli` e `@angular-devkit/schematics`. O `shadcn`, no frontend, usa o seu próprio `ora`
(8.2.0) e não é afetado.

**2. `nest start` não resolvia os aliases `@/*`.** Com o item 1 corrigido, o dev passou a morrer
em `ERR_MODULE_NOT_FOUND: .../dist/app.module`. O motivo: quem reescreve os aliases é o
`tsc-alias`, e ele só rodava no script de `build`. O `nest start` compila e executa direto, sem
essa etapa — então `pnpm dev:backend` **nunca funcionou** neste scaffold.

Correção: o `dev` agora roda `tsc --watch`, `tsc-alias --watch` e `node --watch` juntos, via
`concurrently`. Conferido: `pnpm build` passa nos três pacotes e `pnpm dev:backend` responde em
`localhost:3000`.

**Por que não `tsx` para o dev**, já que ele estava ali para o seed: o esbuild **não emite
`emitDecoratorMetadata`**, e sem essa metadata a injeção de dependência do Nest quebra em
runtime. Cheguei a tentar; o erro foi `Nest can't resolve dependencies of the
CreateCancellationUseCase (..., ?, +, ...)`, com os parâmetros tipados por classe vindo
`undefined`. É o mesmo motivo pelo qual o `@repo/lint` desliga a regra
`consistent-type-imports` no backend.

### 31. Estratégia dos testes

**44 testes novos**, em três níveis, e a divisão é deliberada:

| Nível                        | Quantos | O que usa de verdade                    |
| ---------------------------- | ------- | --------------------------------------- |
| Fórmula de alto valor (pura) | 15      | nada — função pura                      |
| Use case (orquestração)      | 10      | nada; dublês dos repositórios e agentes |
| e2e do fluxo                 | 19      | HTTP, Nest e **Postgres** de verdade    |

No e2e o **único dublê é o Agente de Scoring**, trocado por `overrideProvider` no token
`SCORING_AGENT` — a prova de que a DI por token da Tarefa 03 serve para o que foi desenhada. Ele
devolve o risco do cenário **sem latência**: os 200–1500ms do mock fariam a suíte levar dez
segundos sem provar nada a mais, porque o mecanismo do deadline já tem os testes dele.

**A exceção é o `scenario-timeout`.** Ali o agente devolve uma promessa que **nunca resolve** —
o mais fiel ao que um agente travado faz — e quem decide é o relógio real, em ~3s. É o único
teste lento da suíte, e é lento de propósito.

**O e2e é pulado, com aviso visível, quando o Postgres não está de pé.** A razão é que o
scaffold prometia `pnpm verify` verde num clone limpo, e eu não quero que a minha entrega
transforme "não tenho Docker agora" em suíte vermelha. Mas pular em silêncio seria pior que
falhar: por isso o aviso é impresso, e `E2E_REQUIRE_DB=1` transforma a ausência do banco em
erro — que é o comportamento certo em CI, onde o banco **deve** existir.

O seed foi extraído para `src/prisma/seed-scenarios.ts`, com o script `prisma/seed.ts` virando
uma casca de três linhas. Motivo: o e2e precisa garantir os dados antes de bater nos endpoints,
e um seed que só existe como script vira `INSERT` copiado e colado dentro do teste — duas
fontes da verdade que divergem no primeiro cenário novo.

### 32. Tradução banco → contracts, sem um único `as`

O mapper (`persistence/domain-mapper.ts`) resolve três incompatibilidades:

1. **`Date` → `ISO8601`.** O contracts tipa todo timestamp como string.
2. **`Decimal` → `number`.** `risk` é `numeric(3,2)` (Tarefa 01, seção 3.5) e chega como
   `Decimal` do decimal.js.
3. **Enum do Prisma → enum do contracts.** São tipos diferentes: o do Prisma é uma união de
   literais de string; o do contracts é um `enum` nominal, e TypeScript **não** deixa atribuir
   `"MONTHLY"` a `BillingCycle`.

O terceiro é o interessante. A saída óbvia seria `row.cycle as BillingCycle` — e um `as` é
exatamente o tipo de escape que a rubrica pune, porque desliga a verificação em vez de resolver
o problema. A solução foi **indexar o enum pela chave**:

```ts
cycle: BillingCycle[row.cycle];
```

Como os membros do enum do contracts têm chaves iguais aos valores do Prisma, isso é uma
indexação normal, checada pelo compilador **nas duas direções**: se o Prisma ganhasse um valor
que o contracts não tem, o arquivo pararia de compilar. Não há um `as`, um `any` ou um
`@ts-ignore` em nenhum lugar deste módulo.

Por fim, o `null` do banco vira **ausência de propriedade**, não `undefined` atribuído — o
`exactOptionalPropertyTypes` do tsconfig distingue os dois, e a spec também: `outcome` ausente é
"ainda não decidido".

### 33. Uso de IA (Tarefa 04)

Feita com assistência de IA (Claude Code), revisada por mim, nos mesmos termos das anteriores.

O que vale registrar desta tarefa:

- **As duas quebras do scaffold (seção 30) foram diagnosticadas, não contornadas.** A tentação
  era trocar o build por algo que funcionasse e seguir. Em vez disso: identifiquei a causa
  (`require(ESM)` em ciclo), provei que era pré-existente comparando o lockfile antes e depois,
  e corrigi na raiz com um override escopado — mantendo os scripts do scaffold intactos.
- **O `tsx` no dev foi testado e rejeitado com motivo**, não por preferência: o erro de DI em
  runtime mostrou que o esbuild não emite `emitDecoratorMetadata`.
- **Verificação contra o banco real antes de escrever o e2e.** Subi a API e rodei os 7 cenários
  por `curl`, conferindo os outcomes um a um, mais os quatro caminhos de erro. Os testes vieram
  depois, para travar o que eu já tinha visto funcionar.
- **A separação em três níveis de teste (seção 31) foi decisão consciente** sobre onde cada
  garantia custa menos: fórmula pura em milissegundos, orquestração sem I/O, e só o fluxo
  completo pagando o preço do banco.

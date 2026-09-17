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

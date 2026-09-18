# Imagem da API. O contexto de build e a RAIZ do monorepo (ver docker-compose.yml),
# porque o backend depende de `@repo/contracts` via workspace: buildar so a pasta
# `apps/backend` deixaria a dependencia de fora.
#
# Base Debian slim, e nao Alpine, de proposito: o Prisma depende de OpenSSL e tem
# binary targets diferentes para musl. Em uma PoC que o avaliador vai subir uma vez,
# a robustez vale os megabytes a mais.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# O Prisma precisa do OpenSSL para escolher o binary target certo. Sem ele o CLI
# avisa que "falhou ao detectar a versao do libssl" e cai num default — funciona por
# sorte, e o proprio Prisma pede para instalar.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# deps — so os manifestos, para o cache do Docker sobreviver a mudanca de codigo
# ---------------------------------------------------------------------------
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/lint/package.json packages/lint/
COPY packages/prettier-config/package.json packages/prettier-config/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/

# O `postinstall` do backend roda `prisma generate`, que precisa do schema e da
# config — por isso os dois vem antes do install.
COPY apps/backend/prisma.config.ts apps/backend/
COPY apps/backend/prisma/ apps/backend/prisma/

# `--filter @repo/backend...` instala so o backend e os pacotes do workspace de que
# ele depende. Sem isso o `node_modules` do frontend (Next, React, Tailwind) entraria
# na imagem sem nunca ser usado — foi a diferenca entre 1,2 GB e o tamanho atual.
RUN pnpm install --frozen-lockfile --filter @repo/backend...

# ---------------------------------------------------------------------------
# build — contracts primeiro (o backend importa o `dist` dele), depois a API
# ---------------------------------------------------------------------------
FROM deps AS build

COPY . .

RUN pnpm --filter @repo/contracts build
RUN pnpm --filter @repo/backend build

# O codigo do frontend veio junto no `COPY . .` e nao serve para nada aqui.
RUN rm -rf apps/frontend

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production
ENV PORT=3000
# Os binarios do workspace entram no PATH para o entrypoint chamar `prisma` e `tsx`
# direto, sem passar por `pnpm exec` (ver o comentario no docker-entrypoint.sh).
ENV PATH="/repo/node_modules/.bin:/repo/apps/backend/node_modules/.bin:$PATH"

# Traz a arvore ja instalada e compilada. Nao faço prune das devDependencies: o
# entrypoint precisa do CLI do Prisma (`migrate deploy`) e do `tsx` (seed), que sao
# devDeps. Podar e reinstalar so o que falta custaria mais do que economiza.
COPY --from=build /repo /repo

COPY apps/backend/docker-entrypoint.sh /usr/local/bin/backend-entrypoint
RUN chmod +x /usr/local/bin/backend-entrypoint

WORKDIR /repo/apps/backend

EXPOSE 3000

ENTRYPOINT ["backend-entrypoint"]
CMD ["node", "dist/main.js"]

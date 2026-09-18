# Imagem do frontend. Contexto de build na RAIZ do monorepo, pelo mesmo motivo do
# backend: o app depende de `@repo/contracts` via workspace.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# deps
# ---------------------------------------------------------------------------
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/lint/package.json packages/lint/
COPY packages/prettier-config/package.json packages/prettier-config/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY apps/backend/prisma.config.ts apps/backend/
COPY apps/backend/prisma/ apps/backend/prisma/

RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
FROM deps AS build

COPY . .

RUN pnpm --filter @repo/contracts build
RUN pnpm --filter @repo/frontend build

# ---------------------------------------------------------------------------
# runtime — so o servidor standalone, sem node_modules nem codigo-fonte
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

# O `output: "standalone"` do next.config ja empacotou o servidor com as dependencias
# que ele usa. Os `static` e `public` ficam de fora do bundle de proposito (sao
# servidos como arquivo), entao vem em COPY separado.
COPY --from=build /repo/apps/frontend/.next/standalone ./
COPY --from=build /repo/apps/frontend/.next/static ./apps/frontend/.next/static

EXPOSE 3001

# O caminho reflete a estrutura do monorepo preservada pelo `outputFileTracingRoot`.
CMD ["node", "apps/frontend/server.js"]

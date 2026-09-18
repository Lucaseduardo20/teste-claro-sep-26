#!/bin/sh
# Entrypoint da API no compose.
#
# O `depends_on: service_healthy` do compose garante que o Postgres aceita conexao,
# mas nao que o schema existe. Aplicar as migrations e carregar o seed aqui e o que
# faz `docker compose up` entregar um sistema navegavel de primeira, em vez de uma
# API de pe apontando para um banco vazio.
#
# `migrate deploy` (e nao `migrate dev`): so aplica o que ja esta versionado, nunca
# gera migration nem pede confirmacao. E o comando correto fora da maquina de quem
# desenvolve.
#
# O seed e idempotente por construcao (upsert por id), entao reiniciar o container
# nao duplica nada.
#
# Os binarios sao chamados direto do `node_modules/.bin` (que o Dockerfile poe no
# PATH), e NAO via `pnpm exec`. Isso nao e estilo: com `pnpm exec`, o corepack baixa
# o pnpm e o pnpm revalida o lockfile a cada boot — o container precisava de rede
# para subir e levava ~50s. Sem pnpm no caminho, sobe offline e na hora.
#
# Pelo mesmo motivo o seed roda `tsx prisma/seed.ts` direto, em vez de
# `prisma db seed`: o comando de seed registrado no prisma.config.ts e
# `pnpm exec tsx ...`, pensado para a maquina de quem desenvolve.
set -e

echo "[entrypoint] aplicando migrations..."
prisma migrate deploy

echo "[entrypoint] carregando os 7 cenarios..."
tsx prisma/seed.ts

echo "[entrypoint] subindo a API..."
exec "$@"

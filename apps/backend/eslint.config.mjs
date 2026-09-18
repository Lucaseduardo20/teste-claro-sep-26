import { nest } from "@repo/lint/eslint/nest";

export default [
  ...nest,
  {
    // `prisma/`: o seed e um script de linha de comando executado a mao — o resumo
    // impresso no stdout e a saida dele, nao log esquecido em codigo de producao.
    // `test/`: o aviso de "suite pulada porque o Postgres nao esta de pe" precisa ser
    // visivel na saida do vitest, senao a suite some em silencio.
    files: ["prisma/**/*.ts", "test/**/*.ts"],
    rules: { "no-console": "off" },
  },
];

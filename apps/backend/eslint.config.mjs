import { nest } from "@repo/lint/eslint/nest";

export default [
  ...nest,
  {
    // O seed é um script de linha de comando executado à mão: o resumo impresso no
    // stdout é a saída dele, não log esquecido em código de produção.
    files: ["prisma/**/*.ts"],
    rules: { "no-console": "off" },
  },
];

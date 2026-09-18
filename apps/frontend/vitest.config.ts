import { defineConfig } from "vitest/config";

/**
 * Só a lógica pura do frontend é testada aqui: formatação de moeda e o mapa de outcome
 * para a mensagem que o assinante lê. Teste de componente e de browser (Playwright) é
 * stretch e ficou fora — o que valia travar é a lógica que não é óbvia ao olhar a tela.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // Sem `globals: true`: os specs importam `describe`/`it`/`expect` do vitest
    // explicitamente. O tsconfig do Next nao resolve `vitest/globals` no `types`, e
    // import explicito e mais honesto de qualquer forma — nada aparece do nada.
    root: "./",
    include: ["src/**/*.spec.ts"],
  },
});

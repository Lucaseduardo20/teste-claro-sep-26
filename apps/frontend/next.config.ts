import { join } from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `standalone` gera um servidor auto-contido em `.next/standalone`, com so as
  // dependencias que o runtime usa de fato. Num monorepo pnpm isso e o que evita ter
  // que copiar a arvore de symlinks do `node_modules` para dentro da imagem — que e a
  // fonte classica de "funciona local, quebra no container".
  output: "standalone",
  // Sem isto o rastreamento de arquivos para no `apps/frontend` e deixa de fora o
  // `@repo/contracts`, que vive fora dessa pasta.
  outputFileTracingRoot: join(import.meta.dirname, "../.."),
  compiler: {
    reactRemoveProperties: true,
  },
  reactCompiler: true,
  typedRoutes: true,
  logging: {
    browserToTerminal: true,
  },
};

export default nextConfig;

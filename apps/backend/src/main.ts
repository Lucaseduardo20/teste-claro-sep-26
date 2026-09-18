import "dotenv/config";

import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";

import { AppModule } from "@/app.module";

const OPENAPI_PATH = "docs";

async function bootstrap() {
  // `bufferLogs` guarda o que for logado antes de o pino estar de pé, para não perder
  // nada do boot nem cair no logger padrao do Nest no meio do caminho.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.enableCors();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Cancelamento com Retencao Inteligente")
      .setDescription(
        "API do fluxo de auto-atendimento de cancelamento. O POST /cancellations orquestra " +
          "o Agente de Scoring sob deadline, a regra de alto valor recorrente derivada dos " +
          "precos cadastrados e as faixas de risco.",
      )
      .setVersion("1.0")
      .build(),
  );

  SwaggerModule.setup(OPENAPI_PATH, app, document);

  await app.listen(Number(process.env["PORT"] ?? 3000));
}

await bootstrap();

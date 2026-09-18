import "dotenv/config";

import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";

import { AppModule } from "@/app.module";

async function bootstrap() {
  // `bufferLogs` guarda o que for logado antes de o pino estar de pé, para não perder
  // nada do boot nem cair no logger padrao do Nest no meio do caminho.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.enableCors();

  await app.listen(Number(process.env["PORT"] ?? 3000));
}

await bootstrap();

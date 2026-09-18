import { Global, Module } from "@nestjs/common";

import { PrismaService } from "@/prisma/prisma.service";

/**
 * Global porque o acesso ao banco é infraestrutura transversal — do mesmo jeito que o
 * `DbModule` do scaffold já era. Só os repositórios injetam o `PrismaService`; os use
 * cases dependem das abstrações de repositório, nunca do client.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { SubscriptionListResponse } from "@repo/contracts";

import { ListSubscriptionsUseCase } from "@/subscriptions/list-subscriptions.use-case";

@ApiTags("assinaturas")
@Controller("subscriptions")
export class SubscriptionsController {
  constructor(private readonly listSubscriptions: ListSubscriptionsUseCase) {}

  @Get()
  @ApiOperation({
    summary: "Lista as assinaturas",
    description: "Assinatura com assinante e plano — a tela inicial do fluxo.",
  })
  @ApiResponse({ status: 200, description: "Lista de assinaturas." })
  async list(): Promise<SubscriptionListResponse> {
    return this.listSubscriptions.execute();
  }
}

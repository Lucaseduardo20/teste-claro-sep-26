import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import type {
  CancellationDetailResponse,
  CreateCancellationResponse,
  UUIDv7,
} from "@repo/contracts";

import { CreateCancellationUseCase } from "@/cancellations/create-cancellation.use-case";
import { CreateCancellationDto } from "@/cancellations/dto/create-cancellation.dto";
import { GetCancellationUseCase } from "@/cancellations/get-cancellation.use-case";
import { ParseUUIDv7Pipe } from "@/common/pipes/parse-uuid-v7.pipe";

/**
 * Controller fino: recebe, delega, devolve.
 *
 * Não há um `if` de negócio aqui — a validação é declarativa no DTO, a orquestração é do
 * use case e a tradução de erro para status HTTP é do exception filter. O que sobra é a
 * forma da resposta, que é o único assunto de fato do controller.
 */
@ApiTags("cancelamentos")
@Controller("cancellations")
export class CancellationsController {
  constructor(
    private readonly createCancellation: CreateCancellationUseCase,
    private readonly getCancellation: GetCancellationUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Inicia um cancelamento",
    description:
      "Persiste o cancelamento, executa o Agente de Scoring sob deadline, aplica as regras " +
      "de faixa de risco e de alto valor recorrente, e devolve o cancelamento ja decidido.",
  })
  @ApiResponse({ status: 201, description: "Cancelamento criado e decidido." })
  @ApiResponse({ status: 400, description: "Corpo invalido." })
  @ApiResponse({ status: 404, description: "Assinatura nao encontrada." })
  async create(@Body() body: CreateCancellationDto): Promise<CreateCancellationResponse> {
    return { cancellation: await this.createCancellation.execute(body) };
  }

  @Get(":id")
  @ApiOperation({
    summary: "Detalhe de um cancelamento",
    description:
      "Cancelamento com assinatura, assinante, plano e o outcome remontado. Enquanto o " +
      "cancelamento nao foi decidido, `outcome` simplesmente nao vem na resposta.",
  })
  @ApiParam({ name: "id", description: "Id do cancelamento (UUID v7)" })
  @ApiResponse({ status: 200, description: "Cancelamento encontrado." })
  @ApiResponse({ status: 404, description: "Cancelamento nao encontrado." })
  async detail(@Param("id", ParseUUIDv7Pipe) id: UUIDv7): Promise<CancellationDetailResponse> {
    return this.getCancellation.execute(id);
  }
}

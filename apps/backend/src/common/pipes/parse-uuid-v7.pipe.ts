import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import { isUUIDv7, type UUIDv7 } from "@repo/contracts";

/**
 * Valida um parâmetro de rota como UUID v7 e devolve o tipo *branded* do contracts.
 *
 * O `ParseUUIDPipe` do Nest só conhece as versões 3, 4 e 5, e devolve `string` — o que
 * obrigaria um cast na assinatura do controller. Este pipe delega para o `isUUIDv7()` da
 * spec (mesma fonte de verdade do DTO) e entrega o tipo certo, sem `as` no caminho.
 *
 * Sem ele, um id malformado só quebraria lá no banco, virando 500 em vez de 400.
 */
@Injectable()
export class ParseUUIDv7Pipe implements PipeTransform<string, UUIDv7> {
  transform(value: string): UUIDv7 {
    if (!isUUIDv7(value)) {
      throw new BadRequestException("O id informado nao e um UUID v7 valido");
    }

    return value;
  }
}

import { ApiProperty } from "@nestjs/swagger";
import { isUUIDv7, type CreateCancellationRequest, type UUIDv7 } from "@repo/contracts";
import { IsNotEmpty, IsString, MaxLength, Validate, ValidatorConstraint } from "class-validator";
import type { ValidatorConstraintInterface } from "class-validator";

/**
 * Validador de UUID v7 que reusa o guard do contracts.
 *
 * O `@IsUUID("7")` do class-validator não existe — a lib só conhece as versões 3, 4 e 5. E
 * mesmo que conhecesse, a fonte da verdade do formato é o `isUUIDv7()` da spec, que valida
 * o nibble de versão **e** o de variante. Delegar para ele evita ter duas definições de
 * "UUID válido" no projeto que podem discordar.
 */
@ValidatorConstraint({ name: "isUUIDv7", async: false })
export class IsUUIDv7Constraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isUUIDv7(value);
  }

  defaultMessage(): string {
    return "subscriptionId deve ser um UUID v7 valido";
  }
}

/** Tamanho máximo do motivo livre. Protege a coluna `text` de um corpo absurdo. */
const RAW_REASON_MAX_LENGTH = 2000;

/**
 * Corpo do `POST /cancellations`.
 *
 * `implements CreateCancellationRequest` não é decoração: é o compilador garantindo que o
 * DTO não desvie do contrato da spec. Se o contracts ganhar um campo, esta classe para de
 * compilar até ser atualizada.
 */
export class CreateCancellationDto implements CreateCancellationRequest {
  @ApiProperty({
    description: "Id da assinatura a cancelar (UUID v7).",
    example: "0197b0f0-0000-7000-8000-000000000000",
  })
  @Validate(IsUUIDv7Constraint)
  subscriptionId!: UUIDv7;

  @ApiProperty({
    description: "Motivo do cancelamento, em texto livre, como o assinante escreveu.",
    example: "Esta caro demais para o que oferece.",
    maxLength: RAW_REASON_MAX_LENGTH,
  })
  @IsString()
  @IsNotEmpty({ message: "rawReason nao pode ser vazio" })
  @MaxLength(RAW_REASON_MAX_LENGTH)
  rawReason!: string;
}

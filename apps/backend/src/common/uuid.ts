import { assertUUIDv7, type UUIDv7 } from "@repo/contracts";
import { v7 } from "uuid";

/**
 * Gera um id novo para entidades criadas em runtime.
 *
 * **UUID v7, não v4**, por duas razões que a Tarefa 01 já registrou: o contracts valida o
 * formato (`assertUUIDv7` exige o nibble de versão `7`), e os 48 bits mais significativos
 * do v7 são o timestamp em ms — ids gerados em sequência ficam quase ordenados, o que
 * poupa o B-tree da chave primária da fragmentação que o v4 aleatório causa.
 *
 * O `assertUUIDv7` no meio não é decoração: ele é o que devolve o tipo *branded* do
 * contracts, e falharia alto se a lib mudasse de versão de UUID.
 */
export function newUuidV7(): UUIDv7 {
  return assertUUIDv7(v7());
}

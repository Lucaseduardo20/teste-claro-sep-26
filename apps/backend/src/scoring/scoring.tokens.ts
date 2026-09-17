/**
 * Token de injeção do port `ScoringAgent`.
 *
 * Mora num arquivo só dele, e não em `scoring.module.ts`, para não criar ciclo: o módulo
 * importa o service, e o service precisa do token. Com o token no módulo, os dois
 * arquivos se importariam mutuamente.
 *
 * `ScoringAgent` é uma **interface** do contracts, e interface some em runtime — não dá
 * para usar a própria classe como token. Daí o `Symbol`: identidade única, impossível de
 * colidir com outro provider, e é o que permite trocar a implementação sem que ninguém
 * que injeta o agente saiba disso.
 */
export const SCORING_AGENT = Symbol("SCORING_AGENT");

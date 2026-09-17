import { withDeadline } from "@/scoring/with-deadline";

/** Promessa que resolve depois de `ms` de relogio (falso ou real, conforme o teste). */
function resolveAfter<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/** Promessa que rejeita depois de `ms`. */
function rejectAfter(ms: number, error: Error): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(error), ms));
}

describe("withDeadline: a corrida contra o relogio", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("quem ganha a corrida", () => {
    it("devolve o valor quando a operacao responde dentro do prazo", async () => {
      const promise = withDeadline(resolveAfter(100, "pronto"), 1000);

      await vi.advanceTimersByTimeAsync(100);

      await expect(promise).resolves.toEqual({ timedOut: false, value: "pronto" });
    });

    it("devolve timedOut quando o prazo vence primeiro", async () => {
      const promise = withDeadline(resolveAfter(1000, "tarde demais"), 100);

      await vi.advanceTimersByTimeAsync(100);

      await expect(promise).resolves.toEqual({ timedOut: true });
    });

    it("nao carrega valor nenhum no resultado de timeout", async () => {
      const promise = withDeadline(resolveAfter(1000, "tarde demais"), 100);

      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;

      expect(result).not.toHaveProperty("value");
    });
  });

  describe("limpeza do timer (o vazamento classico)", () => {
    it("limpa o timer do prazo quando a operacao ganha", async () => {
      const promise = withDeadline(resolveAfter(100, "pronto"), 60_000);

      await vi.advanceTimersByTimeAsync(100);
      await promise;

      // Se o clearTimeout do `finally` nao existisse, sobraria o timer de 60s agendado —
      // e o Node manteria o event loop vivo por um minuto esperando por ele.
      expect(vi.getTimerCount()).toBe(0);
    });

    it("limpa o timer tambem quando a operacao falha", async () => {
      const promise = withDeadline(rejectAfter(100, new Error("agente caiu")), 60_000);
      // A assercao e montada ANTES de adiantar o relogio: e ela quem anexa o handler de
      // rejeicao. Montar depois deixaria a promessa rejeitada sem ouvinte por um tick, e
      // o Node dispararia unhandledRejection antes de o teste chegar na linha seguinte.
      const rejeicao = expect(promise).rejects.toThrow("agente caiu");

      await vi.advanceTimersByTimeAsync(100);
      await rejeicao;

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("falha nao e timeout", () => {
    it("propaga a rejeicao da operacao em vez de disfarcar de timeout", async () => {
      const promise = withDeadline(rejectAfter(100, new Error("agente caiu")), 1000);
      const rejeicao = expect(promise).rejects.toThrow("agente caiu");

      await vi.advanceTimersByTimeAsync(100);

      await rejeicao;
    });

    // Prova de que a promessa perdedora nao vira unhandledRejection: o `Promise.race`
    // deixa um handler anexado nela, mesmo depois de a corrida ja ter sido decidida.
    it("nao deixa rejeicao sem tratamento quando a operacao falha depois de perder", async () => {
      const naoTratada = vi.fn();
      process.on("unhandledRejection", naoTratada);

      const promise = withDeadline(rejectAfter(1000, new Error("falhou tarde")), 100);

      await vi.advanceTimersByTimeAsync(100);
      await expect(promise).resolves.toEqual({ timedOut: true });

      // A operacao perdedora so rejeita agora, quando ninguem mais a escuta.
      await vi.advanceTimersByTimeAsync(1000);
      await new Promise((resolve) => process.nextTick(resolve));

      process.off("unhandledRejection", naoTratada);
      expect(naoTratada).not.toHaveBeenCalled();
    });
  });
});

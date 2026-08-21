import type {
  HostOutput,
  InboundMessage,
  InterfaceHealth,
  InterfaceServices,
  RunningInterface,
} from "./types.js";

export interface FakeInterfaceHandle extends RunningInterface {
  readonly outputs: HostOutput[];
  readonly started: boolean;
  emit(message: InboundMessage): Promise<void>;
}

export async function createFakeInterface(
  _config: Record<string, unknown>,
  services: InterfaceServices,
): Promise<FakeInterfaceHandle> {
  const outputs: HostOutput[] = [];
  let started = false;

  return {
    get outputs() {
      return outputs;
    },
    get started() {
      return started;
    },
    async start() {
      started = true;
    },
    async stop() {
      started = false;
    },
    async deliver(output: HostOutput) {
      outputs.push(output);
    },
    async health(): Promise<InterfaceHealth> {
      return { ok: started, connected: started };
    },
    async emit(message: InboundMessage) {
      await services.submit(message);
    },
  };
}

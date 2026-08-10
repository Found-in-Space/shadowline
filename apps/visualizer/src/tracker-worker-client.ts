import type {
  EclipseScene,
  EclipseSummary,
  LocalEclipse,
  Observer,
} from "@found-in-space/shadowline";

interface WorkerResponse<T> {
  id: number;
  ok: boolean;
  result?: T;
  error?: string;
}

export class TrackerWorkerClient {
  private readonly eventId: string;
  private readonly worker = new Worker(
    new URL("./tracker-worker.ts", import.meta.url),
    { type: "module" },
  );
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(reason: Error): void }
  >();

  constructor(eventId: string) {
    this.eventId = eventId;
    this.worker.addEventListener(
      "message",
      (message: MessageEvent<WorkerResponse<unknown>>) => {
        const pending = this.pending.get(message.data.id);
        if (!pending) return;
        this.pending.delete(message.data.id);
        if (message.data.ok) {
          pending.resolve(message.data.result);
        } else {
          pending.reject(new Error(message.data.error ?? "Eclipse worker failed."));
        }
      },
    );
  }

  private request<T>(payload: object): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.worker.postMessage({ ...payload, id });
    });
  }

  initialize(): Promise<{ event: EclipseSummary; scene: EclipseScene }> {
    return this.request({ type: "initialize", eventId: this.eventId });
  }

  calculateLocation(observer: Observer): Promise<{ local: LocalEclipse | null }> {
    return this.request({ type: "location", observer });
  }

  calculateShadow(atUtc: string): Promise<{ scene: EclipseScene }> {
    return this.request({ type: "shadow", atUtc });
  }
}

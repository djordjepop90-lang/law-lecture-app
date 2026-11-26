// Central request scheduler. EVERY generation task (outline, storyboard, Q&A) must go
// through enqueue() here. Two lanes, each concurrency 1. TTS lane enforces a
// minimum gap between calls. 429/503/RESOURCE_EXHAUSTED are retried with
// exponential backoff + jitter, honoring retryDelay from the error payload.
// While waiting, subscribers receive live status lines for the status bar.

export type Lane = 'text' | 'tts';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting-retry' // rate-limited, counting down
  | 'done'
  | 'failed';

export interface QueueEvent {
  taskId: string;
  lane: Lane;
  label: string; // e.g. "Storyboard · Chapter 2 · Scene 3/7"
  status: TaskStatus;
  attempt: number;
  maxAttempts: number;
  retryInSeconds?: number; // set while status === 'waiting-retry'
  error?: string;
}

type Listener = (e: QueueEvent) => void;

interface Task<T> {
  id: string;
  lane: Lane;
  label: string;
  fn: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

export class RateLimitError extends Error {
  retryDelaySeconds?: number;
  constructor(message: string, retryDelaySeconds?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryDelaySeconds = retryDelaySeconds;
  }
}

// Detect rate-limit / transient service errors (kept for any future remote backend).
// The SDK surfaces status on err.status / err.code and sometimes a nested
// error payload with details[].retryDelay.
export function isRetryableError(err: unknown): boolean {
  const anyErr = err as Record<string, unknown> | null;
  const status = String(anyErr?.status ?? anyErr?.code ?? '');
  const message = String(anyErr?.message ?? err ?? '');
  if (/429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|overloaded|rate.?limit/i.test(status + ' ' + message)) {
    return true;
  }
  return false;
}

export function extractRetryDelaySeconds(err: unknown): number | undefined {
  const anyErr = err as Record<string, unknown> | null;
  const candidates: unknown[] = [];
  const nested = (anyErr as Record<string, Record<string, unknown>> | undefined)?.error;
  const details = (anyErr?.details ?? nested?.details) as unknown;
  if (Array.isArray(details)) {
    for (const d of details) {
      const rd = (d as Record<string, unknown>)?.retryDelay;
      if (typeof rd === 'string') {
        const m = rd.match(/([\d.]+)s/);
        if (m) candidates.push(parseFloat(m[1]));
      } else if (typeof rd === 'number') candidates.push(rd);
    }
  }
  const top = (anyErr as Record<string, unknown> | undefined)?.retryDelay;
  if (typeof top === 'number') candidates.push(top);
  const nums = candidates.filter((n) => typeof n === 'number' && n > 0) as number[];
  return nums.length ? Math.min(...nums) : undefined;
}

const jitter = (ms: number) => ms * (0.5 + Math.random() * 0.5); // +/-50% jitter

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SchedulerOptions {
  backoffStartSeconds: number;
  backoffMaxSeconds: number;
  maxAttempts: number;
  ttsMinGapSeconds: number;
  textMinGapSeconds: number;
  slowModeMultiplier: number;
}

export class Scheduler {
  private listeners = new Set<Listener>();
  private options: SchedulerOptions;
  private slowMode = false;
  // per-lane: running flag + queue + last call timestamp
  private lanes: Record<Lane, { running: boolean; queue: Task<unknown>[]; lastCallAt: number }> = {
    text: { running: false, queue: [], lastCallAt: 0 },
    tts: { running: false, queue: [], lastCallAt: 0 },
  };
  private counter = 0;

  constructor(options: SchedulerOptions) {
    this.options = options;
  }

  setSlowMode(on: boolean) {
    this.slowMode = on;
  }
  isSlowMode() {
    return this.slowMode;
  }

  private mult() {
    return this.slowMode ? this.options.slowModeMultiplier : 1;
  }

  onEvent(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(e: QueueEvent) {
    for (const l of this.listeners) l(e);
  }

  queueLength(lane?: Lane): number {
    if (lane) return this.lanes[lane].queue.length + (this.lanes[lane].running ? 1 : 0);
    return this.queueLength('text') + this.queueLength('tts');
  }

  enqueue<T>(lane: Lane, label: string, fn: () => Promise<T>): Promise<T> {
    const id = `t${++this.counter}`;
    return new Promise<T>((resolve, reject) => {
      const task: Task<T> = { id, lane, label, fn, resolve, reject };
      const L = this.lanes[lane];
      L.queue.push(task as Task<unknown>);
      this.emit({ taskId: id, lane, label, status: 'queued', attempt: 0, maxAttempts: this.options.maxAttempts });
      void this.pump(lane);
    });
  }

  private async pump(lane: Lane) {
    const L = this.lanes[lane];
    if (L.running) return;
    L.running = true;
    try {
      while (L.queue.length > 0) {
        const task = L.queue.shift()!;
        await this.runTask(lane, task);
      }
    } finally {
      L.running = false;
    }
  }

  private async runTask(lane: Lane, task: Task<unknown>) {
    const L = this.lanes[lane];
    const minGap = (lane === 'tts' ? this.options.ttsMinGapSeconds : this.options.textMinGapSeconds) * this.mult() * 1000;
    const wait = minGap - (Date.now() - L.lastCallAt);
    if (wait > 0) await sleep(wait);

    let attempt = 0;
    for (;;) {
      attempt++;
      L.lastCallAt = Date.now();
      this.emit({
        taskId: task.id, lane, label: task.label, status: 'running',
        attempt, maxAttempts: this.options.maxAttempts,
      });
      try {
        const result = await task.fn();
        this.emit({
          taskId: task.id, lane, label: task.label, status: 'done',
          attempt, maxAttempts: this.options.maxAttempts,
        });
        task.resolve(result);
        return;
      } catch (err) {
        const retryable = isRetryableError(err);
        const last = attempt >= this.options.maxAttempts;
        if (!retryable || last) {
          const msg = err instanceof Error ? err.message : String(err);
          this.emit({
            taskId: task.id, lane, label: task.label, status: 'failed',
            attempt, maxAttempts: this.options.maxAttempts, error: msg,
          });
          task.reject(err);
          return;
        }
        // Exponential backoff + jitter, honoring server-provided retryDelay.
        const base = Math.min(
          this.options.backoffStartSeconds * 2 ** (attempt - 1),
          this.options.backoffMaxSeconds,
        );
        const serverDelay = extractRetryDelaySeconds(err);
        const raw = Math.max(base, serverDelay ?? 0) * this.mult();
        const waitSeconds = Math.min(Math.max(raw, this.options.backoffStartSeconds * this.mult()), this.options.backoffMaxSeconds * this.mult());
        const waitMs = jitter(waitSeconds * 1000);
        // Live countdown so the UI can show "retrying in 18s, attempt 2/8".
        const deadline = Date.now() + waitMs;
        this.emit({
          taskId: task.id, lane, label: task.label, status: 'waiting-retry',
          attempt, maxAttempts: this.options.maxAttempts, retryInSeconds: Math.ceil(waitMs / 1000),
        });
        while (Date.now() < deadline) {
          const remaining = Math.max(0, (deadline - Date.now()) / 1000);
          this.emit({
            taskId: task.id, lane, label: task.label, status: 'waiting-retry',
            attempt, maxAttempts: this.options.maxAttempts, retryInSeconds: Math.ceil(remaining),
          });
          await sleep(500);
        }
      }
    }
  }
}

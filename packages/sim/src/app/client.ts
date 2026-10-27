import superjson, { type SuperJSONResult } from "superjson";

export const APP_URL = process.env.SIM_APP_URL || "http://localhost:3000";

export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly ms: number,
  ) {
    super(message);
  }
}

export interface Timed<T> {
  data: T;
  ms: number;
}

export interface ChatResult {
  text: string;
  tools: string[];
  firstTokenMs: number | null;
  totalMs: number;
  error?: string;
}

/**
 * A persona's HTTP session against the running app — the same endpoints the
 * browser uses (Better Auth cookies, tRPC + superjson, /api/chat SSE). Every
 * call is timed: latency is first-class feedback.
 */
export class AppClient {
  private cookies = new Map<string, string>();

  constructor(readonly baseUrl = APP_URL) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    return { origin: this.baseUrl, ...(cookie ? { cookie } : {}), ...extra };
  }

  private absorb(res: Response): void {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const eq = pair!.indexOf("=");
      if (eq > 0) this.cookies.set(pair!.slice(0, eq).trim(), pair!.slice(eq + 1).trim());
    }
  }

  get cookieList(): { name: string; value: string }[] {
    return [...this.cookies].map(([name, value]) => ({ name, value }));
  }

  private async authPost(path: string, body: unknown): Promise<Timed<unknown>> {
    const t0 = performance.now();
    const res = await fetch(`${this.baseUrl}/api/auth/${path}`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
    const ms = performance.now() - t0;
    this.absorb(res);
    if (!res.ok) throw new AppError(`${path} → ${res.status} ${await res.text()}`, res.status, ms);
    return { data: await res.json(), ms };
  }

  /** App user id from the last sign-in (keys per-user device storage). */
  userId: string | null = null;

  async signIn(email: string, password: string) {
    const res = await this.authPost("sign-in/email", { email, password });
    this.userId = (res.data as { user?: { id?: string } }).user?.id ?? null;
    return res;
  }

  signUp(name: string, email: string, password: string) {
    return this.authPost("sign-up/email", { name, email, password });
  }

  async query<T>(path: string, input?: unknown): Promise<Timed<T>> {
    const qs = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(superjson.serialize(input)))}`;
    return this.trpc<T>(`${path}${qs}`, { method: "GET", headers: this.headers() });
  }

  async mutate<T>(path: string, input: unknown): Promise<Timed<T>> {
    return this.trpc<T>(path, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(superjson.serialize(input)),
    });
  }

  private async trpc<T>(pathAndQuery: string, init: RequestInit): Promise<Timed<T>> {
    const t0 = performance.now();
    const res = await fetch(`${this.baseUrl}/api/trpc/${pathAndQuery}`, init);
    const body = (await res.json()) as {
      result?: { data: SuperJSONResult };
      error?: { json?: { message?: string } };
    };
    const ms = performance.now() - t0;
    if (!res.ok || !body.result) {
      const name = pathAndQuery.split("?")[0];
      throw new AppError(`${name} → ${res.status} ${body.error?.json?.message ?? "error"}`, res.status, ms);
    }
    return { data: superjson.deserialize<T>(body.result.data), ms };
  }

  /**
   * What opening /chat does: the page warms the portfolio snapshot while the
   * user types. A persona "types" instantly, so callers await this (untimed,
   * standing in for typing) before `chat`. Failures are ignored, like the page.
   */
  async openChat(): Promise<number | null> {
    try {
      return (await this.mutate("chat.warm", {})).ms;
    } catch {
      return null;
    }
  }

  /** One chat turn over SSE; times first text token and the whole answer. */
  async chat(message: string, threadId?: string): Promise<ChatResult & { threadId?: string }> {
    const t0 = performance.now();
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ message, ...(threadId ? { threadId } : {}) }),
    });
    if (!res.ok || !res.body) {
      return { text: "", tools: [], firstTokenMs: null, totalMs: performance.now() - t0, error: `HTTP ${res.status}` };
    }
    let text = "";
    let firstTokenMs: number | null = null;
    let error: string | undefined;
    let thread: string | undefined;
    const tools: string[] = [];
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 2);
        if (!line.startsWith("data:")) continue;
        const evt = JSON.parse(line.slice(5)) as { type: string; value?: string };
        if (evt.type === "text") {
          firstTokenMs ??= performance.now() - t0;
          text += evt.value ?? "";
        } else if (evt.type === "tool" && evt.value) tools.push(evt.value);
        else if (evt.type === "thread") thread = evt.value;
        else if (evt.type === "error") error = evt.value;
      }
    }
    return { text, tools, firstTokenMs, totalMs: performance.now() - t0, error, threadId: thread };
  }
}

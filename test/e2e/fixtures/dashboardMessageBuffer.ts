import type { Page } from "playwright";

type BufferedMessage = {
  type: string;
  props: Record<string, unknown>;
  ts: number;
};

export async function installDashboardMessageBuffer(page: Page): Promise<void> {
  try {
    await page.addInitScript(() => {
      const storageKey = "__nwWrldE2EDashboardMessages";
      const anyGlobal = globalThis as unknown as {
        __nwWrldE2EDashboard?: {
          messages: { type: string; props: Record<string, unknown>; ts: number }[];
          installed: boolean;
          cleanup?: (() => void) | undefined;
        };
      };

      const loadExisting = () => {
        if (anyGlobal.__nwWrldE2EDashboard?.messages?.length) return;
        try {
          const raw = globalThis.sessionStorage?.getItem?.(storageKey) || null;
          if (!raw) return;
          const parsed = JSON.parse(raw) as unknown;
          if (!Array.isArray(parsed)) return;
          anyGlobal.__nwWrldE2EDashboard = {
            messages: parsed.filter((x) => x && typeof x === "object") as {
              type: string;
              props: Record<string, unknown>;
              ts: number;
            }[],
            installed: false,
          };
        } catch {}
      };

      const tryInstall = () => {
        loadExisting();
        if (anyGlobal.__nwWrldE2EDashboard?.installed) return true;

        const bridge = (globalThis as unknown as { nwWrldBridge?: unknown }).nwWrldBridge as
          | { messaging?: { onFromProjector?: unknown } }
          | null
          | undefined;
        const messaging = bridge?.messaging;
        if (!messaging || typeof messaging.onFromProjector !== "function") return false;

        if (!anyGlobal.__nwWrldE2EDashboard) {
          anyGlobal.__nwWrldE2EDashboard = { messages: [], installed: false };
        }
        anyGlobal.__nwWrldE2EDashboard.installed = true;

        const cleanup = messaging.onFromProjector((_event: unknown, data: unknown) => {
          if (!data || typeof data !== "object") return;
          const rawType = (data as { type?: unknown }).type;
          const rawProps = (data as { props?: unknown }).props;
          const type = typeof rawType === "string" ? rawType : String(rawType ?? "");
          const props =
            rawProps && typeof rawProps === "object" && !Array.isArray(rawProps)
              ? (rawProps as Record<string, unknown>)
              : {};
          const next = { type, props, ts: Date.now() };
          anyGlobal.__nwWrldE2EDashboard?.messages.push(next);
          try {
            globalThis.sessionStorage?.setItem?.(
              storageKey,
              JSON.stringify(anyGlobal.__nwWrldE2EDashboard?.messages || [])
            );
          } catch {}
        });

        anyGlobal.__nwWrldE2EDashboard.cleanup = typeof cleanup === "function" ? cleanup : undefined;
        return true;
      };

      const started = Date.now();
      const tick = () => {
        if (tryInstall()) return;
        if (Date.now() - started > 15_000) return;
        setTimeout(tick, 50);
      };
      tick();
    });
  } catch {}

  await page.waitForFunction(
    () => {
      const bridge = globalThis.nwWrldBridge as unknown as {
        messaging?: { onFromProjector?: unknown };
      } | null;
      return Boolean(bridge?.messaging && typeof bridge.messaging.onFromProjector === "function");
    },
    undefined,
    { timeout: 15_000 }
  );
  await page.evaluate(() => {
    const bridge = globalThis.nwWrldBridge;
    const messaging = bridge?.messaging;
    if (!messaging || typeof messaging.onFromProjector !== "function") return;

    const anyGlobal = globalThis as unknown as {
      __nwWrldE2EDashboard?: {
        messages: BufferedMessage[];
        installed: boolean;
        cleanup?: (() => void) | undefined;
      };
    };

    if (anyGlobal.__nwWrldE2EDashboard?.installed) return;

    const storageKey = "__nwWrldE2EDashboardMessages";
    let existing: BufferedMessage[] = [];
    try {
      const raw = globalThis.sessionStorage?.getItem?.(storageKey) || null;
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          existing = parsed.filter((x) => x && typeof x === "object") as BufferedMessage[];
        }
      }
    } catch {}

    anyGlobal.__nwWrldE2EDashboard = {
      messages: existing,
      installed: true,
    };

    const cleanup = messaging.onFromProjector((_event: unknown, data: unknown) => {
      if (!data || typeof data !== "object") return;
      const rawType = (data as { type?: unknown }).type;
      const rawProps = (data as { props?: unknown }).props;
      const type = typeof rawType === "string" ? rawType : String(rawType ?? "");
      const props =
        rawProps && typeof rawProps === "object" && !Array.isArray(rawProps)
          ? (rawProps as Record<string, unknown>)
          : {};
      const next = { type, props, ts: Date.now() };
      anyGlobal.__nwWrldE2EDashboard?.messages.push(next);
      try {
        globalThis.sessionStorage?.setItem?.(
          storageKey,
          JSON.stringify(anyGlobal.__nwWrldE2EDashboard?.messages || [])
        );
      } catch {}
    });
    anyGlobal.__nwWrldE2EDashboard.cleanup = typeof cleanup === "function" ? cleanup : undefined;
  });
}

export async function clearDashboardMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    const anyGlobal = globalThis as unknown as {
      __nwWrldE2EDashboard?: { messages: unknown[] };
    };
    try {
      globalThis.sessionStorage?.removeItem?.("__nwWrldE2EDashboardMessages");
    } catch {}
    if (!anyGlobal.__nwWrldE2EDashboard) return;
    anyGlobal.__nwWrldE2EDashboard.messages = [];
  });
}

export async function getDashboardMessages(page: Page): Promise<BufferedMessage[]> {
  return await page.evaluate(() => {
    const anyGlobal = globalThis as unknown as {
      __nwWrldE2EDashboard?: { messages: BufferedMessage[] };
    };
    const msgs = anyGlobal.__nwWrldE2EDashboard?.messages;
    if (Array.isArray(msgs)) return msgs;
    try {
      const raw = globalThis.sessionStorage?.getItem?.("__nwWrldE2EDashboardMessages") || null;
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as BufferedMessage[]) : [];
    } catch {
      return [];
    }
  });
}

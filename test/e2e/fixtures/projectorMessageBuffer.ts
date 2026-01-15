import type { Page } from "playwright";

type BufferedMessage = {
  type: string;
  props: Record<string, unknown>;
  ts: number;
};

export async function installProjectorMessageBuffer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const bridge = globalThis.nwWrldBridge;
    const messaging = bridge?.messaging;
    if (!messaging || typeof messaging.onFromDashboard !== "function") return;

    const anyGlobal = globalThis as unknown as {
      __nwWrldE2EProjector?: {
        messages: BufferedMessage[];
        installed: boolean;
        cleanup?: (() => void) | undefined;
      };
    };

    if (anyGlobal.__nwWrldE2EProjector?.installed) return;

    anyGlobal.__nwWrldE2EProjector = {
      messages: [],
      installed: true,
    };

    const cleanup = messaging.onFromDashboard((_event: unknown, data: unknown) => {
      if (!data || typeof data !== "object") return;
      const rawType = (data as { type?: unknown }).type;
      const rawProps = (data as { props?: unknown }).props;
      const type = typeof rawType === "string" ? rawType : String(rawType ?? "");
      const props =
        rawProps && typeof rawProps === "object" && !Array.isArray(rawProps)
          ? (rawProps as Record<string, unknown>)
          : {};
      anyGlobal.__nwWrldE2EProjector?.messages.push({ type, props, ts: Date.now() });
    });
    anyGlobal.__nwWrldE2EProjector.cleanup = typeof cleanup === "function" ? cleanup : undefined;
  });
}

export async function clearProjectorMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    const anyGlobal = globalThis as unknown as {
      __nwWrldE2EProjector?: { messages: unknown[] };
    };
    if (!anyGlobal.__nwWrldE2EProjector) return;
    anyGlobal.__nwWrldE2EProjector.messages = [];
  });
}

export async function getProjectorMessages(page: Page): Promise<BufferedMessage[]> {
  return await page.evaluate(() => {
    const anyGlobal = globalThis as unknown as {
      __nwWrldE2EProjector?: { messages: BufferedMessage[] };
    };
    const msgs = anyGlobal.__nwWrldE2EProjector?.messages;
    return Array.isArray(msgs) ? msgs : [];
  });
}

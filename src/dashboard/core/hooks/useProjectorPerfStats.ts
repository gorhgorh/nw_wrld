import { useIPCListener } from "./useIPC";

type PerfStats = { fps: number; frameMsAvg: number; longFramePct: number; at: number };

export const useProjectorPerfStats = (setPerfStats: (next: PerfStats) => void) => {
  useIPCListener("from-projector", (_event, data) => {
    if (!data || typeof data !== "object") return;
    if ((data as { type?: unknown }).type !== "perf:stats") return;
    const p = (data as { props?: unknown }).props;
    if (!p || typeof p !== "object") return;
    const fps = typeof (p as any).fps === "number" && Number.isFinite((p as any).fps) ? (p as any).fps : null;
    const frameMsAvg =
      typeof (p as any).frameMsAvg === "number" && Number.isFinite((p as any).frameMsAvg)
        ? (p as any).frameMsAvg
        : null;
    const longFramePct =
      typeof (p as any).longFramePct === "number" && Number.isFinite((p as any).longFramePct)
        ? (p as any).longFramePct
        : 0;
    const at = typeof (p as any).at === "number" && Number.isFinite((p as any).at) ? (p as any).at : null;
    if (fps == null || frameMsAvg == null || at == null) return;
    setPerfStats({ fps, frameMsAvg, longFramePct, at });
  });
};


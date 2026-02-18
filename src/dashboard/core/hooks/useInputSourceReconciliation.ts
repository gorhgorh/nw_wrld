import { useEffect, useRef } from "react";
import { getActiveSetTracks } from "../../../shared/utils/setUtils";
import { useIPCInvoke } from "./useIPC";

const RECONCILABLE = new Set(["midi", "osc", "websocket"]);

/**
 * Scans all module instances across all tracks in the active set,
 * collects per-module inputSource values, and calls input:reconcileSources
 * so the InputManager starts/stops transports as needed.
 *
 * Only calls reconcileSources when at least one module has a custom
 * inputSource set, or when transitioning from "some overrides" back to
 * "no overrides" (so extra sources can be cleaned up).
 */
export function useInputSourceReconciliation(userData: unknown, activeSetId: unknown) {
  const invokeIPC = useIPCInvoke();
  const prevKeyRef = useRef<string>("");
  const hasEverCalledRef = useRef(false);

  useEffect(() => {
    const tracks = getActiveSetTracks(userData, activeSetId);
    const needed = new Set<string>();

    for (const track of tracks as unknown[]) {
      const t = track && typeof track === "object" ? (track as Record<string, unknown>) : null;
      if (!t || !Array.isArray(t.modules)) continue;
      for (const mod of t.modules as unknown[]) {
        const m = mod && typeof mod === "object" ? (mod as Record<string, unknown>) : null;
        if (!m) continue;
        if (m.disabled === true) continue;
        const src = typeof m.inputSource === "string" ? m.inputSource : null;
        if (src && RECONCILABLE.has(src)) {
          needed.add(src);
        }
      }
    }

    const key = Array.from(needed).sort().join(",");
    if (key === prevKeyRef.current) return;

    // Skip if no modules have custom transport and we've never called before.
    // This avoids a spurious reconcileSources([]) call on startup or module
    // additions that don't involve per-module transport.
    if (needed.size === 0 && !hasEverCalledRef.current) {
      prevKeyRef.current = key;
      return;
    }

    prevKeyRef.current = key;
    hasEverCalledRef.current = true;

    invokeIPC("input:reconcileSources", Array.from(needed)).catch(() => {});
  }, [
    (userData as { sets?: unknown })?.sets,
    activeSetId,
    invokeIPC,
  ]);
}

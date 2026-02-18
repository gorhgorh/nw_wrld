import { ipcMain } from "electron";

import InputManager from "../../InputManager";
import { state } from "../state";

export function registerTestWebSocketBridge(): void {
  const isTest = process.env.NODE_ENV === "test";
  const isMockWebSocket = process.env.NW_WRLD_TEST_WEBSOCKET_MOCK === "1";
  if (!isTest || !isMockWebSocket) return;

  ipcMain.handle("test:websocket:emitTrack", async (_event, payload: unknown) => {
    const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
    const address = p && typeof p.address === "string" ? p.address : "";
    if (!address) return { ok: false };
    if (!state.inputManager) return { ok: false };
    (state.inputManager as InputManager).broadcast("track-selection", {
      source: "websocket",
      identifier: address,
      address,
    });
    return { ok: true };
  });

  ipcMain.handle("test:websocket:emitChannel", async (_event, payload: unknown) => {
    const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
    const address = p && typeof p.address === "string" ? p.address : "";
    const velocity = p && typeof p.velocity === "number" ? p.velocity : 127;
    if (!address) return { ok: false };
    if (!Number.isFinite(velocity)) return { ok: false };
    if (!state.inputManager) return { ok: false };
    (state.inputManager as InputManager).broadcast("method-trigger", {
      source: "websocket",
      channelName: address,
      velocity,
      address,
    });
    return { ok: true };
  });
}

import logger from "../helpers/logger";
import { getMessaging } from "./bridge.js";

export function queueDebugLog(log) {
  if (!this.debugOverlayActive || !logger.debugEnabled) return;

  this.debugLogQueue.push(log);
  if (!this.debugLogTimeout) {
    this.debugLogTimeout = setTimeout(() => {
      if (this.debugLogQueue.length > 0 && this.debugOverlayActive) {
        const batchedLogs = this.debugLogQueue.join("\n\n");
        const messaging = getMessaging();
        if (!messaging || typeof messaging.sendToDashboard !== "function") return;
        messaging.sendToDashboard("debug-log", { log: batchedLogs });
        this.debugLogQueue = [];
      }
      this.debugLogTimeout = null;
    }, 100);
  }
}


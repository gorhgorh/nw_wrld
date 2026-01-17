import { getMessaging } from "./bridge.js";

export function initWorkspaceModulesChangedListener() {
  const messaging = getMessaging();
  messaging?.onWorkspaceModulesChanged?.(() => {
    this.workspaceModuleSourceCache.clear();
    this.assetsBaseUrl = null;
    try {
      this.trackSandboxHost?.destroy?.();
    } catch {}
    this.trackSandboxHost = null;
    this.trackModuleSources = null;
  });
}


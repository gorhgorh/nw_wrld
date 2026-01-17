import logger from "../../helpers/logger";
import { TrackSandboxHost } from "../sandbox/TrackSandboxHost.js";
import { getMessaging } from "../bridge.js";

export async function previewModule(moduleName, moduleData, requestId = null) {
  const token = ++this.previewToken;
  const debugEnabled = logger.debugEnabled;
  if (debugEnabled) {
    logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.log(`🎨 [PREVIEW] Starting preview for module: ${moduleName}`);
    logger.log(`🎨 [PREVIEW] Module data received:`, moduleData);
    logger.log(`🎨 [PREVIEW] Clearing any existing preview...`);
  }
  const prevName = this.previewModuleName;
  if (prevName) {
    this.clearPreviewForModule(prevName);
  }

  const modulesContainer = document.querySelector(".modules");
  if (debugEnabled) {
    logger.log(`🎨 [PREVIEW] Modules container found:`, !!modulesContainer);
  }
  if (!modulesContainer) {
    logger.error("❌ [PREVIEW] No .modules container found in DOM");
    if (requestId) {
      const messaging = getMessaging();
      messaging?.sendToDashboard?.("preview-module-error", {
        moduleName,
        requestId,
        error: "NO_MODULES_CONTAINER",
      });
    }
    return;
  }

  if (token !== this.previewToken) {
    return;
  }

  try {
    if (debugEnabled) {
      logger.log(`🎨 [PREVIEW] Setting preview module name: ${moduleName}`);
    }
    this.previewModuleName = moduleName;
    const previewKey = `preview_${moduleName}`;

    const src = await this.loadWorkspaceModuleSource(moduleName);
    if (token !== this.previewToken) {
      return;
    }
    const moduleSources = { [moduleName]: { text: src?.text || "" } };

    if (this.activeTrack?.name) {
      this.restoreTrackNameAfterPreview = this.activeTrack.name;
    } else {
      this.restoreTrackNameAfterPreview = null;
    }

    if (this.restoreTrackNameAfterPreview) {
      this.deactivateActiveTrack();
    }

    try {
      this.trackSandboxHost?.destroy?.();
    } catch {}
    this.trackSandboxHost = new TrackSandboxHost(modulesContainer);
    this.trackModuleSources = moduleSources;

    await this.trackSandboxHost.ensureSandbox();
    if (token !== this.previewToken) {
      try {
        this.trackSandboxHost?.destroy?.();
      } catch {}
      this.trackSandboxHost = null;
      this.trackModuleSources = null;
      return;
    }
    const assetsBaseUrl = this.getAssetsBaseUrlForSandboxToken(this.trackSandboxHost.token);
    if (!assetsBaseUrl) throw new Error("ASSETS_BASE_URL_UNAVAILABLE");

    const track = {
      name: `preview:${moduleName}`,
      modules: [{ id: previewKey, type: moduleName }],
      modulesData: {
        [previewKey]: {
          constructor: Array.isArray(moduleData?.constructor)
            ? moduleData.constructor
            : [],
        },
      },
    };

    if (token !== this.previewToken) {
      try {
        this.trackSandboxHost?.destroy?.();
      } catch {}
      this.trackSandboxHost = null;
      this.trackModuleSources = null;
      return;
    }

    const res = await this.trackSandboxHost.initTrack({
      track,
      moduleSources,
      assetsBaseUrl,
    });
    if (!res || res.ok !== true) {
      throw new Error(res?.error || "SANDBOX_PREVIEW_INIT_FAILED");
    }
    if (token !== this.previewToken) {
      this.clearPreviewForModule(moduleName);
      if (debugEnabled) logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      return;
    }
    this.activeModules[previewKey] = [{}];

    if (token !== this.previewToken) {
      this.clearPreviewForModule(moduleName);
      if (debugEnabled) logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      return;
    }

    if (debugEnabled) {
      logger.log(`✅✅✅ [PREVIEW] Preview active for: ${moduleName}`);
      logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    }

    if (requestId) {
      const messaging = getMessaging();
      messaging?.sendToDashboard?.("preview-module-ready", {
        moduleName,
        requestId,
      });
    }
  } catch (error) {
    logger.error(`❌ [PREVIEW] Error instantiating module "${moduleName}":`, error);
    logger.error(`❌ [PREVIEW] Error stack:`, error.stack);

    this.clearPreviewForModule(moduleName);

    if (debugEnabled) logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    if (requestId) {
      const messaging = getMessaging();
      messaging?.sendToDashboard?.("preview-module-error", {
        moduleName,
        requestId,
        error: error?.message || "PREVIEW_FAILED",
      });
    }
  }
}

export function clearPreview() {
  this.previewToken++;
  const debugEnabled = logger.debugEnabled;
  if (debugEnabled) logger.log(`🧹 [PREVIEW] clearPreview called`);

  if (!this.previewModuleName) {
    if (debugEnabled) logger.log(`🧹 [PREVIEW] No preview module to clear`);
    return;
  }

  const moduleName = this.previewModuleName;
  this.clearPreviewForModule(moduleName);
}

export function clearPreviewForModule(moduleName) {
  const debugEnabled = logger.debugEnabled;
  if (debugEnabled) logger.log(`🧹 [PREVIEW] Clearing preview for: ${moduleName}`);

  const modulesContainer = document.querySelector(".modules");
  if (!modulesContainer) {
    logger.error("❌ [PREVIEW] No .modules container found");
    if (this.previewModuleName === moduleName) {
      this.previewModuleName = null;
    }
    return;
  }

  const previewKey = `preview_${moduleName}`;
  try {
    this.trackSandboxHost?.destroy?.();
  } catch {}
  this.trackSandboxHost = null;
  this.trackModuleSources = null;
  try {
    modulesContainer.textContent = "";
  } catch {}

  if (this.activeModules[previewKey]) {
    delete this.activeModules[previewKey];
  }
  if (this.previewModuleName === moduleName) {
    this.previewModuleName = null;
  }
  if (debugEnabled) logger.log(`✅✅✅ [PREVIEW] Preview cleared successfully`);

  const restore = this.restoreTrackNameAfterPreview;
  this.restoreTrackNameAfterPreview = null;
  if (restore) {
    this.activeTrack = null;
    this.handleTrackSelection(restore);
  }
}

export async function triggerPreviewMethod(moduleName, methodName, options) {
  const debugEnabled = logger.debugEnabled;
  if (debugEnabled) {
    logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.log(
      `🎯 [PREVIEW] Triggering method "${methodName}" on preview: ${moduleName}`
    );
    logger.log(`🎯 [PREVIEW] Options:`, options);
  }

  if (!this.previewModuleName || this.previewModuleName !== moduleName) {
    logger.error(`❌ [PREVIEW] No active preview for module: ${moduleName}`);
    if (debugEnabled) logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    return;
  }

  const previewKey = `preview_${moduleName}`;
  const host = this.trackSandboxHost;
  if (!host) return;

  try {
    const res = await host.invokeOnInstance(previewKey, methodName, options);
    if (!res || res.ok !== true) {
      throw new Error(res?.error || "SANDBOX_PREVIEW_INVOKE_FAILED");
    }
    if (debugEnabled) {
      logger.log(`✅✅✅ [PREVIEW] Method trigger completed`);
      logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    }
  } catch (error) {
    logger.error(`❌ [PREVIEW] Error triggering method "${methodName}":`, error);
    logger.error(`❌ [PREVIEW] Error stack:`, error.stack);
    if (debugEnabled) logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  }
}


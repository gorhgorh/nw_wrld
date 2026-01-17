import { TrackSandboxHost } from "./sandbox/TrackSandboxHost.js";

export async function introspectModule(moduleId) {
  const safeModuleId = String(moduleId || "").trim();
  if (!safeModuleId) {
    return { moduleId, ok: false, error: "INVALID_MODULE_ID" };
  }

  let mtimeMs = null;
  try {
    if (this.workspacePath) {
      const bridge = globalThis.nwWrldBridge;
      const info =
        bridge?.workspace && typeof bridge.workspace.getModuleUrl === "function"
          ? await bridge.workspace.getModuleUrl(safeModuleId)
          : null;
      mtimeMs = typeof info?.mtimeMs === "number" ? info.mtimeMs : null;
    }
  } catch {
    mtimeMs = null;
  }

  const cacheKey =
    mtimeMs != null ? `${safeModuleId}:${mtimeMs}` : `${safeModuleId}:na`;
  if (this.moduleIntrospectionCache.has(cacheKey)) {
    return this.moduleIntrospectionCache.get(cacheKey);
  }

  const result = await (async () => {
    try {
      const src = await this.loadWorkspaceModuleSource(safeModuleId);
      if (!this.trackSandboxHost) {
        this.trackSandboxHost = new TrackSandboxHost(null);
      }
      const initRes = await this.trackSandboxHost.introspectModule(
        src.moduleId,
        src.text
      );
      if (!initRes || initRes.ok !== true) {
        const err =
          (initRes && (initRes.error || initRes.reason)) || "INTROSPECTION_FAILED";
        return {
          moduleId: safeModuleId,
          ok: false,
          error: String(err),
          mtimeMs,
        };
      }

      const displayName = initRes?.name || safeModuleId;
      return {
        moduleId: safeModuleId,
        ok: true,
        name: displayName,
        category: initRes?.category || "Workspace",
        methods: Array.isArray(initRes?.methods) ? initRes.methods : [],
        mtimeMs,
      };
    } catch (e) {
      return {
        moduleId: safeModuleId,
        ok: false,
        error: e?.message || "INTROSPECTION_FAILED",
        mtimeMs,
      };
    }
  })();

  for (const key of this.moduleIntrospectionCache.keys()) {
    if (key.startsWith(`${safeModuleId}:`) && key !== cacheKey) {
      this.moduleIntrospectionCache.delete(key);
    }
  }
  this.moduleIntrospectionCache.set(cacheKey, result);
  return result;
}


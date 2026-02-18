import { TrackSandboxHost } from "./sandbox/TrackSandboxHost";

type WorkspaceGetModuleUrlResult = { mtimeMs?: unknown };

type IntrospectionContext = {
  workspacePath: unknown;
  moduleIntrospectionCache: Map<string, unknown>;
  loadWorkspaceModuleSource: (
    moduleId: unknown
  ) => Promise<{ moduleId: string; text: string; mtimeMs: number } | null>;
  trackSandboxHost: TrackSandboxHost | null;
};

type UserImportEntry = { name?: string; resolvedUrl?: string };
type ReadUserImportsResult = { ok?: boolean; imports?: UserImportEntry[] } | null;

export async function introspectModule(
  this: IntrospectionContext,
  moduleId: unknown
): Promise<unknown> {
  const safeModuleId = String(moduleId || "").trim();
  if (!safeModuleId) {
    return { moduleId, ok: false, error: "INVALID_MODULE_ID" };
  }

  let mtimeMs: number | null = null;
  try {
    if (this.workspacePath) {
      const bridge =
        (globalThis as typeof globalThis & { nwWrldBridge?: unknown })
          .nwWrldBridge as
          | { workspace?: { getModuleUrl?: (id: string) => Promise<unknown> | unknown } }
          | undefined;
      const info =
        bridge?.workspace && typeof bridge.workspace.getModuleUrl === "function"
          ? ((await bridge.workspace.getModuleUrl(
              safeModuleId
            )) as WorkspaceGetModuleUrlResult | null)
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
      if (!src) {
        return {
          moduleId: safeModuleId,
          ok: false,
          error: "INTROSPECTION_FAILED",
          mtimeMs,
        };
      }
      if (!this.trackSandboxHost) {
        this.trackSandboxHost = new TrackSandboxHost(null);
      }

      // Read user import names so the sandbox can validate them during introspection
      let userImportNames: string[] = [];
      try {
        const bridge =
          (globalThis as typeof globalThis & { nwWrldBridge?: unknown })
            .nwWrldBridge as
            | { workspace?: { readUserImports?: () => Promise<unknown> | unknown } }
            | undefined;
        if (bridge?.workspace && typeof bridge.workspace.readUserImports === "function") {
          const importResult = (await bridge.workspace.readUserImports()) as ReadUserImportsResult;
          if (importResult?.ok && Array.isArray(importResult.imports)) {
            userImportNames = importResult.imports
              .map((e) => (e && typeof e.name === "string" ? e.name : ""))
              .filter((n) => n.length > 0);
          }
        }
      } catch {}

      const initRes = await this.trackSandboxHost.introspectModule(
        src.moduleId,
        src.text,
        userImportNames
      );
      if (
        !initRes ||
        typeof initRes !== "object" ||
        (initRes as { ok?: unknown }).ok !== true
      ) {
        const err =
          (initRes &&
            typeof initRes === "object" &&
            ((initRes as { error?: unknown }).error ||
              (initRes as { reason?: unknown }).reason)) ||
          "INTROSPECTION_FAILED";
        return {
          moduleId: safeModuleId,
          ok: false,
          error: String(err),
          mtimeMs,
        };
      }

      const displayName =
        (initRes as { name?: unknown }).name || safeModuleId;
      return {
        moduleId: safeModuleId,
        ok: true,
        name: displayName,
        category: (initRes as { category?: unknown }).category || "Workspace",
        methods:
          Array.isArray((initRes as { methods?: unknown }).methods) &&
          (initRes as { methods?: unknown[] }).methods
            ? (initRes as { methods: unknown[] }).methods
            : [],
        mtimeMs,
      };
    } catch (e) {
      return {
        moduleId: safeModuleId,
        ok: false,
        error: (e as { message?: unknown } | null)?.message || "INTROSPECTION_FAILED",
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


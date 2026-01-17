import { useIPCListener } from "./useIPC";
import { updateActiveSet } from "../utils";

type UseModuleIntrospectionArgs = {
  activeSetId: unknown;
  setUserData: unknown;
  setPredefinedModules: (updater: (prev: any[]) => any[]) => void;
  setWorkspaceModuleLoadFailures: (updater: (prev: string[]) => string[]) => void;
};

export const useModuleIntrospection = ({
  activeSetId,
  setUserData,
  setPredefinedModules,
  setWorkspaceModuleLoadFailures,
}: UseModuleIntrospectionArgs) => {
  useIPCListener("from-projector", (_event, data) => {
    const d = data as any;
    if (d?.type !== "module-introspect-result") return;
    const payload = d?.props || {};
    const moduleId = payload.moduleId;
    if (!moduleId) return;

    if (payload.ok) {
      const incomingMethods = Array.isArray(payload.methods) ? payload.methods : [];
      setPredefinedModules((prev) =>
        (prev || []).map((m) =>
          m && m.id === moduleId
            ? {
                ...m,
                methods: incomingMethods,
                status: "ready",
              }
            : m
        )
      );
      setWorkspaceModuleLoadFailures((prev) => (prev || []).filter((id) => id !== moduleId));

      const executeOnLoad = incomingMethods
        .filter((m) => m && m.executeOnLoad)
        .filter((m) => m.name !== "matrix" && m.name !== "show");

      if (executeOnLoad.length) {
        updateActiveSet(setUserData as any, activeSetId, (activeSet: any) => {
          const tracks = Array.isArray(activeSet?.tracks) ? activeSet.tracks : [];
          for (const track of tracks) {
            const modules = Array.isArray(track?.modules) ? track.modules : [];
            const modulesData = track?.modulesData || null;
            if (!modulesData) continue;

            for (const inst of modules) {
              const instId = inst?.id ? String(inst.id) : "";
              const type = inst?.type ? String(inst.type) : "";
              if (!instId || !type) continue;
              if (type !== moduleId) continue;

              const data = modulesData[instId];
              const ctor = Array.isArray(data?.constructor) ? data.constructor : null;
              if (!ctor) continue;

              const names = ctor.map((m: any) => (m?.name ? String(m.name) : "")).filter(Boolean);
              if (names.length > 2) continue;
              if (names.some((n: string) => n !== "matrix" && n !== "show")) continue;

              const existingSet = new Set(names);
              const missing = executeOnLoad.filter((m) => !existingSet.has(m.name));
              if (!missing.length) continue;

              const matrix = ctor.find((m: any) => m?.name === "matrix") || null;
              const show = ctor.find((m: any) => m?.name === "show") || null;

              const filled = missing.map((method) => ({
                name: method.name,
                options: Array.isArray(method?.options)
                  ? method.options.map((opt: any) => ({
                      name: opt?.name,
                      value: opt?.defaultVal,
                    }))
                  : [],
              }));

              const nextCtor: any[] = [];
              if (matrix) nextCtor.push(matrix);
              nextCtor.push(...filled);
              if (show) nextCtor.push(show);
              data.constructor = nextCtor;
            }
          }
        });
      }
    } else {
      setWorkspaceModuleLoadFailures((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        if (list.includes(moduleId)) return list;
        return [...list, moduleId];
      });
      setPredefinedModules((prev) =>
        (prev || []).map((m) => (m && m.id === moduleId ? { ...m, status: "failed" } : m))
      );
    }
  });
};


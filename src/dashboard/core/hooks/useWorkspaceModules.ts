import { useCallback, useEffect } from "react";
import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import { getProjectDir } from "../../../shared/utils/projectDir";
import { updateUserData } from "../utils";
import { useIPCListener } from "./useIPC";

type ModuleStatus = "uninspected" | "ready" | "failed";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type ModuleEntry = {
  id: string;
  name: string;
  category: string;
  methods: unknown[];
  status: ModuleStatus;
};

type UseWorkspaceModulesArgs = {
  workspacePath: string | null;
  isWorkspaceModalOpen: boolean;
  sendToProjector: (type: string, props: Record<string, unknown>) => void;
  userData: unknown;
  setUserData: (updater: (prev: unknown) => unknown) => void;
  predefinedModules: ModuleEntry[];
  workspaceModuleFiles: string[];
  setPredefinedModules: Dispatch<SetStateAction<ModuleEntry[]>>;
  setWorkspaceModuleFiles: Dispatch<SetStateAction<string[]>>;
  setWorkspaceModuleLoadFailures: Dispatch<SetStateAction<string[]>>;
  setIsProjectorReady: Dispatch<SetStateAction<boolean>>;
  didMigrateWorkspaceModuleTypesRef: MutableRefObject<boolean>;
  loadModulesRunIdRef: MutableRefObject<number>;
};

export const useWorkspaceModules = ({
  workspacePath,
  isWorkspaceModalOpen,
  sendToProjector,
  userData,
  setUserData,
  predefinedModules,
  workspaceModuleFiles,
  setPredefinedModules,
  setWorkspaceModuleFiles,
  setWorkspaceModuleLoadFailures,
  setIsProjectorReady,
  didMigrateWorkspaceModuleTypesRef,
  loadModulesRunIdRef,
}: UseWorkspaceModulesArgs) => {
  const loadModules = useCallback(async () => {
    const runId = ++loadModulesRunIdRef.current;
    const isStale = () => runId !== loadModulesRunIdRef.current;
    try {
      if (isWorkspaceModalOpen) return;
      const projectDirArg = getProjectDir();
      if (!projectDirArg) return;
      if (!workspacePath) return;
      let summaries: unknown[] = [];
      try {
        const bridge = globalThis.nwWrldBridge as unknown as {
          workspace?: { listModuleSummaries?: () => Promise<unknown[]> };
        };
        if (
          bridge &&
          bridge.workspace &&
          typeof bridge.workspace.listModuleSummaries === "function"
        ) {
          summaries = await bridge.workspace.listModuleSummaries();
        } else {
          summaries = [];
        }
      } catch {
        summaries = [];
      }
      const safeSummaries = Array.isArray(summaries) ? summaries : [];
      const allModuleIds = safeSummaries
        .map((s) => {
          const rec = s as { id?: unknown };
          return rec?.id ? String(rec.id) : "";
        })
        .filter(Boolean);
      const listable = safeSummaries.filter((s) =>
        Boolean((s as { hasMetadata?: unknown })?.hasMetadata)
      );
      if (isStale()) return;
      setWorkspaceModuleFiles(allModuleIds);

      const validModules = listable
        .map((s) => {
          const rec = s as { id?: unknown; name?: unknown; category?: unknown };
          const moduleId = rec?.id ? String(rec.id) : "";
          const name = rec?.name ? String(rec.name) : "";
          const category = rec?.category ? String(rec.category) : "";
          if (!moduleId || !name || !category) return null;
          if (!/^[A-Za-z][A-Za-z0-9]*$/.test(moduleId)) return null;
          return {
            id: moduleId,
            name,
            category,
            methods: [],
            status: "uninspected",
          } satisfies ModuleEntry;
        })
        .filter(Boolean) as ModuleEntry[];
      if (isStale()) return;
      setPredefinedModules(validModules);
      setWorkspaceModuleLoadFailures([]);
      setIsProjectorReady(false);
      if (isStale()) return;
      sendToProjector("refresh-projector", {});
      return;
    } catch (error) {
      console.error("❌ [Dashboard] Error loading modules:", error);
      alert("Failed to load modules from project folder.");
    }
  }, [
    isWorkspaceModalOpen,
    sendToProjector,
    workspacePath,
    setWorkspaceModuleFiles,
    setPredefinedModules,
    setWorkspaceModuleLoadFailures,
    setIsProjectorReady,
    loadModulesRunIdRef,
  ]);

  useEffect(() => {
    loadModules();
  }, [loadModules]);

  useEffect(() => {
    try {
      if (!workspacePath) {
        didMigrateWorkspaceModuleTypesRef.current = false;
        return;
      }
      if (didMigrateWorkspaceModuleTypesRef.current) return;
      if (!Array.isArray(predefinedModules) || predefinedModules.length === 0) return;

      const workspaceFileSet = new Set((workspaceModuleFiles || []).filter(Boolean));
      if (workspaceFileSet.size === 0) return;

      const displayNameToId = new Map<string, string>();
      const dupes = new Set<string>();
      predefinedModules.forEach((m) => {
        const displayName = m?.name ? String(m.name) : "";
        const id = m?.id ? String(m.id) : "";
        if (!displayName || !id) return;
        if (displayNameToId.has(displayName)) {
          dupes.add(displayName);
          return;
        }
        displayNameToId.set(displayName, id);
      });
      dupes.forEach((d) => displayNameToId.delete(d));

      if (displayNameToId.size === 0) {
        didMigrateWorkspaceModuleTypesRef.current = true;
        return;
      }

      let needsChange = false;
      const setsUnknown = isRecord(userData) ? userData.sets : null;
      if (Array.isArray(setsUnknown)) {
        for (const set of setsUnknown) {
          const tracksUnknown = isRecord(set) ? set.tracks : null;
          if (!Array.isArray(tracksUnknown)) continue;
          for (const track of tracksUnknown) {
            const modsUnknown = isRecord(track) ? track.modules : null;
            if (!Array.isArray(modsUnknown)) continue;
            for (const inst of modsUnknown) {
              const t = isRecord(inst) ? inst.type : null;
              if (!t || typeof t !== "string") continue;
              if (workspaceFileSet.has(t)) continue;
              const mapped = displayNameToId.get(t);
              if (mapped && workspaceFileSet.has(mapped)) {
                needsChange = true;
                break;
              }
            }
            if (needsChange) break;
          }
          if (needsChange) break;
        }
      }
      if (!needsChange) {
        didMigrateWorkspaceModuleTypesRef.current = true;
        return;
      }

      updateUserData(setUserData, (draft) => {
        if (!isRecord(draft)) return;
        const sets = draft.sets;
        if (!Array.isArray(sets)) return;
        sets.forEach((set) => {
          if (!isRecord(set)) return;
          const tracks = set.tracks;
          if (!Array.isArray(tracks)) return;
          tracks.forEach((track) => {
            if (!isRecord(track)) return;
            const modules = track.modules;
            if (!Array.isArray(modules)) return;
            modules.forEach((inst) => {
              if (!isRecord(inst)) return;
              const t = inst.type;
              if (!t || typeof t !== "string") return;
              if (workspaceFileSet.has(t)) return;
              const mapped = displayNameToId.get(t);
              if (mapped && workspaceFileSet.has(mapped)) {
                (inst as JsonRecord)["type"] = mapped;
              }
            });
          });
        });
      });

      didMigrateWorkspaceModuleTypesRef.current = true;
    } catch (e) {
      didMigrateWorkspaceModuleTypesRef.current = true;
      console.warn("[Dashboard] Workspace module type migration skipped:", e);
    }
  }, [
    workspacePath,
    predefinedModules,
    workspaceModuleFiles,
    userData,
    setUserData,
    didMigrateWorkspaceModuleTypesRef,
  ]);

  useIPCListener(
    "workspace:modulesChanged",
    () => {
      if (workspacePath) {
        loadModules();
        return;
      }
      loadModules();
    },
    [loadModules]
  );

  useEffect(() => {
    try {
      if (module && (module as any).hot) {
        try {
          (module as any).hot.accept("../../../projector/helpers/moduleBase", () => {
            loadModules();
          });
        } catch {}
        try {
          (module as any).hot.accept("../../../projector/helpers/threeBase.js", () => {
            loadModules();
          });
        } catch {}
      }
    } catch {}
  }, [loadModules]);

  return { loadModules };
};

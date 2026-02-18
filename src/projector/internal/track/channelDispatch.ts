import { get } from "lodash";
import logger from "../../helpers/logger";

type ChannelTarget = {
  instanceId: string;
  moduleType: string;
  inputSource?: string;
  inputMappings?: Record<string, string | number>;
};

type ActiveTrackLike = {
  name?: string;
  modulesData?: unknown;
  modules?: unknown;
};

type ChannelDispatchContext = {
  activeTrack: ActiveTrackLike | null;
  isLoadingTrack: boolean;

  debugOverlayActive: boolean;
  logToMain: (message: unknown) => unknown;

  activeChannelHandlers: Record<string, ChannelTarget[]>;
  buildChannelHandlerMap: (track: unknown) => Record<string, ChannelTarget[]>;

  trackSandboxHost:
    | null
    | {
        token?: unknown;
        setMatrixForInstance?: (args: {
          instanceId: unknown;
          track: unknown;
          moduleSources: unknown;
          assetsBaseUrl: unknown;
          matrixOptions: unknown;
        }) => Promise<unknown>;
      };
  runtimeMatrixOverrides: Map<unknown, unknown>;
  getAssetsBaseUrlForSandboxToken: (token: unknown) => string | null;
  trackModuleSources: unknown;

  activeModules: Record<string, unknown[]>;
  executeMethods: (
    methods: unknown,
    instanceId: unknown,
    moduleInstances: unknown,
    isConstructor?: boolean,
    debugContext?: Record<string, unknown>
  ) => Promise<unknown>;
};

export async function handleChannelMessage(
  this: ChannelDispatchContext,
  channelPath: string,
  debugContext: Record<string, unknown> = {}
) {
  if (!this.activeTrack) return;

  if (this.isLoadingTrack) {
    if (logger.debugEnabled) {
      logger.warn(`Ignoring channel trigger during track initialization`);
    }
    return;
  }

  const track = this.activeTrack;
  const channelMatch = channelPath.match(/^\/Ableton\/(\d+)$/);

  if (channelMatch && channelMatch[1]) {
    const channelNumber = channelMatch[1];
    if (logger.debugEnabled) {
      logger.log(`Received message for channel: ${channelNumber}`);
    }
    const modulesData = (track as { modulesData?: unknown }).modulesData;
    if (!this.activeChannelHandlers[channelNumber]) {
      this.activeChannelHandlers = this.buildChannelHandlerMap(track);
    }
    const channelTargets = this.activeChannelHandlers[channelNumber] || [];
    if (channelTargets.length === 0) {
      if (logger.debugEnabled) {
        logger.warn(`No modules mapped to channel ${channelNumber}`);
      }
      return;
    }

    const matrixOverridesForChannel = new Map<string, unknown>();
    const nonMatrixByInstance = new Map<string, { moduleType: string; methods: unknown }>();

    const eventSource = typeof debugContext.source === "string" ? debugContext.source : null;

    for (const { instanceId, moduleType, inputSource, inputMappings } of channelTargets) {
      if (this.debugOverlayActive && logger.debugEnabled) {
        this.logToMain(`instanceId: ${instanceId}, moduleType: ${moduleType}`);
      }

      // Per-module source filtering: skip if event source doesn't match module's input source
      if (inputSource && eventSource && eventSource !== inputSource) {
        if (logger.debugEnabled) {
          logger.log(`Skipping module ${instanceId}: source ${eventSource} !== ${inputSource}`);
        }
        continue;
      }

      // Per-module custom mapping check: if module has inputMappings, only respond to mapped triggers
      if (inputMappings) {
        const mappingValue = inputMappings[channelNumber];
        if (mappingValue === undefined) {
          if (logger.debugEnabled) {
            logger.log(`Skipping module ${instanceId}: no inputMapping for channel ${channelNumber}`);
          }
          continue;
        }
      }

      const moduleData = get(modulesData as never, instanceId as never) as unknown;
      if (!moduleData) continue;

      const methods = get(
        (moduleData as { methods?: unknown } | null)?.methods as never,
        channelNumber as never
      ) as unknown;
      if (!Array.isArray(methods) || methods.length === 0) continue;

      const matrixMethod =
        (methods as unknown[]).find(
          (m) => (m as { name?: unknown } | null)?.name === "matrix"
        ) || null;
      if (matrixMethod) {
        matrixOverridesForChannel.set(
          instanceId,
          (matrixMethod as { options?: unknown } | null)?.options
        );
      }
      const nonMatrix = (methods as unknown[]).filter(
        (m) => (m as { name?: unknown } | null)?.name && (m as { name?: unknown }).name !== "matrix"
      );
      if (nonMatrix.length) {
        nonMatrixByInstance.set(instanceId, {
          moduleType,
          methods: nonMatrix,
        });
      }
    }

    if (matrixOverridesForChannel.size > 0 && this.trackSandboxHost) {
      try {
        for (const [id, opts] of matrixOverridesForChannel.entries()) {
          this.runtimeMatrixOverrides.set(id, opts);
        }
      } catch {}

      const assetsBaseUrl = this.getAssetsBaseUrlForSandboxToken(
        (this.trackSandboxHost as { token?: unknown } | null)?.token
      );
      const moduleSources = this.trackModuleSources || {};
      if (assetsBaseUrl) {
        await Promise.all(
          Array.from(matrixOverridesForChannel.entries()).map(
            async ([instanceId, matrixOptions]) => {
              const res = await this.trackSandboxHost?.setMatrixForInstance?.({
                instanceId,
                track: this.activeTrack,
                moduleSources,
                assetsBaseUrl,
                matrixOptions,
              });
              if (
                !res ||
                typeof res !== "object" ||
                (res as { ok?: unknown }).ok !== true
              ) {
                throw new Error(
                  String(
                    (res as { error?: unknown } | null)?.error ||
                      "SANDBOX_SET_MATRIX_FAILED"
                  )
                );
              }
            }
          )
        );
      }
    }

    await Promise.all(
      Array.from(nonMatrixByInstance.entries()).map(async ([instanceId, entry]) => {
        const moduleInstances = this.activeModules[instanceId] || [];
        await this.executeMethods(entry.methods, instanceId, moduleInstances, false, {
          ...debugContext,
          moduleInfo: { instanceId, type: entry.moduleType },
          trackName: this.activeTrack?.name,
        });
      })
    );
  } else {
    if (logger.debugEnabled) {
      logger.warn(`Invalid channel path received: ${channelPath}`);
    }
  }
}

export function buildChannelHandlerMap(
  track: unknown
): Record<string, ChannelTarget[]> {
  const t = track as { modules?: unknown; modulesData?: unknown } | null;
  if (!t || !Array.isArray(t.modules)) {
    return {};
  }
  const map: Record<string, ChannelTarget[]> = {};
  (t.modules as unknown[]).forEach((m) => {
    const mm = m as { id?: unknown; type?: unknown; disabled?: unknown; inputSource?: unknown; inputMappings?: unknown } | null;
    if (mm?.disabled === true) return;
    const instanceId = String(mm?.id || "");
    const type = String(mm?.type || "");
    const rawInputSource = typeof mm?.inputSource === "string" ? mm.inputSource : undefined;
    const rawInputMappings = mm?.inputMappings && typeof mm.inputMappings === "object" && !Array.isArray(mm.inputMappings)
      ? (mm.inputMappings as Record<string, unknown>)
      : undefined;
    const inputMappings = rawInputMappings
      ? Object.fromEntries(
          Object.entries(rawInputMappings).filter(
            ([, v]) => typeof v === "string" || typeof v === "number"
          )
        ) as Record<string, string | number>
      : undefined;
    const methodEntries = get(t as never, ["modulesData", instanceId, "methods"] as never) as unknown;
    if (!methodEntries || typeof methodEntries !== "object") return;
    Object.entries(methodEntries as Record<string, unknown>).forEach(
      ([channelNumber, methods]) => {
        if (!Array.isArray(methods) || methods.length === 0) return;
        if (!map[channelNumber]) {
          map[channelNumber] = [];
        }
        map[channelNumber].push({
          instanceId,
          moduleType: type,
          inputSource: rawInputSource,
          inputMappings,
        });
      }
    );
  });
  return map;
}


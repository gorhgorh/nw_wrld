import { forEach } from "lodash";
import { buildMethodOptions } from "../../../shared/utils/methodOptions.ts";
import logger from "../../helpers/logger";

export async function executeMethods(
  methods,
  instanceId,
  moduleInstances,
  isConstructor = false,
  debugContext = {}
) {
  const debugEnabled = logger.debugEnabled;
  const overlayDebug = debugEnabled && this.debugOverlayActive;

  if (debugEnabled) logger.log(`⏱️ executeMethods start: ${instanceId}`);

  if (overlayDebug) {
    this.logToMain(`${performance.now()}`);
    this.logToMain(`executeMethods: ${instanceId}`);
  }

  let needsMatrixUpdate = false;
  let matrixOptions = null;
  let otherMethods = [];
  forEach(methods, (method) => {
    if (method.name === "matrix") {
      needsMatrixUpdate = true;
      matrixOptions = method.options;
    } else {
      otherMethods.push(method);
    }
  });

  if (needsMatrixUpdate && this.trackSandboxHost && this.activeTrack) {
    const assetsBaseUrl = this.getAssetsBaseUrlForSandboxToken(
      this.trackSandboxHost?.token
    );
    const moduleSources = this.trackModuleSources || {};
    if (assetsBaseUrl) {
      const res = await this.trackSandboxHost.setMatrixForInstance({
        instanceId,
        track: this.activeTrack,
        moduleSources,
        assetsBaseUrl,
        matrixOptions,
      });
      if (!res || res.ok !== true) {
        throw new Error(res?.error || "SANDBOX_SET_MATRIX_FAILED");
      }
    }
  }

  if (debugEnabled) logger.log(`⏱️ Other methods execution start: ${instanceId}`);
  await Promise.all(
    otherMethods.map(async ({ name: methodName, options: methodOptions }) => {
      const options = buildMethodOptions(methodOptions, {
        onInvalidRandomRange: ({ name, min, max, value }) => {
          if (debugEnabled) {
            console.warn(
              `[Projector] Invalid randomRange for "${name}": [${min}, ${max}] - expected numbers. Using value: ${value}`
            );
          }
        },
        onSwapRandomRange: ({ name, min, max }) => {
          if (debugEnabled) {
            console.warn(
              `[Projector] Invalid randomRange for "${name}": min (${min}) > max (${max}). Swapping values.`
            );
          }
        },
        noRepeatCache: this.methodOptionNoRepeatCache,
        noRepeatKeyPrefix: `${instanceId}:${methodName}`,
      });

      if (overlayDebug) {
        const timestamp = (
          debugContext.timestamp || performance.now() / 1000
        ).toFixed(5);
        let log = `[${timestamp}] Method Execution\n`;
        if (debugContext.trackName) {
          log += `  Track: ${debugContext.trackName}\n`;
        }
        if (debugContext.moduleInfo) {
          log += `  Module: ${debugContext.moduleInfo.instanceId} (${debugContext.moduleInfo.type})\n`;
        }
        log += `  Method: ${methodName}\n`;
        if (options && Object.keys(options).length > 0) {
          log += `  Props: ${JSON.stringify(options, null, 2)}\n`;
        }
        this.queueDebugLog(log);
      }

      if (debugEnabled) {
        logger.log(`⏱️ Method start: ${methodName} for ${instanceId}`);
      }
      if (overlayDebug) {
        this.logToMain(`${JSON.stringify(options)} [${performance.now()}]`);
      }

      const host = this.trackSandboxHost;
      if (!host) return;
      const res = await host.invokeOnInstance(instanceId, methodName, options);
      if (!res || res.ok !== true) {
        throw new Error(res?.error || "SANDBOX_INVOKE_FAILED");
      }

      if (isConstructor) {
        if (debugEnabled) {
          logger.log(
            `Executed constructor method "${methodName}" on module "${instanceId}".`
          );
        }
      } else {
        if (debugEnabled) {
          logger.log(
            `Executed method "${methodName}" with options ${JSON.stringify(
              options
            )} on module "${instanceId}".`
          );
        }
      }
      if (debugEnabled) logger.log(`⏱️ Method end: ${methodName} for ${instanceId}`);
    })
  );
  if (debugEnabled) {
    logger.log(`⏱️ Other methods execution end: ${instanceId}`);
    logger.log(`⏱️ executeMethods end: ${instanceId}`);
  }
}


import { getBridge } from "../bridge.js";

export class TrackSandboxHost {
  constructor(modulesContainer) {
    this.modulesContainer = modulesContainer;
    this.token = null;
    this.disposed = false;
  }

  async ensureSandbox() {
    if (this.disposed) {
      return { ok: false, reason: "DISPOSED" };
    }
    const bridge = getBridge();
    const ensure = bridge?.sandbox?.ensure;
    if (typeof ensure !== "function") {
      throw new Error(`[Projector] Sandbox bridge is unavailable.`);
    }
    const res = await ensure();
    const token = String(res?.token || "").trim();
    if (!res || res.ok !== true || !token) {
      throw new Error(res?.reason || "SANDBOX_ENSURE_FAILED");
    }
    this.token = token;
    return { ok: true, token };
  }

  async request(type, props) {
    await this.ensureSandbox();
    const bridge = getBridge();
    const req = bridge?.sandbox?.request;
    if (typeof req !== "function") {
      return { ok: false, error: "SANDBOX_BRIDGE_UNAVAILABLE" };
    }
    return await req(this.token, type, props || {});
  }

  initTrack({ track, moduleSources, assetsBaseUrl }) {
    return this.request("initTrack", {
      track,
      moduleSources,
      assetsBaseUrl,
    });
  }

  setMatrixForInstance({
    instanceId,
    track,
    moduleSources,
    assetsBaseUrl,
    matrixOptions,
  }) {
    return this.request("setMatrixForInstance", {
      instanceId,
      track,
      moduleSources,
      assetsBaseUrl,
      matrixOptions,
    });
  }

  invokeOnInstance(instanceId, methodName, options) {
    return this.request("invokeOnInstance", {
      instanceId,
      methodName,
      options,
    });
  }

  introspectModule(moduleType, sourceText) {
    return this.request("introspectModule", { moduleType, sourceText });
  }

  destroyTrack() {
    return this.request("destroyTrack", {});
  }

  async destroy() {
    this.disposed = true;
    try {
      await getBridge()?.sandbox?.destroy?.();
    } catch {}
    this.token = null;
  }
}


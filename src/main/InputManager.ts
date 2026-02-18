import { WebMidi, type Input as WebMidiInput } from "webmidi";
import { UDPPort, type OscMessage, type OscError } from "osc";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import { isValidOSCChannelAddress, isValidOSCTrackAddress } from "../shared/validation/oscValidation";
import { normalizeInputEventPayload } from "../shared/validation/inputEventValidation";
import type {
  InputEventPayload,
  InputStatus,
  InputStatusPayload,
  MidiDeviceInfo,
} from "../types/input";
import type { InputConfig } from "../types/userData";

const DEFAULT_INPUT_CONFIG = {
  type: "midi",
  deviceName: "IAC Driver Bus 1",
  trackSelectionChannel: 2,
  methodTriggerChannel: 1,
  velocitySensitive: false,
  noteMatchMode: "pitchClass",
  port: 8000,
};

// Default ports per source type so secondary sources don't collide
const DEFAULT_PORT_BY_TYPE: Record<string, number> = {
  osc: 8000,
  websocket: 8080,
};

const INPUT_STATUS: {
  DISCONNECTED: InputStatus;
  CONNECTING: InputStatus;
  CONNECTED: InputStatus;
  ERROR: InputStatus;
} = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  ERROR: "error",
};

type RuntimeMidiConfig = Omit<InputConfig, "type"> & {
  type: "midi";
  deviceId?: string;
  noteMatchMode?: string;
};

type RuntimeOscConfig = Omit<InputConfig, "type"> & {
  type: "osc";
  noteMatchMode?: string;
};

type RuntimeAudioConfig = Omit<InputConfig, "type"> & {
  type: "audio";
  noteMatchMode?: string;
};

type RuntimeFileConfig = Omit<InputConfig, "type"> & {
  type: "file";
  noteMatchMode?: string;
};

type RuntimeWebSocketConfig = Omit<InputConfig, "type"> & {
  type: "websocket";
  noteMatchMode?: string;
};

type RuntimeInputConfig =
  | RuntimeMidiConfig
  | RuntimeOscConfig
  | RuntimeAudioConfig
  | RuntimeFileConfig
  | RuntimeWebSocketConfig;

type WindowWebContents = {
  isDestroyed(): boolean;
  send(channel: "input-event", payload: InputEventPayload): void;
  send(channel: "input-status", payload: InputStatusPayload): void;
  send(channel: string, payload: object): void;
};

type WindowLike = {
  isDestroyed(): boolean;
  webContents?: WindowWebContents | null;
};

type ActiveSource =
  | { type: "midi"; instance: WebMidiInput }
  | { type: "osc"; instance: UDPPort }
  | { type: "audio"; instance: { close?: () => unknown } }
  | { type: "file"; instance: { close?: () => unknown } }
  | { type: "websocket"; instance: WebSocketServer };

type WebMidiProvider = typeof WebMidi;

const getWebMidiProvider = () => {
  const g = globalThis as unknown as { __nwWrldWebMidiOverride?: unknown };
  if (g.__nwWrldWebMidiOverride) return g.__nwWrldWebMidiOverride as WebMidiProvider;
  return WebMidi as unknown as WebMidiProvider;
};

const webMidiEnableInFlightByProvider: WeakMap<object, Promise<void>> = new WeakMap();

const enableWebMidi = (webMidi: WebMidiProvider): Promise<void> => {
  try {
    if (webMidi.enabled) return Promise.resolve();
  } catch {}

  const key = webMidi as unknown as object;
  const inFlight = webMidiEnableInFlightByProvider.get(key);
  if (inFlight) return inFlight;

  const promise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const envTimeoutRaw = process.env.NW_WRLD_WEBMIDI_ENABLE_TIMEOUT_MS;
    const envTimeoutParsed = typeof envTimeoutRaw === "string" ? parseInt(envTimeoutRaw, 10) : NaN;
    const ENABLE_TIMEOUT_MS = Number.isFinite(envTimeoutParsed) && envTimeoutParsed > 0 ? envTimeoutParsed : 8000;

    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      webMidiEnableInFlightByProvider.delete(key);
      reject(new Error("WebMIDI enable timed out"));
    }, ENABLE_TIMEOUT_MS);

    const callback = (err: Error | null | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      webMidiEnableInFlightByProvider.delete(key);
      if (err) return reject(err);
      resolve();
    };
    try {
      webMidi.enable({ callback });
    } catch (e) {
      if (!settled) {
        settled = true;
        clearTimeout(t);
      }
      webMidiEnableInFlightByProvider.delete(key);
      reject(e);
    }
  });

  webMidiEnableInFlightByProvider.set(key, promise);
  return promise;
};

const RECONCILABLE_SOURCES = new Set(["midi", "osc", "websocket"]);

class InputManager {
  dashboard: WindowLike | null;
  projector: WindowLike | null;
  activeSources: Map<string, ActiveSource>;
  config: RuntimeInputConfig | null;
  connectionStatus: InputStatus;
  defaultSourceType: string;
  private midiWebMidi: WebMidiProvider | null;
  private midiConnectedHandler: ((e: unknown) => void) | null;
  private midiDisconnectedHandler: ((e: unknown) => void) | null;
  private midiTargetDeviceId: string;
  private midiTargetDeviceName: string;
  private ensureInFlight: Map<string, Promise<void>>;
  private moduleNeededSources: Set<string>;

  constructor(dashboardWindow: WindowLike, projectorWindow: WindowLike) {
    this.dashboard = dashboardWindow;
    this.projector = projectorWindow;
    this.activeSources = new Map();
    this.config = null;
    this.connectionStatus = INPUT_STATUS.DISCONNECTED;
    this.defaultSourceType = "midi";
    this.midiWebMidi = null;
    this.midiConnectedHandler = null;
    this.midiDisconnectedHandler = null;
    this.midiTargetDeviceId = "";
    this.midiTargetDeviceName = "";
    this.ensureInFlight = new Map();
    this.moduleNeededSources = new Set();
  }

  // Backward-compat: expose currentSource as the default source entry
  get currentSource(): ActiveSource | null {
    return this.activeSources.get(this.defaultSourceType) || null;
  }

  private teardownMidiWebMidiListeners() {
    const webMidi = this.midiWebMidi;
    if (!webMidi) return;
    try {
      if (this.midiConnectedHandler && typeof webMidi.removeListener === "function") {
        webMidi.removeListener("connected", this.midiConnectedHandler);
      }
    } catch {}
    try {
      if (this.midiDisconnectedHandler && typeof webMidi.removeListener === "function") {
        webMidi.removeListener("disconnected", this.midiDisconnectedHandler);
      }
    } catch {}
    this.midiWebMidi = null;
    this.midiConnectedHandler = null;
    this.midiDisconnectedHandler = null;
    this.midiTargetDeviceId = "";
    this.midiTargetDeviceName = "";
  }

  private installMidiWebMidiListeners(webMidi: WebMidiProvider, deviceId: string, deviceName: string) {
    this.teardownMidiWebMidiListeners();
    this.midiWebMidi = webMidi;
    this.midiTargetDeviceId = deviceId;
    this.midiTargetDeviceName = deviceName;

    const matchesTarget = (evt: unknown) => {
      const e = evt && typeof evt === "object" ? (evt as Record<string, unknown>) : null;
      const port = e && typeof e.port === "object" && e.port ? (e.port as Record<string, unknown>) : null;
      const id = port && typeof port.id === "string" ? port.id : "";
      const name = port && typeof port.name === "string" ? port.name : "";
      if (deviceId && id && id === deviceId) return true;
      if (deviceName && name && name === deviceName) return true;
      return false;
    };

    this.midiDisconnectedHandler = (evt: unknown) => {
      if (!matchesTarget(evt)) return;
      const midiSource = this.activeSources.get("midi");
      if (!midiSource || midiSource.type !== "midi") return;
      try {
        midiSource.instance.removeListener();
      } catch {
        try {
          midiSource.instance.removeListener("noteon");
        } catch {}
      }
      this.activeSources.delete("midi");
      this.broadcastStatus(INPUT_STATUS.DISCONNECTED, `MIDI device disconnected: ${deviceName}`);
    };

    this.midiConnectedHandler = (evt: unknown) => {
      if (!matchesTarget(evt)) return;
      if (this.connectionStatus === INPUT_STATUS.CONNECTING) return;
      if (this.activeSources.has("midi")) return;
      this.ensureSource("midi").catch(() => {});
    };

    try {
      if (typeof webMidi.addListener === "function") {
        webMidi.addListener("disconnected", this.midiDisconnectedHandler);
        webMidi.addListener("connected", this.midiConnectedHandler);
      }
    } catch {}
  }

  broadcast(eventType: InputEventPayload["type"], data: object) {
    const payload = {
      type: eventType,
      data: {
        ...(data as object),
        timestamp: Date.now() / 1000,
      },
    };

    const normalized = normalizeInputEventPayload(payload);
    if (!normalized) {
      return;
    }

    if (
      this.dashboard &&
      !this.dashboard.isDestroyed() &&
      this.dashboard.webContents &&
      !this.dashboard.webContents.isDestroyed()
    ) {
      this.dashboard.webContents.send("input-event", normalized);
    }
    if (
      this.projector &&
      !this.projector.isDestroyed() &&
      this.projector.webContents &&
      !this.projector.webContents.isDestroyed()
    ) {
      this.projector.webContents.send("input-event", normalized);
    }
  }

  broadcastStatus(status: InputStatus, message = "") {
    this.connectionStatus = status;
    const activeTypes = Array.from(this.activeSources.keys());
    const statusPayload: InputStatusPayload = {
      type: "input-status",
      data: {
        status,
        message: message || (activeTypes.length > 0 ? `Active: ${activeTypes.join(", ")}` : ""),
        config: this.config,
        activeSources: activeTypes,
      },
    };

    if (
      this.dashboard &&
      !this.dashboard.isDestroyed() &&
      this.dashboard.webContents &&
      !this.dashboard.webContents.isDestroyed()
    ) {
      this.dashboard.webContents.send("input-status", statusPayload);
    }
  }

  async initialize(inputConfig?: RuntimeInputConfig | null) {
    const config = (inputConfig || DEFAULT_INPUT_CONFIG) as RuntimeInputConfig;
    const prevDefault = this.defaultSourceType;

    this.config = config;
    this.defaultSourceType = config.type;

    try {
      this.broadcastStatus(
        INPUT_STATUS.CONNECTING,
        `Connecting to ${config.type}...`
      );

      // Only stop the default source so it can be (re)started with new config.
      // Secondary sources managed by reconcileSources are left untouched.
      if (this.activeSources.has(config.type)) {
        await this.stopSource(config.type);
      }
      // If the old default was a different type, stop it too
      // UNLESS a module still needs it (moduleNeededSources is populated by reconcileSources)
      if (prevDefault !== config.type && this.activeSources.has(prevDefault)) {
        if (!this.moduleNeededSources.has(prevDefault)) {
          await this.stopSource(prevDefault);
        }
      }

      const inputType =
        typeof (config as { type?: string }).type === "string"
          ? (config as { type: string }).type
          : "";

      switch (inputType) {
        case "midi":
          await this.initMIDI(config as RuntimeMidiConfig);
          break;
        case "osc":
          await this.initOSC(config as RuntimeOscConfig);
          break;
        case "audio":
          await this.initAudio(config as RuntimeAudioConfig);
          break;
        case "file":
          await this.initFile(config as RuntimeFileConfig);
          break;
        case "websocket":
          await this.initWebSocket(config as RuntimeWebSocketConfig);
          break;
        default:
          console.warn("[InputManager] Unknown input type:", inputType);
          this.broadcastStatus(
            INPUT_STATUS.ERROR,
            `Unknown input type: ${inputType}`
          );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[InputManager] Initialization failed:", error);
      this.broadcastStatus(INPUT_STATUS.ERROR, message);
      throw error;
    }
  }

  /** Idempotent: start a source if not already running. No-op if already in activeSources. */
  async ensureSource(type: string): Promise<void> {
    if (this.activeSources.has(type)) return;

    // Avoid duplicate concurrent starts
    const inFlight = this.ensureInFlight.get(type);
    if (inFlight) return inFlight;

    const config = (this.config || DEFAULT_INPUT_CONFIG) as RuntimeInputConfig;
    // Use type-specific default port so secondary sources don't collide with main
    const defaultPort = DEFAULT_PORT_BY_TYPE[type];
    const portOverride = (type !== config.type && defaultPort) ? { port: defaultPort } : {};
    const sourceConfig = { ...config, ...portOverride, type } as RuntimeInputConfig;

    const promise = (async () => {
      try {
        switch (type) {
          case "midi":
            await this.initMIDI(sourceConfig as RuntimeMidiConfig);
            break;
          case "osc":
            await this.initOSC(sourceConfig as RuntimeOscConfig);
            break;
          case "websocket":
            await this.initWebSocket(sourceConfig as RuntimeWebSocketConfig);
            break;
          case "audio":
            await this.initAudio(sourceConfig as RuntimeAudioConfig);
            break;
          case "file":
            await this.initFile(sourceConfig as RuntimeFileConfig);
            break;
          default:
            console.warn("[InputManager] ensureSource: unknown type:", type);
        }
      } catch (err) {
        console.error(`[InputManager] ensureSource(${type}) failed:`, err);
      } finally {
        this.ensureInFlight.delete(type);
      }
    })();

    this.ensureInFlight.set(type, promise);
    return promise;
  }

  /** Tear down a single source by type. */
  async stopSource(type: string): Promise<void> {
    const source = this.activeSources.get(type);
    if (!source) return;

    try {
      switch (source.type) {
        case "midi":
          this.teardownMidiWebMidiListeners();
          try {
            source.instance.removeListener();
          } catch {
            try { source.instance.removeListener("noteon"); } catch {}
          }
          break;
        case "osc":
          if (source.instance) source.instance.close();
          break;
        case "audio":
        case "file":
          if (source.instance && typeof source.instance.close === "function") {
            try { source.instance.close(); } catch {}
          }
          break;
        case "websocket":
          if (source.instance) {
            try { source.instance.close(); } catch {}
          }
          break;
      }
    } catch (err) {
      console.error(`[InputManager] stopSource(${type}) error:`, err);
    }

    this.activeSources.delete(type);
    console.log(`[InputManager] stopped source: ${type}`);
  }

  /**
   * Reconcile active sources with what modules need.
   * Starts missing sources, stops sources no module needs (except default + audio/file).
   */
  async reconcileSources(neededSources: string[]): Promise<void> {
    // Guard: don't reconcile before initialize() has been called
    if (!this.config) return;

    // Remember what modules need so initialize() won't kill these sources
    this.moduleNeededSources = new Set(neededSources.filter((s) => RECONCILABLE_SOURCES.has(s)));

    const needed = new Set<string>();
    // Always keep the default source type
    needed.add(this.defaultSourceType);
    // Also keep the configured input type (belt-and-suspenders)
    if (this.config.type) needed.add(this.config.type);
    // Add module-requested sources (only reconcilable ones)
    for (const s of neededSources) {
      if (RECONCILABLE_SOURCES.has(s)) needed.add(s);
    }

    // Start missing sources
    const startPromises: Promise<void>[] = [];
    for (const type of needed) {
      if (!this.activeSources.has(type)) {
        startPromises.push(this.ensureSource(type));
      }
    }
    if (startPromises.length > 0) {
      await Promise.allSettled(startPromises);
    }

    // Stop sources that are no longer needed (only reconcilable ones)
    for (const type of this.activeSources.keys()) {
      if (!needed.has(type) && RECONCILABLE_SOURCES.has(type)) {
        await this.stopSource(type);
      }
    }

    this.broadcastStatus(INPUT_STATUS.CONNECTED);
  }

  async initMIDI(midiConfig: RuntimeMidiConfig) {
    return new Promise<void>((resolve, reject) => {
      const setupMIDI = () => {
        try {
          const webMidi = getWebMidiProvider();
          const deviceId = midiConfig?.deviceId?.trim() || "";
          const deviceName = midiConfig?.deviceName?.trim() || "";

          this.installMidiWebMidiListeners(webMidi, deviceId, deviceName);

          let input: WebMidiInput | undefined;
          try {
            if (deviceId) {
              input = webMidi.getInputById(deviceId) as unknown as WebMidiInput | undefined;
            }
          } catch {}
          try {
            if (!input && deviceName) {
              input = webMidi.getInputByName(deviceName) as unknown as WebMidiInput | undefined;
            }
          } catch {}

          if (!input) {
            const error = new Error(
              `MIDI device "${midiConfig.deviceName}" not found`
            );
            console.error("[InputManager]", error.message);
            this.broadcastStatus(INPUT_STATUS.DISCONNECTED, "");
            return reject(error);
          }

          const resolvedId = typeof (input as unknown as { id?: unknown }).id === "string"
            ? ((input as unknown as { id: string }).id as string)
            : deviceId;
          const resolvedName = typeof (input as unknown as { name?: unknown }).name === "string"
            ? ((input as unknown as { name: string }).name as string)
            : deviceName;
          this.installMidiWebMidiListeners(webMidi, resolvedId, resolvedName);

          input.addListener("noteon", (e) => {
            const note = e.note.number;
            const channel = e.message.channel;
            const rawAttack =
              typeof e?.note?.rawAttack === "number" && Number.isFinite(e.note.rawAttack)
                ? e.note.rawAttack
                : typeof (e as unknown as { velocity?: unknown })?.velocity === "number" &&
                    Number.isFinite((e as unknown as { velocity: number }).velocity)
                  ? (e as unknown as { velocity: number }).velocity <= 1 &&
                      (e as unknown as { velocity: number }).velocity >= 0
                    ? Math.round((e as unknown as { velocity: number }).velocity * 127)
                    : (e as unknown as { velocity: number }).velocity
                  : 127;
            const velocity = midiConfig.velocitySensitive ? rawAttack : 127;

            if (channel === midiConfig.trackSelectionChannel) {
              this.broadcast("track-selection", {
                note,
                channel,
                velocity,
                source: "midi",
              });
            }
            if (channel === midiConfig.methodTriggerChannel) {
              this.broadcast("method-trigger", {
                note,
                channel,
                velocity,
                source: "midi",
              });
            }
          });

          this.activeSources.set("midi", { type: "midi", instance: input });
          this.broadcastStatus(
            INPUT_STATUS.CONNECTED,
            `MIDI: ${resolvedName || midiConfig.deviceName}`
          );
          resolve();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error("[InputManager] Error in MIDI setup:", error);
          this.broadcastStatus(INPUT_STATUS.ERROR, `MIDI error: ${message}`);
          reject(error);
        }
      };

      const webMidi = getWebMidiProvider();
      if (webMidi.enabled) {
        setupMIDI();
      } else {
        enableWebMidi(webMidi)
          .then(() => setupMIDI())
          .catch((err) => {
            const e = err instanceof Error ? err : new Error(String(err));
            console.error("[InputManager] MIDI enable failed:", e);
            this.broadcastStatus(INPUT_STATUS.ERROR, `Failed to enable MIDI: ${e.message}`);
            return reject(e);
          });
      }
    });
  }

  async initOSC(oscConfig: RuntimeOscConfig) {
    const port = oscConfig.port || 8000;

    try {
      const udpPort = new UDPPort({
        localAddress: "0.0.0.0",
        localPort: port,
        metadata: true,
      });

      udpPort.on("ready", () => {
        this.broadcastStatus(INPUT_STATUS.CONNECTED, `OSC: Port ${port}`);
      });

      udpPort.on("message", (oscMsg: OscMessage) => {
        const rawAddress = oscMsg.address;
        const address = rawAddress.replace(/\s+/g, "");
        const args = oscMsg.args || [];
        const value = args[0] ? args[0].value : undefined;

        if (value !== undefined && typeof value === "number" && value === 0) {
          return;
        }

        if (isValidOSCTrackAddress(address)) {
          this.broadcast("track-selection", {
            identifier: address,
            source: "osc",
            address,
          });
          return;
        }

        if (isValidOSCChannelAddress(address)) {
          const velocity = typeof value === "number" ? value : 127;
          this.broadcast("method-trigger", {
            channelName: address,
            velocity,
            source: "osc",
            address,
          });
          return;
        }

        console.warn(
          `[InputManager] ⚠️ OSC message ignored (invalid prefix): "${address}"\n` +
            `  Expected format:\n` +
            `    /track/name → Select track\n` +
            `    /ch/name or /channel/name → Trigger channel\n` +
            `  Example: Set GrabberSender name to "track/intro" or "ch/bass"`
        );
      });

      udpPort.on("error", (err: OscError) => {
        console.error("[InputManager] ❌ OSC error:", err);
        console.error("[InputManager] Error details:", {
          code: err.code,
          message: err.message,
          port: port,
        });
        this.broadcastStatus(INPUT_STATUS.ERROR, `OSC error: ${err.message}`);
      });

      console.log(`[InputManager] 🔌 Opening UDP port ${port}...`);
      udpPort.open();
      this.activeSources.set("osc", { type: "osc", instance: udpPort });
      console.log(`[InputManager] ✅ UDP port opened successfully`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[InputManager] ❌ Failed to initialize OSC:`, err);
      this.broadcastStatus(
        INPUT_STATUS.ERROR,
        `Failed to start OSC: ${message}`
      );
    }
  }

  async initAudio(_audioConfig: RuntimeAudioConfig) {
    this.activeSources.set("audio", { type: "audio", instance: {} });
    this.broadcastStatus(INPUT_STATUS.CONNECTED, "Audio (listening)");
  }

  async initFile(_fileConfig: RuntimeFileConfig) {
    this.activeSources.set("file", { type: "file", instance: {} });
    this.broadcastStatus(INPUT_STATUS.CONNECTED, "File (ready)");
  }

  async initWebSocket(wsConfig: RuntimeWebSocketConfig) {
    const port = wsConfig.port || 8080;

    try {
      const wss = new WebSocketServer({ port });

      wss.on("listening", () => {
        this.broadcastStatus(INPUT_STATUS.CONNECTED, `WebSocket: Port ${port}`);
      });

      wss.on("connection", (ws: WsWebSocket) => {
        console.log("[InputManager] [WS] client connected");
        ws.on("close", () => console.log("[InputManager] [WS] client disconnected"));
        ws.on("message", (raw: Buffer | string) => {
          const text = typeof raw === "string" ? raw : raw.toString("utf-8");
          console.log("[InputManager] [WS] raw message:", text);
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(text);
          } catch {
            console.warn("[InputManager] [WS] invalid JSON, ignoring");
            return;
          }
          if (!msg || typeof msg !== "object") {
            console.warn("[InputManager] [WS] not an object, ignoring");
            return;
          }

          const msgType = typeof msg.type === "string" ? msg.type : "";
          const address = typeof msg.address === "string" ? msg.address.replace(/\s+/g, "") : "";
          if (!address) {
            console.warn("[InputManager] [WS] no address field, ignoring");
            return;
          }

          console.log("[InputManager] [WS] parsed — type:", msgType || "(none)", "address:", address);

          if (msgType === "track" || isValidOSCTrackAddress(address)) {
            console.log("[InputManager] [WS] -> track-selection, identifier:", address);
            this.broadcast("track-selection", {
              identifier: address,
              source: "websocket",
              address,
            });
            return;
          }

          if (msgType === "channel" || isValidOSCChannelAddress(address)) {
            const velocity = typeof msg.velocity === "number" && Number.isFinite(msg.velocity)
              ? msg.velocity
              : 127;
            console.log("[InputManager] [WS] -> method-trigger, channelName:", address, "velocity:", velocity);
            this.broadcast("method-trigger", {
              channelName: address,
              velocity,
              source: "websocket",
              address,
            });
            return;
          }

          console.warn("[InputManager] [WS] address not recognized as track or channel:", address);
        });
      });

      wss.on("error", (err: Error) => {
        console.error("[InputManager] WebSocket error:", err);
        this.broadcastStatus(INPUT_STATUS.ERROR, `WebSocket error: ${err.message}`);
      });

      this.activeSources.set("websocket", { type: "websocket", instance: wss });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[InputManager] Failed to initialize WebSocket:", err);
      this.broadcastStatus(
        INPUT_STATUS.ERROR,
        `Failed to start WebSocket: ${message}`
      );
    }
  }

  async disconnect() {
    try {
      const types = Array.from(this.activeSources.keys());
      for (const type of types) {
        await this.stopSource(type);
      }
      this.broadcastStatus(INPUT_STATUS.DISCONNECTED, "");
    } catch (error) {
      console.error("[InputManager] Error during disconnect:", error);
    }
  }

  static getAvailableMIDIDevices() {
    return new Promise<MidiDeviceInfo[]>((resolve) => {
      const webMidi = getWebMidiProvider();
      const resolveDevices = () => {
        try {
          const devices = webMidi.inputs.map((input) => ({
            id: input.id,
            name: input.name,
            manufacturer: input.manufacturer,
          }));
          resolve(devices);
        } catch (e) {
          console.error("[InputManager] Failed to read WebMIDI inputs:", e);
          resolve([]);
        }
      };

      if (webMidi.enabled) {
        resolveDevices();
        return;
      }

      enableWebMidi(webMidi)
        .then(() => resolveDevices())
        .catch((err) => {
          console.error("[InputManager] Failed to enable WebMIDI:", err);
          resolve([]);
        });
    });
  }
}

export default InputManager;

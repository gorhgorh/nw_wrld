import { WebMidi, type MidiInput, type NoteOnEvent } from "webmidi";
import { UDPPort, type OscMessage, type OscError } from "osc";
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

type RuntimeInputConfig = RuntimeMidiConfig | RuntimeOscConfig;

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

type CurrentSource =
  | { type: "midi"; instance: MidiInput }
  | { type: "osc"; instance: UDPPort }
  | null;

class InputManager {
  dashboard: WindowLike | null;
  projector: WindowLike | null;
  currentSource: CurrentSource;
  config: RuntimeInputConfig | null;
  connectionStatus: InputStatus;

  constructor(dashboardWindow: WindowLike, projectorWindow: WindowLike) {
    this.dashboard = dashboardWindow;
    this.projector = projectorWindow;
    this.currentSource = null;
    this.config = null;
    this.connectionStatus = INPUT_STATUS.DISCONNECTED;
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
      console.warn("[InputManager] Invalid input-event payload:", payload);
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
    const statusPayload: InputStatusPayload = {
      type: "input-status",
      data: {
        status,
        message,
        config: this.config,
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
    if (this.currentSource) {
      await this.disconnect();
    }

    const config = (inputConfig || DEFAULT_INPUT_CONFIG) as RuntimeInputConfig;

    this.config = config;

    try {
      this.broadcastStatus(
        INPUT_STATUS.CONNECTING,
        `Connecting to ${config.type}...`
      );

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

  async initMIDI(midiConfig: RuntimeMidiConfig) {
    return new Promise<void>((resolve, reject) => {
      const setupMIDI = () => {
        try {
          const deviceId =
            typeof midiConfig.deviceId === "string" &&
            midiConfig.deviceId.trim()
              ? midiConfig.deviceId.trim()
              : null;
          const deviceName =
            typeof midiConfig.deviceName === "string" &&
            midiConfig.deviceName.trim()
              ? midiConfig.deviceName.trim()
              : "";

          const input =
            (deviceId && typeof WebMidi.getInputById === "function"
              ? WebMidi.getInputById(deviceId)
              : null) || WebMidi.getInputByName(deviceName);
          if (!input) {
            const error = new Error(
              `MIDI device "${midiConfig.deviceName}" not found`
            );
            console.error("[InputManager]", error.message);
            this.currentSource = null;
            this.broadcastStatus(INPUT_STATUS.DISCONNECTED, "");
            return reject(error);
          }

          input.addListener("noteon", (e: NoteOnEvent) => {
            const note = e.note.number;
            const channel = e.message.channel;
            const velocity = midiConfig.velocitySensitive ? e.velocity : 127;

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

          this.currentSource = { type: "midi", instance: input };
          this.broadcastStatus(
            INPUT_STATUS.CONNECTED,
            `MIDI: ${midiConfig.deviceName}`
          );
          resolve();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error("[InputManager] Error in MIDI setup:", error);
          this.currentSource = null;
          this.broadcastStatus(INPUT_STATUS.ERROR, `MIDI error: ${message}`);
          reject(error);
        }
      };

      if (WebMidi.enabled) {
        setupMIDI();
      } else {
        WebMidi.enable((err) => {
          if (err) {
            console.error("[InputManager] MIDI enable failed:", err);
            this.currentSource = null;
            this.broadcastStatus(
              INPUT_STATUS.ERROR,
              `Failed to enable MIDI: ${err.message}`
            );
            return reject(err);
          }
          setupMIDI();
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
      this.currentSource = { type: "osc", instance: udpPort };
      console.log(`[InputManager] ✅ UDP port opened successfully`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[InputManager] ❌ Failed to initialize OSC:`, err);
      this.currentSource = null;
      this.broadcastStatus(
        INPUT_STATUS.ERROR,
        `Failed to start OSC: ${message}`
      );
    }
  }

  async disconnect() {
    try {
      if (this.currentSource) {
        switch (this.currentSource.type) {
          case "midi":
            if (this.currentSource.instance) {
              try {
                this.currentSource.instance.removeListener();
              } catch {
                this.currentSource.instance.removeListener("noteon");
              }
            }
            if (WebMidi.enabled && typeof WebMidi.disable === "function") {
              try {
                await WebMidi.disable();
              } catch {
                try {
                  WebMidi.disable();
                } catch {}
              }
            }
            break;
          case "osc":
            if (this.currentSource.instance) {
              this.currentSource.instance.close();
            }
            break;
        }
      }

      this.broadcastStatus(INPUT_STATUS.DISCONNECTED, "");
    } catch (error) {
      console.error("[InputManager] Error during disconnect:", error);
    }

    this.currentSource = null;
  }

  static getAvailableMIDIDevices() {
    return new Promise<MidiDeviceInfo[]>((resolve) => {
      WebMidi.enable((err) => {
        if (err) {
          console.error("[InputManager] Failed to enable WebMIDI:", err);
          return resolve([]);
        }
        const devices = WebMidi.inputs.map((input) => ({
          id: input.id,
          name: input.name,
          manufacturer: input.manufacturer,
        }));
        resolve(devices);
      });
    });
  }
}

export default InputManager;

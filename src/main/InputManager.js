const { WebMidi } = require("webmidi");
const osc = require("osc");
const { DEFAULT_INPUT_CONFIG } = require("../shared/config/defaultConfig");
const INPUT_STATUS = require("../shared/constants/inputStatus");
const {
  isValidOSCTrackAddress,
  isValidOSCChannelAddress,
} = require("../shared/validation/oscValidation");

class InputManager {
  constructor(dashboardWindow, projectorWindow) {
    this.dashboard = dashboardWindow;
    this.projector = projectorWindow;
    this.currentSource = null;
    this.config = null;
    this.connectionStatus = INPUT_STATUS.DISCONNECTED;
  }

  broadcast(eventType, data) {
    const payload = {
      type: eventType,
      data: {
        ...data,
        timestamp: Date.now() / 1000,
      },
    };

    if (
      this.dashboard &&
      !this.dashboard.isDestroyed() &&
      this.dashboard.webContents &&
      !this.dashboard.webContents.isDestroyed()
    ) {
      this.dashboard.webContents.send("input-event", payload);
    }
    if (
      this.projector &&
      !this.projector.isDestroyed() &&
      this.projector.webContents &&
      !this.projector.webContents.isDestroyed()
    ) {
      this.projector.webContents.send("input-event", payload);
    }
  }

  broadcastStatus(status, message = "") {
    this.connectionStatus = status;
    const statusPayload = {
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

  async initialize(inputConfig) {
    if (this.currentSource) {
      await this.disconnect();
    }

    const config = inputConfig || DEFAULT_INPUT_CONFIG;

    this.config = config;

    try {
      this.broadcastStatus(
        INPUT_STATUS.CONNECTING,
        `Connecting to ${config.type}...`
      );

      switch (config.type) {
        case "midi":
          await this.initMIDI(config);
          break;
        case "osc":
          await this.initOSC(config);
          break;
        default:
          console.warn("[InputManager] Unknown input type:", config.type);
          this.broadcastStatus(
            INPUT_STATUS.ERROR,
            `Unknown input type: ${config.type}`
          );
      }
    } catch (error) {
      console.error("[InputManager] Initialization failed:", error);
      this.broadcastStatus(INPUT_STATUS.ERROR, error.message);
      throw error;
    }
  }

  async initMIDI(midiConfig) {
    return new Promise((resolve, reject) => {
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

          input.addListener("noteon", (e) => {
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
          console.error("[InputManager] Error in MIDI setup:", error);
          this.currentSource = null;
          this.broadcastStatus(
            INPUT_STATUS.ERROR,
            `MIDI error: ${error.message}`
          );
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

  async initOSC(oscConfig) {
    const port = oscConfig.port || 8000;

    try {
      const udpPort = new osc.UDPPort({
        localAddress: "0.0.0.0",
        localPort: port,
        metadata: true,
      });

      udpPort.on("ready", () => {
        this.broadcastStatus(INPUT_STATUS.CONNECTED, `OSC: Port ${port}`);
      });

      udpPort.on("message", (oscMsg) => {
        const rawAddress = oscMsg.address;
        const address = rawAddress.replace(/\s+/g, "");
        const args = oscMsg.args || [];
        const value = args[0]?.value;

        // Filter out note-off messages (value = 0)
        if (value !== undefined && typeof value === "number" && value === 0) {
          return;
        }

        // OSC Naming Convention (Industry Standard)
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

      udpPort.on("error", (err) => {
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
      console.error(`[InputManager] ❌ Failed to initialize OSC:`, err);
      this.currentSource = null;
      this.broadcastStatus(
        INPUT_STATUS.ERROR,
        `Failed to start OSC: ${err.message}`
      );
    }
  }

  async disconnect() {
    if (!this.currentSource) return;

    try {
      switch (this.currentSource.type) {
        case "midi":
          if (this.currentSource.instance) {
            this.currentSource.instance.removeListener("noteon");
          }
          break;
        case "osc":
          this.currentSource.instance.close();
          break;
      }

      this.broadcastStatus(INPUT_STATUS.DISCONNECTED, "");
    } catch (error) {
      console.error("[InputManager] Error during disconnect:", error);
    }

    this.currentSource = null;
  }

  static getAvailableMIDIDevices() {
    return new Promise((resolve) => {
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

module.exports = InputManager;

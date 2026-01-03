// Projector.js
import {
  reduce,
  find,
  forEach,
  get,
  isEmpty,
  isFunction,
  fromPairs,
  map,
  throttle,
  random,
} from "lodash";
import { ipcRenderer } from "electron"; // IPC communication
import fs from "fs"; // File system module
import path from "path"; // Path module
import { buildMidiConfig } from "../shared/midi/midiUtils.js";
import { loadSettingsSync } from "../shared/json/configUtils.js";
import { getActiveSetTracks, migrateToSets } from "../shared/utils/setUtils.js";
import logger from "./helpers/logger.js";

// ElementPool for reusing DOM elements
const ElementPool = {
  pool: {},
  template: null,

  init() {
    // Create a template element
    this.template = document.createElement("div");
    this.template.classList.add("module", "z-index-container");
  },

  getElement(moduleName) {
    if (!this.pool[moduleName] || this.pool[moduleName].length === 0) {
      // Clone from template
      const elem = this.template.cloneNode();
      elem.classList.add(moduleName);
      return elem;
    } else {
      return this.pool[moduleName].pop();
    }
  },

  releaseElement(elem) {
    const classList = Array.from(elem.classList);
    const moduleName = classList.find(
      (cls) => cls !== "module" && cls !== "z-index-container"
    );
    if (moduleName) {
      if (!this.pool[moduleName]) {
        this.pool[moduleName] = [];
      }
      this.pool[moduleName].push(elem);
    }
  },
};

const Projector = {
  activeTrack: null,
  activeModules: {},
  activeChannelHandlers: {},
  moduleClassCache: new Map(),
  async loadModuleClass(moduleType) {
    if (!moduleType) {
      return null;
    }

    if (this.moduleClassCache.has(moduleType)) {
      return this.moduleClassCache.get(moduleType);
    }

    const loaderPromise = import(`./modules/${moduleType}.js`)
      .then((module) => module.default)
      .catch((error) => {
        this.moduleClassCache.delete(moduleType);
        throw error;
      });

    this.moduleClassCache.set(moduleType, loaderPromise);
    return loaderPromise;
  },
  userData: [],
  isDeactivating: false,
  isLoadingTrack: false,
  pendingTrackName: null,
  previewModuleName: null,
  debugOverlayActive: false,
  debugLogQueue: [],
  debugLogTimeout: null,

  logToMain(message) {
    ipcRenderer.send("log-to-main", message);
  },

  queueDebugLog(log) {
    if (!this.debugOverlayActive) return;

    this.debugLogQueue.push(log);
    if (!this.debugLogTimeout) {
      this.debugLogTimeout = setTimeout(() => {
        if (this.debugLogQueue.length > 0 && this.debugOverlayActive) {
          const batchedLogs = this.debugLogQueue.join("\n\n");
          ipcRenderer.send("projector-to-dashboard", {
            type: "debug-log",
            log: batchedLogs,
          });
          this.debugLogQueue = [];
        }
        this.debugLogTimeout = null;
      }, 100);
    }
  },

  init() {
    this.loadUserData();
    this.settings = loadSettingsSync();
    this.applyConfigSettings();

    ElementPool.init();

    ipcRenderer.send("projector-to-dashboard", {
      type: "projector-ready",
      props: {},
    });

    // IPC listener for receiving updated userData from Dashboard
    ipcRenderer.on("from-dashboard", (event, data) => {
      try {
        if (!data || typeof data !== "object") {
          console.error(
            "❌ [PROJECTOR-IPC] Invalid IPC message received:",
            data
          );
          return;
        }

        const { type, props = {} } = data;

        if (!type) {
          console.error("❌ [PROJECTOR-IPC] Message missing type field:", data);
          return;
        }

        if (type === "toggleAspectRatioStyle") {
          if (!props.name) {
            console.error(
              "❌ [PROJECTOR-IPC] toggleAspectRatioStyle missing name"
            );
            return;
          }
          return this.toggleAspectRatioStyle(props.name);
        }

        if (type === "setBg") {
          if (!props.value) {
            console.error("❌ [PROJECTOR-IPC] setBg missing value");
            return;
          }
          return this.setBg(props.value);
        }

        if (type === "preview-module") {
          if (!props.moduleName) {
            console.error(
              "❌ [PROJECTOR-IPC] preview-module missing moduleName"
            );
            return;
          }
          return this.previewModule(props.moduleName, props.moduleData);
        }

        if (type === "clear-preview") {
          return this.clearPreview();
        }

        if (type === "trigger-preview-method") {
          if (!props.moduleName || !props.methodName) {
            console.error(
              "❌ [PROJECTOR-IPC] trigger-preview-method missing moduleName or methodName"
            );
            return;
          }
          return this.triggerPreviewMethod(
            props.moduleName,
            props.methodName,
            props.options || {}
          );
        }

        if (type === "refresh-projector") {
          return this.refreshPage();
        }

        if (type === "set-activate") {
          this.loadUserData(props.setId);
          this.deactivateActiveTrack();
          return;
        }

        if (type === "track-activate") {
          if (!props.trackName) {
            console.error(
              "❌ [PROJECTOR-IPC] track-activate missing trackName"
            );
            return;
          }
          return this.handleTrackSelection(props.trackName);
        }

        if (type === "channel-trigger") {
          let channelNumber = props.channelNumber;

          if (!channelNumber && props.channelName) {
            const match = String(props.channelName).match(/^ch(\d+)$/i);
            channelNumber = match ? match[1] : props.channelName;
          }

          if (!channelNumber) {
            console.error(
              "❌ [PROJECTOR-IPC] channel-trigger missing channelNumber/channelName"
            );
            return;
          }

          console.log("🎵 [PROJECTOR-IPC] Channel trigger:", channelNumber);
          return this.handleChannelMessage(`/Ableton/${channelNumber}`);
        }

        if (type === "debug-overlay-visibility") {
          if (typeof props.isOpen !== "boolean") {
            console.error(
              "❌ [PROJECTOR-IPC] debug-overlay-visibility missing isOpen"
            );
            return;
          }
          this.debugOverlayActive = props.isOpen;
          if (!props.isOpen) {
            if (this.debugLogTimeout) {
              clearTimeout(this.debugLogTimeout);
              this.debugLogTimeout = null;
            }
            this.debugLogQueue = [];
          }
          return;
        }
      } catch (error) {
        console.error(
          "❌ [PROJECTOR-IPC] Error processing IPC message:",
          error
        );
        console.error("❌ [PROJECTOR-IPC] Error stack:", error.stack);
        console.error("❌ [PROJECTOR-IPC] Message that caused error:", data);
      }
    });

    this.initInputListener();
  },

  initInputListener() {
    const midiConfig = buildMidiConfig(
      this.userData,
      this.config,
      this.inputType
    );

    ipcRenderer.on("input-event", (event, payload) => {
      const { type, data } = payload;

      logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      logger.log(`🎵 [INPUT] Event type: ${type}, source: ${data.source}`);

      let trackName = null;
      const timestamp = data.timestamp || performance.now() / 1000;

      switch (type) {
        case "track-selection":
          logger.log("🎯 [INPUT] Track selection event...");

          if (data.source === "midi") {
            const trackNameFromNote = midiConfig.trackTriggersMap[data.note];
            logger.log(
              `🎯 [INPUT] Note ${data.note} maps to track:`,
              trackNameFromNote
            );

            if (trackNameFromNote) {
              logger.log(`✅ [INPUT] Activating track: "${trackNameFromNote}"`);
              trackName = trackNameFromNote;
              this.handleTrackSelection(trackNameFromNote);
            } else {
              logger.warn(
                `⚠️ [INPUT] Note ${data.note} not mapped to any track`
              );
            }
          } else if (data.source === "osc") {
            const trackNameFromIdentifier =
              midiConfig.trackTriggersMap[data.identifier];
            logger.log(
              `🎯 [INPUT] OSC address ${data.identifier} maps to track:`,
              trackNameFromIdentifier
            );

            if (trackNameFromIdentifier) {
              logger.log(
                `✅ [INPUT] Activating track: "${trackNameFromIdentifier}"`
              );
              trackName = trackNameFromIdentifier;
              this.handleTrackSelection(trackNameFromIdentifier);
            } else {
              logger.warn(
                `⚠️ [INPUT] OSC address ${data.identifier} not mapped to any track`
              );
              logger.log(
                "📋 [INPUT] Available OSC mappings:",
                Object.keys(midiConfig.trackTriggersMap)
              );
            }
          }
          break;

        case "method-trigger":
          logger.log("🎯 [INPUT] Method trigger event...");
          logger.log(
            "🎯 [INPUT] Current active track:",
            this.activeTrack?.name
          );

          let channelNames = [];
          const activeTrackName = this.activeTrack?.name;

          if (activeTrackName && midiConfig.channelMappings[activeTrackName]) {
            const trackMappings = midiConfig.channelMappings[activeTrackName];

            if (data.source === "midi") {
              const mappedChannels = trackMappings[data.note];
              if (mappedChannels) {
                channelNames = Array.isArray(mappedChannels)
                  ? mappedChannels
                  : [mappedChannels];
                logger.log(
                  `🎯 [INPUT] Note ${data.note} maps to channels:`,
                  channelNames
                );
              }
            } else if (data.source === "osc") {
              const mappedChannels = trackMappings[data.channelName];
              if (mappedChannels) {
                channelNames = Array.isArray(mappedChannels)
                  ? mappedChannels
                  : [mappedChannels];
                logger.log(
                  `🎯 [INPUT] OSC address maps to channels:`,
                  channelNames
                );
              }
            }
          } else {
            logger.warn(
              `⚠️ [INPUT] No channel mappings for track "${activeTrackName}"`
            );
          }

          if (channelNames.length > 0 && activeTrackName) {
            trackName = activeTrackName;
            channelNames.forEach((channelName) => {
              logger.log(
                `✅ [INPUT] Triggering ${channelName} on track "${activeTrackName}"`
              );
              this.handleChannelMessage(`/Ableton/${channelName}`, {
                note: data.note,
                channel: data.channel,
                velocity: data.velocity || 127,
                timestamp,
                trackName,
                source: data.source,
              });
            });
          } else if (channelNames.length === 0) {
            logger.warn(`⚠️ [INPUT] Event not mapped to any channel`);
          } else if (!activeTrackName) {
            logger.warn(`⚠️ [INPUT] No active track - select a track first`);
          }
          break;
      }

      const timeStr = timestamp.toFixed(5);
      const source = data.source === "midi" ? "MIDI" : "OSC";
      let log = `[${timeStr}] ${source} Event\n`;
      if (data.source === "midi") {
        log += `  Note: ${data.note}\n`;
        log += `  Channel: ${data.channel}\n`;
      } else if (data.source === "osc") {
        log += `  Address: ${data.address}\n`;
      }
      if (trackName) {
        log += `  Track: ${trackName}\n`;
      }
      this.queueDebugLog(log);

      logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    });
  },

  applyConfigSettings() {
    const config = this.config;
    if (config.aspectRatio) {
      this.toggleAspectRatioStyle(config.aspectRatio);
    }
    if (config.bgColor) {
      this.setBg(config.bgColor);
    }
  },

  loadUserData(activeSetIdOverride = null) {
    const srcDir = path.join(__dirname, "..", "..");
    const userDataPath = path.join(srcDir, "shared", "json", "userData.json");
    const appStatePath = path.join(srcDir, "shared", "json", "appState.json");
    console.log("🔍 [Projector] __dirname:", __dirname);
    console.log("🔍 [Projector] userDataPath:", userDataPath);
    console.log("🔍 [Projector] appStatePath:", appStatePath);
    try {
      const data = fs.readFileSync(userDataPath, "utf-8");
      const parsedData = JSON.parse(data);
      const migratedData = migrateToSets(parsedData);

      let activeSetId = null;
      if (activeSetIdOverride) {
        activeSetId = activeSetIdOverride;
        console.log("🔍 [Projector] Using activeSetId override:", activeSetId);
      } else {
        try {
          const appStateData = fs.readFileSync(appStatePath, "utf-8");
          const appState = JSON.parse(appStateData);
          activeSetId = appState.activeSetId;
          console.log(
            "🔍 [Projector] Loaded activeSetId from appState:",
            activeSetId
          );
        } catch (appStateErr) {
          console.warn(
            "⚠️ [Projector] Could not load appState.json, falling back to default set"
          );
          activeSetId = null;
        }
      }

      this.userData = getActiveSetTracks(migratedData, activeSetId);
      this.config = migratedData.config || {};
      this.inputType = migratedData.config?.input?.type || "midi";
      console.log(
        `✅ [Projector] Loaded ${this.userData.length} tracks from set: ${
          activeSetId || "default"
        }`
      );
    } catch (err) {
      console.error("Error loading userData.json, trying backup...", err);

      try {
        const backupPath = `${userDataPath}.backup`;
        const backupData = fs.readFileSync(backupPath, "utf-8");
        const parsedData = JSON.parse(backupData);
        const migratedData = migrateToSets(parsedData);

        let activeSetId = null;
        if (activeSetIdOverride) {
          activeSetId = activeSetIdOverride;
        } else {
          try {
            const appStateData = fs.readFileSync(appStatePath, "utf-8");
            const appState = JSON.parse(appStateData);
            activeSetId = appState.activeSetId;
          } catch (appStateErr) {
            activeSetId = null;
          }
        }

        this.userData = getActiveSetTracks(migratedData, activeSetId);
        this.config = migratedData.config || {};
        this.inputType = migratedData.config?.input?.type || "midi";
        console.warn(`Restored from backup: ${this.userData.length} tracks`);
      } catch (backupErr) {
        console.error("Backup also failed, using empty state:", backupErr);
        this.userData = [];
        this.config = {};
        this.inputType = "midi";
      }
    }
  },

  refreshPage() {
    // Reload the current window
    window.location.reload();
  },

  deactivateActiveTrack() {
    if (!this.activeTrack || this.isDeactivating) return;
    this.isDeactivating = true;

    const modulesContainer = document.querySelector(".modules");
    if (!modulesContainer) {
      this.isDeactivating = false;
      return;
    }

    // Immediately hide all modules visually without requiring GPU work
    const allModules = modulesContainer.querySelectorAll(".module");
    forEach(allModules, (module) => {
      module.style.visibility = "hidden";
    });

    forEach(this.activeModules, (instances, instanceId) => {
      forEach(instances, (instance) => {
        if (isFunction(instance.destroy)) {
          try {
            instance.destroy();
          } catch (error) {
            console.error(
              `Error during destroy of instance "${instanceId}":`,
              error
            );
          }
        }
      });
    });

    // Remove all module elements from the DOM
    const moduleElems = modulesContainer.querySelectorAll(".module");
    forEach(moduleElems, (moduleElem) => {
      modulesContainer.removeChild(moduleElem);
      ElementPool.releaseElement(moduleElem);
    });

    this.activeModules = {};
    this.activeTrack = null;
    this.activeChannelHandlers = {};
    this.isDeactivating = false;
  },

  async handleTrackSelection(trackName) {
    logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    logger.log("📦 [TRACK] handleTrackSelection called with:", trackName);
    logger.log("📦 [TRACK] Current userData:", this.userData);
    logger.log("📦 [TRACK] Looking for track with name:", trackName);

    // If already loading, store this as pending and return
    if (this.isLoadingTrack) {
      // If requesting the same track that's loading, ignore
      if (this.activeTrack?.name === trackName) {
        logger.log(
          "⚠️ [TRACK] Already loading this track, ignoring duplicate request"
        );
        return;
      }
      // Store the new track as pending (latest request wins)
      logger.log(
        `⚠️ [TRACK] Track load in progress, queueing "${trackName}" as pending`
      );
      this.pendingTrackName = trackName;
      return;
    }

    // Set loading flag early to prevent concurrent loads
    this.isLoadingTrack = true;

    const track = find(this.userData, { name: trackName });
    logger.log("📦 [TRACK] Track found:", track);

    if (!track) {
      logger.error(`❌ [TRACK] Track "${trackName}" not found in userData`);
      logger.log(
        "📦 [TRACK] Available tracks:",
        this.userData.map((t) => t.name)
      );
      this.deactivateActiveTrack();
      this.isLoadingTrack = false;
      return;
    }

    logger.log("📦 [TRACK] Current activeTrack:", this.activeTrack);

    if (this.activeTrack && this.activeTrack.name !== trackName) {
      logger.log(
        "📦 [TRACK] Deactivating previous track:",
        this.activeTrack.name
      );
      this.deactivateActiveTrack();
    }

    if (this.activeTrack?.name === trackName) {
      logger.log("⚠️ [TRACK] Track already active, skipping");
      this.isLoadingTrack = false;
      return;
    }

    const modulesContainer = document.querySelector(".modules");
    logger.log("📦 [TRACK] Modules container:", modulesContainer);

    if (!modulesContainer) {
      logger.error("❌ [TRACK] No .modules container found in DOM!");
      this.isLoadingTrack = false;
      return;
    }

    logger.log("📦 [TRACK] Track modules to load:", track.modules);

    if (!Array.isArray(track.modules)) {
      logger.error(
        `❌ [TRACK] Track "${trackName}" has invalid modules array:`,
        track.modules
      );
      logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      this.isLoadingTrack = false;
      return;
    }

    try {
      // Ensure activeTrack is set before executing constructor methods (matrix needs module type)
      this.activeTrack = track;
      this.activeChannelHandlers = this.buildChannelHandlerMap(track);

      // Collect all initialization promises
      const moduleInitPromises = track.modules.map(
        async (moduleInstance, index) => {
          const { id: instanceId, type: moduleType } = moduleInstance;
          logger.log(
            `🔧 [MODULE] Loading module ${index + 1}/${
              track.modules.length
            }: ${moduleType} (${instanceId})`
          );
          let ModuleClass;
          try {
            ModuleClass = await this.loadModuleClass(moduleType);
            logger.log(`Module loaded: ${moduleType} (${instanceId})`);
          } catch (error) {
            logger.error(`Error loading module "${moduleType}":`, error);
            return;
          }

          const constructorMethods = get(track.modulesData, [
            instanceId,
            "constructor",
          ]);

          // Initialize an empty array for module instances
          this.activeModules[instanceId] = [];

          // Execute constructor methods (including "matrix") synchronously in the init chain
          if (constructorMethods && constructorMethods.length > 0) {
            await this.executeMethods(
              constructorMethods,
              instanceId,
              this.activeModules[instanceId],
              true
            );
          }
        }
      );

      // Wait for all module initializations to complete
      logger.log("⏳ [TRACK] Waiting for all modules to initialize...");
      await Promise.all(moduleInitPromises);
      logger.log("✅ [TRACK] All modules initialized");

      logger.log(`✅✅✅ [TRACK] Track activated successfully: "${trackName}"`);
      logger.log("📦 [TRACK] Active modules:", Object.keys(this.activeModules));
      logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    } finally {
      this.isLoadingTrack = false;
    }

    // Check if another track switch was requested during load
    if (this.pendingTrackName) {
      const nextTrack = this.pendingTrackName;
      this.pendingTrackName = null;
      logger.log(`🔄 [TRACK] Loading pending track: "${nextTrack}"`);
      this.handleTrackSelection(nextTrack);
      return;
    }

    // Only send ready when no pending track
    ipcRenderer.send("projector-to-dashboard", {
      type: "projector-ready",
      props: {},
    });
    logger.log("✅ [PROJECTOR-IPC] Sent projector-ready signal to dashboard");
  },

  async handleChannelMessage(channelPath, debugContext = {}) {
    if (!this.activeTrack) return;

    if (this.isLoadingTrack) {
      logger.warn(`Ignoring channel trigger during track initialization`);
      return;
    }

    const track = this.activeTrack;
    const channelMatch = channelPath.match(/^\/Ableton\/(\d+)$/);

    if (channelMatch && channelMatch[1]) {
      const channelNumber = channelMatch[1];
      logger.log(`Received message for channel: ${channelNumber}`);
      const { modulesData } = track;
      if (!this.activeChannelHandlers[channelNumber]) {
        this.activeChannelHandlers = this.buildChannelHandlerMap(track);
      }
      const channelTargets = this.activeChannelHandlers[channelNumber] || [];
      if (channelTargets.length === 0) {
        logger.warn(`No modules mapped to channel ${channelNumber}`);
        return;
      }

      await Promise.all(
        channelTargets.map(async ({ instanceId, moduleType }) => {
          Projector.logToMain(
            `instanceId: ${instanceId}, moduleType: ${moduleType}`
          );

          const moduleData = get(modulesData, instanceId);
          if (!moduleData) return;

          const methods = get(moduleData.methods, channelNumber);
          if (!methods) return;

          const moduleInstances = this.activeModules[instanceId] || [];
          await this.executeMethods(
            methods,
            instanceId,
            moduleInstances,
            false,
            {
              ...debugContext,
              moduleInfo: { instanceId, type: moduleType },
              trackName: this.activeTrack.name,
            }
          );
        })
      );
    } else {
      logger.warn(`Invalid channel path received: ${channelPath}`);
    }
  },

  buildChannelHandlerMap(track) {
    if (!track || !Array.isArray(track.modules)) {
      return {};
    }
    const map = {};
    track.modules.forEach(({ id: instanceId, type }) => {
      const methodEntries = get(track, ["modulesData", instanceId, "methods"]);
      if (!methodEntries) return;
      Object.entries(methodEntries).forEach(([channelNumber, methods]) => {
        if (!Array.isArray(methods) || methods.length === 0) return;
        if (!map[channelNumber]) {
          map[channelNumber] = [];
        }
        map[channelNumber].push({
          instanceId,
          moduleType: type,
        });
      });
    });
    return map;
  },

  async executeMethods(
    methods,
    instanceId,
    moduleInstances,
    isConstructor = false,
    debugContext = {}
  ) {
    logger.log(`⏱️ executeMethods start: ${instanceId}`);

    Projector.logToMain(`${performance.now()}`);
    Projector.logToMain(`executeMethods: ${instanceId}`);

    let needsMatrixUpdate = false;
    let matrixOptions = null;
    let otherMethods = [];

    // Separate "matrix" method from others
    forEach(methods, (method) => {
      if (method.name === "matrix") {
        needsMatrixUpdate = true;
        matrixOptions = method.options;
      } else {
        otherMethods.push(method);
      }
    });

    // Handle "matrix" method if present
    if (needsMatrixUpdate) {
      logger.log(`⏱️ Matrix update start: ${instanceId}`);
      await this.updateMatrix(instanceId, matrixOptions);
      logger.log(`⏱️ Matrix update end: ${instanceId}`);

      // Update moduleInstances with the newly created instances
      moduleInstances = this.activeModules[instanceId];
    }

    // Execute other methods in parallel
    logger.log(`⏱️ Other methods execution start: ${instanceId}`);
    await Promise.all(
      otherMethods.map(async ({ name: methodName, options: methodOptions }) => {
        const options = fromPairs(
          map(methodOptions, ({ name, value, randomRange }) => {
            if (
              randomRange &&
              Array.isArray(randomRange) &&
              randomRange.length === 2
            ) {
              let [min, max] = randomRange;

              if (typeof min !== "number" || typeof max !== "number") {
                console.warn(
                  `[Projector] Invalid randomRange for "${name}": [${min}, ${max}] - expected numbers. Using value: ${value}`
                );
                return [name, value];
              }

              if (min > max) {
                console.warn(
                  `[Projector] Invalid randomRange for "${name}": min (${min}) > max (${max}). Swapping values.`
                );
                [min, max] = [max, min];
              }

              const randomValue =
                Number.isInteger(min) && Number.isInteger(max)
                  ? Math.floor(Math.random() * (max - min + 1)) + min
                  : Math.random() * (max - min) + min;

              return [name, randomValue];
            }
            return [name, value];
          })
        );

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

        await Promise.all(
          moduleInstances.map(async (instance) => {
            logger.log(`⏱️ Method start: ${methodName} for ${instanceId}`);
            Projector.logToMain(
              `${JSON.stringify(options)} [${performance.now()}]`
            );

            if (isFunction(instance[methodName])) {
              await instance[methodName](options);
              if (isConstructor) {
                logger.log(
                  `Executed constructor method "${methodName}" on module "${instanceId}".`
                );
              } else {
                logger.log(
                  `Executed method "${methodName}" with options ${JSON.stringify(
                    options
                  )} on module "${instanceId}".`
                );
              }
            } else {
              logger.warn(
                `Method "${methodName}" does not exist on module "${instanceId}".`
              );
            }
            logger.log(`⏱️ Method end: ${methodName} for ${instanceId}`);
          })
        );
      })
    );
    logger.log(`⏱️ Other methods execution end: ${instanceId}`);
    logger.log(`⏱️ executeMethods end: ${instanceId}`);
  },

  async updateMatrix(instanceId, methodOptions) {
    logger.log(`⏱️ updateMatrix start: ${instanceId}`);
    const options = fromPairs(
      map(methodOptions, ({ name, value }) => [name, value])
    );

    let matrixOptions = { rows: 1, cols: 1, excludedCells: [], border: false };
    const m = options.matrix;

    if (Array.isArray(m)) {
      matrixOptions = {
        rows: m[0] || 1,
        cols: m[1] || 1,
        excludedCells: [],
        border: options.border,
      };
    } else if (m && typeof m === "object") {
      matrixOptions = {
        rows: m.rows || 1,
        cols: m.cols || 1,
        excludedCells: m.excludedCells || [],
        border: options.border,
      };
    }

    const { rows, cols, excludedCells } = matrixOptions;

    const modulesContainer = document.querySelector(".modules");
    if (!modulesContainer) return;

    // Find the module instance to get its type
    // For preview mode (no activeTrack), strip the "preview_" prefix from instanceId
    const moduleInstance = this.activeTrack
      ? this.activeTrack.modules.find((m) => m.id === instanceId)
      : null;
    const moduleType = moduleInstance
      ? moduleInstance.type
      : instanceId.replace(/^preview_/, "");
    if (!moduleType) {
      logger.error(`Could not find module type for instanceId: ${instanceId}`);
      return;
    }

    // Remove existing module instances and release elements to the pool
    const moduleInstances = this.activeModules[instanceId] || [];
    forEach(moduleInstances, (instance) => {
      if (isFunction(instance.destroy)) {
        instance.destroy();
      }
    });
    // Query specifically for elements with this instance ID to avoid affecting other instances
    const moduleElems = modulesContainer.querySelectorAll(
      `.module.${moduleType}[data-instance-id="${instanceId}"]`
    );
    forEach(moduleElems, (moduleElem) => {
      modulesContainer.removeChild(moduleElem);
      ElementPool.releaseElement(moduleElem);
    });
    this.activeModules[instanceId] = [];

    // Create new module elements and instances
    let ModuleClass;
    try {
      ModuleClass = await this.loadModuleClass(moduleType);
      logger.log(`Module loaded: ${moduleType} (${instanceId})`);
    } catch (error) {
      logger.error(`Error loading module "${moduleType}":`, error);
      return;
    }

    // Updated zIndex Assignment
    const zIndex = this.activeTrack
      ? this.activeTrack.modules.findIndex((m) => m.id === instanceId) + 1
      : 1;

    const newModuleInstances = [];
    const fragment = document.createDocumentFragment();
    const moduleElemsToInstantiate = [];

    // Pre-compute styles
    const width = `${100 / cols}%`;
    const height = `${100 / rows}%`;
    const border = matrixOptions.border ? "1px solid white" : "none";

    for (let row = 1; row <= rows; row++) {
      for (let col = 1; col <= cols; col++) {
        const cellKey = `${row}-${col}`;
        if (excludedCells.includes(cellKey)) {
          continue; // Skip this cell
        }

        // Get element from pool or clone from template
        const moduleElem = ElementPool.getElement(moduleType);

        // Tag element with instance ID for selective removal
        moduleElem.dataset.instanceId = instanceId;

        // Pre-compute and set styles using cssText
        const top = `${(100 / rows) * (row - 1)}%`;
        const left = `${(100 / cols) * (col - 1)}%`;
        moduleElem.style.cssText = `
          position: absolute;
          width: ${width};
          height: ${height};
          top: ${top};
          left: ${left};
          z-index: ${zIndex};
          border: ${border};
        `;

        fragment.appendChild(moduleElem);
        moduleElemsToInstantiate.push(moduleElem);
      }
    }

    // Append all elements at once
    modulesContainer.appendChild(fragment);

    // Instantiate modules in a single RAF
    await new Promise((resolve) =>
      requestAnimationFrame(() => {
        forEach(moduleElemsToInstantiate, (moduleElem) => {
          const moduleInstance = new ModuleClass(moduleElem);
          newModuleInstances.push(moduleInstance);
        });
        resolve();
      })
    );

    // Store the new instances
    this.activeModules[instanceId] = newModuleInstances;

    // Execute any constructor methods excluding "matrix"
    // Only do this if we have an active track (not in preview mode)
    if (this.activeTrack) {
      const constructorMethods = get(
        this.activeTrack,
        ["modulesData", instanceId, "constructor"],
        []
      );
      const filteredConstructorMethods = constructorMethods.filter(
        (method) => method.name !== "matrix"
      );

      if (filteredConstructorMethods.length > 0) {
        logger.log(`⏱️ Constructor methods start: ${instanceId}`);
        await this.executeMethods(
          filteredConstructorMethods,
          instanceId,
          newModuleInstances,
          true
        );
        logger.log(`⏱️ Constructor methods end: ${instanceId}`);
      }
    }

    logger.log(`⏱️ updateMatrix end: ${instanceId}`);
  },

  toggleAspectRatioStyle(selectedRatioId) {
    document.documentElement.classList.remove("reel", "portrait", "scale");

    const ratio = this.settings.aspectRatios.find(
      (r) => r.id === selectedRatioId
    );
    if (!ratio) {
      logger.warn(`Aspect ratio "${selectedRatioId}" not found in settings`);
      document.body.style = ``;
      return;
    }

    if (ratio.id === "landscape") {
      document.body.style = ``;
    } else {
      if (ratio.id === "9-16") {
        document.documentElement.classList.add("reel");
      } else if (ratio.id === "4-5") {
        document.documentElement.classList.add("scale");
      }

      document.body.style = `
        width: ${ratio.width}; 
        height: ${ratio.height};
        position: relative;
        margin: 0 auto;
        transform-origin: center center;
      `;
    }
  },

  setBg(colorId) {
    const color = this.settings.backgroundColors.find((c) => c.id === colorId);
    if (!color) {
      logger.warn(`Background color "${colorId}" not found in settings`);
      return;
    }

    const currentStyle = document.documentElement.style.filter;
    const hasHueRotate = currentStyle.includes("hue-rotate");
    const hueRotateValue = hasHueRotate
      ? currentStyle.match(/hue-rotate\(([^)]+)\)/)[1]
      : "";

    document.documentElement.style.backgroundColor = color.value;
    document.documentElement.style.filter = hasHueRotate
      ? `invert(0) hue-rotate(${hueRotateValue})`
      : "invert(0)";
  },

  async previewModule(moduleName, moduleData) {
    logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.log(`🎨 [PREVIEW] Starting preview for module: ${moduleName}`);
    logger.log(`🎨 [PREVIEW] Module data received:`, moduleData);

    logger.log(`🎨 [PREVIEW] Clearing any existing preview...`);
    this.clearPreview();

    const modulesContainer = document.querySelector(".modules");
    logger.log(`🎨 [PREVIEW] Modules container found:`, !!modulesContainer);
    if (!modulesContainer) {
      logger.error("❌ [PREVIEW] No .modules container found in DOM");
      return;
    }

    try {
      logger.log(`🎨 [PREVIEW] Setting preview module name: ${moduleName}`);
      this.previewModuleName = moduleName;
      // Use a special preview key to avoid conflicts with instance IDs
      const previewKey = `preview_${moduleName}`;
      this.activeModules[previewKey] = [];

      logger.log(`🎨 [PREVIEW] Executing constructor methods...`);
      if (moduleData?.constructor && moduleData.constructor.length > 0) {
        logger.log(
          `🎨 [PREVIEW] Constructor methods found (${moduleData.constructor.length}):`,
          moduleData.constructor
        );

        await this.executeMethods(
          moduleData.constructor,
          previewKey,
          this.activeModules[previewKey],
          true
        );

        logger.log(`✅ [PREVIEW] Constructor methods executed`);
        logger.log(
          `✅ [PREVIEW] Created ${this.activeModules[previewKey].length} instance(s)`
        );
      } else {
        logger.log(`⚠️ [PREVIEW] No constructor methods to execute`);
      }

      logger.log(`✅✅✅ [PREVIEW] Preview active for: ${moduleName}`);
      logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    } catch (error) {
      logger.error(
        `❌ [PREVIEW] Error instantiating module "${moduleName}":`,
        error
      );
      logger.error(`❌ [PREVIEW] Error stack:`, error.stack);

      this.clearPreview();

      logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    }
  },

  clearPreview() {
    logger.log(`🧹 [PREVIEW] clearPreview called`);

    if (!this.previewModuleName) {
      logger.log(`🧹 [PREVIEW] No preview module to clear`);
      return;
    }

    const moduleName = this.previewModuleName;
    logger.log(`🧹 [PREVIEW] Clearing preview for: ${moduleName}`);

    const modulesContainer = document.querySelector(".modules");
    if (!modulesContainer) {
      logger.error("❌ [PREVIEW] No .modules container found");
      this.previewModuleName = null;
      return;
    }

    const previewKey = `preview_${moduleName}`;
    const instances = this.activeModules[previewKey] || [];
    logger.log(
      `🧹 [PREVIEW] Found ${instances.length} instance(s) to clean up`
    );

    forEach(instances, (instance) => {
      if (isFunction(instance.destroy)) {
        logger.log(`🧹 [PREVIEW] Calling destroy() on instance...`);
        try {
          instance.destroy();
          logger.log(`✅ [PREVIEW] Instance destroyed successfully`);
        } catch (error) {
          logger.error(`❌ [PREVIEW] Error destroying preview:`, error);
          logger.error(`❌ [PREVIEW] Error stack:`, error.stack);
        }
      }
    });

    // Only remove preview elements (those with preview_ prefix in data-instance-id)
    const moduleElems = modulesContainer.querySelectorAll(
      `.module.${moduleName}[data-instance-id="${previewKey}"]`
    );
    logger.log(`🧹 [PREVIEW] Found ${moduleElems.length} element(s) to remove`);

    forEach(moduleElems, (moduleElem) => {
      if (moduleElem.parentNode === modulesContainer) {
        modulesContainer.removeChild(moduleElem);
        ElementPool.releaseElement(moduleElem);
      }
    });

    delete this.activeModules[previewKey];
    this.previewModuleName = null;
    logger.log(`✅✅✅ [PREVIEW] Preview cleared successfully`);
  },

  async triggerPreviewMethod(moduleName, methodName, options) {
    logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.log(
      `🎯 [PREVIEW] Triggering method "${methodName}" on preview: ${moduleName}`
    );
    logger.log(`🎯 [PREVIEW] Options:`, options);

    if (!this.previewModuleName || this.previewModuleName !== moduleName) {
      logger.error(`❌ [PREVIEW] No active preview for module: ${moduleName}`);
      logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      return;
    }

    const previewKey = `preview_${moduleName}`;
    const instances = this.activeModules[previewKey] || [];

    if (instances.length === 0) {
      logger.error(
        `❌ [PREVIEW] No instances found for preview: ${moduleName}`
      );
      logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      return;
    }

    logger.log(
      `🎯 [PREVIEW] Found ${instances.length} instance(s) to trigger method on`
    );

    try {
      await Promise.all(
        instances.map(async (instance) => {
          if (isFunction(instance[methodName])) {
            logger.log(
              `🎯 [PREVIEW] Executing method "${methodName}" on instance...`
            );
            await instance[methodName](options);
            logger.log(
              `✅ [PREVIEW] Method "${methodName}" executed successfully`
            );
          } else {
            logger.warn(
              `⚠️ [PREVIEW] Method "${methodName}" does not exist on instance`
            );
          }
        })
      );

      logger.log(`✅✅✅ [PREVIEW] Method trigger completed`);
      logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    } catch (error) {
      logger.error(
        `❌ [PREVIEW] Error triggering method "${methodName}":`,
        error
      );
      logger.error(`❌ [PREVIEW] Error stack:`, error.stack);
      logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    }
  },
};

export default Projector;

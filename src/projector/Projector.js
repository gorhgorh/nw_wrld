import { loadJsonFileSync } from "../shared/json/jsonFileBase.ts";
import { loadSettingsSync } from "../shared/json/configUtils.ts";
import { getActiveSetTracks, migrateToSets } from "../shared/utils/setUtils.ts";
import { getProjectDir } from "../shared/utils/projectDir.ts";
import logger from "./helpers/logger";

import { getMessaging } from "./internal/bridge.js";
import { queueDebugLog } from "./internal/debugLog.js";
import { initDashboardIpc } from "./internal/ipcFromDashboard.js";
import { initInputListener } from "./internal/inputListener.js";
import { introspectModule } from "./internal/introspection.js";
import { applyConfigSettings, setBg, toggleAspectRatioStyle } from "./internal/uiStyle.js";
import { initWorkspaceModulesChangedListener } from "./internal/workspaceEvents.js";
import { loadWorkspaceModuleSource } from "./internal/workspaceModules.js";
import { previewModule, clearPreview, clearPreviewForModule, triggerPreviewMethod } from "./internal/preview/previewController.js";
import { handleChannelMessage, buildChannelHandlerMap } from "./internal/track/channelDispatch.js";
import { executeMethods } from "./internal/track/methodExecutor.js";
import { deactivateActiveTrack, handleTrackSelection } from "./internal/track/trackLifecycle.js";

const Projector = {
  activeTrack: null,
  activeModules: {},
  activeChannelHandlers: {},
  moduleClassCache: new Map(),
  workspaceModuleSourceCache: new Map(),
  methodOptionNoRepeatCache: new Map(),
  runtimeMatrixOverrides: new Map(),
  assetsBaseUrl: null,
  trackSandboxHost: null,
  trackModuleSources: null,
  restoreTrackNameAfterPreview: null,
  workspacePath: null,
  userData: [],
  isDeactivating: false,
  isLoadingTrack: false,
  pendingTrackName: null,
  pendingReloadData: null,
  previewModuleName: null,
  previewToken: 0,
  debugOverlayActive: false,
  debugLogQueue: [],
  debugLogTimeout: null,
  moduleIntrospectionCache: new Map(),

  getAssetsBaseUrlForSandboxToken(token) {
    const safe = String(token || "").trim();
    if (!safe) return null;
    return `nw-assets://app/${encodeURIComponent(safe)}/`;
  },

  async loadWorkspaceModuleSource(moduleType) {
    return await loadWorkspaceModuleSource.call(this, moduleType);
  },

  async loadModuleClass(moduleType) {
    return await this.loadWorkspaceModuleSource(moduleType);
  },

  logToMain(message) {
    const appBridge = globalThis.nwWrldAppBridge;
    if (!appBridge || typeof appBridge.logToMain !== "function") return;
    appBridge.logToMain(message);
  },

  queueDebugLog,
  initDashboardIpc,
  initWorkspaceModulesChangedListener,
  initInputListener,
  introspectModule,
  applyConfigSettings,
  toggleAspectRatioStyle,
  setBg,
  deactivateActiveTrack,
  handleTrackSelection,
  handleChannelMessage,
  buildChannelHandlerMap,
  executeMethods,
  previewModule,
  clearPreview,
  clearPreviewForModule,
  triggerPreviewMethod,

  init() {
    this.loadUserData();
    this.settings = loadSettingsSync();
    this.applyConfigSettings();

    {
      const messaging = getMessaging();
      messaging?.sendToDashboard?.("projector-ready", {});
    }

    this.initWorkspaceModulesChangedListener();
    this.initDashboardIpc();
    this.initInputListener();
  },

  loadUserData(activeSetIdOverride = null) {
    const parsedData = loadJsonFileSync(
      "userData.json",
      { config: {}, sets: [] },
      "Could not load userData.json, initializing with empty data."
    );
    const migratedData = migrateToSets(parsedData);

    let activeSetId = null;
    if (activeSetIdOverride) {
      activeSetId = activeSetIdOverride;
    } else {
      const appState = loadJsonFileSync(
        "appState.json",
        { activeSetId: null, workspacePath: null },
        "Could not load appState.json, initializing with defaults."
      );
      activeSetId = appState?.activeSetId || null;
      const projectDir = getProjectDir();
      this.workspacePath = projectDir || appState?.workspacePath || null;
    }

    this.userData = getActiveSetTracks(migratedData, activeSetId);
    this.config = migratedData.config || {};
    this.inputType = migratedData.config?.input?.type || "midi";
    if (logger.debugEnabled) {
      console.log(
        `✅ [Projector] Loaded ${this.userData.length} tracks from set: ${
          activeSetId || "default"
        }`
      );
    }
  },

  refreshPage() {
    window.location.reload();
  },
};

export default Projector;

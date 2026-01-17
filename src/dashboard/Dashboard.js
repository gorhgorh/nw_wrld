// Dashboard.tsx
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { useAtom } from "jotai";
import { produce } from "immer";
import { loadSettings } from "../shared/json/configUtils.ts";
import { getActiveSetTracks } from "../shared/utils/setUtils.ts";
import {
  updateUserData,
  updateActiveSet,
} from "./core/utils";
import { useIPCSend, useIPCInvoke } from "./core/hooks/useIPC";
import { useLatestRef } from "./core/hooks/useLatestRef";
import {
  userDataAtom,
  recordingDataAtom,
  activeTrackIdAtom,
  activeSetIdAtom,
  selectedChannelAtom,
  flashingConstructorsAtom,
  recordingStateAtom,
  useFlashingChannels,
} from "./core/state.ts";
import { DashboardHeader } from "./components/DashboardHeader";
import { DashboardFooter } from "./components/DashboardFooter";
import { DashboardBody } from "./components/DashboardBody";
import { DashboardModalLayer } from "./components/DashboardModalLayer";
import { WorkspaceGateModal } from "./components/WorkspaceGateModal";
import { useWorkspaceModules } from "./core/hooks/useWorkspaceModules.ts";
import { useInputEvents } from "./core/hooks/useInputEvents";
import { useModuleIntrospection } from "./core/hooks/useModuleIntrospection";
import { useProjectorPerfStats } from "./core/hooks/useProjectorPerfStats";
import { useDashboardPlayback } from "./core/hooks/useDashboardPlayback";
import { useDashboardBootstrap } from "./core/hooks/useDashboardBootstrap";
import { useDashboardPersistence } from "./core/hooks/useDashboardPersistence";
import ErrorBoundary from "./components/ErrorBoundary";

// =========================
// Components
// =========================

const Dashboard = () => {
  const [userData, setUserData] = useAtom(userDataAtom);
  const [recordingData, setRecordingData] = useAtom(recordingDataAtom);
  const [activeTrackId, setActiveTrackId] = useAtom(activeTrackIdAtom);
  const [activeSetId, setActiveSetId] = useAtom(activeSetIdAtom);
  const [predefinedModules, setPredefinedModules] = useState([]);
  const [selectedChannel, setSelectedChannel] = useAtom(selectedChannelAtom);
  const [selectedTrackForModuleMenu, setSelectedTrackForModuleMenu] = useState(null);
  const [, flashChannel] = useFlashingChannels();
  const [, setFlashingConstructors] = useAtom(flashingConstructorsAtom);

  const sendToProjector = useIPCSend("dashboard-to-projector");
  const invokeIPC = useIPCInvoke();

  const [workspacePath, setWorkspacePath] = useState(null);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [workspaceModalMode, setWorkspaceModalMode] = useState("initial");
  const [workspaceModalPath, setWorkspaceModalPath] = useState(null);

  // Module editor states
  const [isModuleEditorOpen, setIsModuleEditorOpen] = useState(false);
  const [editingModuleName, setEditingModuleName] = useState(null);
  const [editingTemplateType, setEditingTemplateType] = useState(null);
  const [isNewModuleDialogOpen, setIsNewModuleDialogOpen] = useState(false);

  const userDataRef = useLatestRef(userData);
  const recordingDataRef = useLatestRef(recordingData);

  const activeTrackIdRef = useRef(activeTrackId);
  const activeSetIdRef = useRef(activeSetId);
  const workspacePathRef = useRef(null);
  useEffect(() => {
    activeTrackIdRef.current = activeTrackId;
    activeSetIdRef.current = activeSetId;
    workspacePathRef.current = workspacePath;
  }, [activeTrackId, activeSetId, workspacePath]);

  // Recording state management
  const [recordingState, setRecordingState] = useAtom(recordingStateAtom);
  const recordingStateRef = useLatestRef(recordingState);
  const triggerMapsRef = useRef({ trackTriggersMap: {}, channelMappings: {} });

  const isInitialMount = useRef(true);
  const userDataLoadedSuccessfully = useRef(false);

  const [aspectRatio, setAspectRatio] = useState("default");
  const [bgColor, setBgColor] = useState("grey");
  const [inputConfig, setInputConfig] = useState({
    type: "midi",
    deviceName: "IAC Driver Bus 1",
    trackSelectionChannel: 1,
    methodTriggerChannel: 2,
    velocitySensitive: false,
    port: 8000,
  });
  const [availableMidiDevices, setAvailableMidiDevices] = useState([]);
  const [inputStatus, setInputStatus] = useState({
    status: "disconnected",
    message: "",
  });
  const [settings, setSettings] = useState({
    aspectRatios: [],
    backgroundColors: [],
  });
  const [isCreateTrackOpen, setIsCreateTrackOpen] = useState(false);
  const [isCreateSetOpen, setIsCreateSetOpen] = useState(false);
  const [isSelectTrackModalOpen, setIsSelectTrackModalOpen] = useState(false);
  const [isSelectSetModalOpen, setIsSelectSetModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isAddModuleModalOpen, setIsAddModuleModalOpen] = useState(false);
  const [isManageModulesModalOpen, setIsManageModulesModalOpen] = useState(false);
  const [isDebugOverlayOpen, setIsDebugOverlayOpen] = useState(false);
  const [isReleaseNotesOpen, setIsReleaseNotesOpen] = useState(false);
  const [isInputMappingsModalOpen, setIsInputMappingsModalOpen] = useState(false);
  const [confirmationModal, setConfirmationModal] = useState(null);
  const [debugLogs, setDebugLogs] = useState([]);
  const [isSequencerMuted, setIsSequencerMuted] = useState(false);
  const [isProjectorReady, setIsProjectorReady] = useState(false);
  const [perfStats, setPerfStats] = useState(null);
  const [workspaceModuleFiles, setWorkspaceModuleFiles] = useState([]);
  const [workspaceModuleLoadFailures, setWorkspaceModuleLoadFailures] = useState([]);
  const didMigrateWorkspaceModuleTypesRef = useRef(false);
  const loadModulesRunIdRef = useRef(0);
  const sequencerMutedRef = useLatestRef(isSequencerMuted);
  const [editChannelModalState, setEditChannelModalState] = useState({
    isOpen: false,
    trackIndex: null,
    channelNumber: null,
  });

  useInputEvents({
    userData,
    activeSetId,
    userDataRef,
    activeTrackIdRef,
    activeSetIdRef,
    recordingStateRef,
    triggerMapsRef,
    setActiveTrackId,
    setRecordingData,
    setRecordingState,
    flashChannel,
    setFlashingConstructors,
    setInputStatus,
    setDebugLogs,
    sendToProjector,
    isDebugOverlayOpen,
    setIsProjectorReady,
  });

  // Module editor handlers
  const handleCreateNewModule = () => {
    setIsNewModuleDialogOpen(true);
  };

  const handleCreateModule = (moduleName, templateType) => {
    setEditingModuleName(moduleName);
    setEditingTemplateType(templateType);
    setIsModuleEditorOpen(true);
  };

  const handleEditModule = (moduleName) => {
    setEditingModuleName(moduleName);
    setEditingTemplateType(null);
    setIsModuleEditorOpen(true);
  };

  const handleCloseModuleEditor = () => {
    setIsModuleEditorOpen(false);
    setEditingModuleName(null);
    setEditingTemplateType(null);
  };

  const openConfirmationModal = useCallback((message, onConfirm) => {
    setConfirmationModal({ message, onConfirm, type: "confirm" });
  }, []);

  const openAlertModal = useCallback((message) => {
    setConfirmationModal({ message, type: "alert" });
  }, []);

  const handleEditChannel = useCallback(
    (channelNumber) => {
      if (!selectedChannel) return;
      setEditChannelModalState({
        isOpen: true,
        trackIndex: selectedChannel.trackIndex,
        channelNumber: channelNumber,
      });
    },
    [selectedChannel]
  );

  const handleDeleteChannel = useCallback(
    (channelNumber) => {
      if (!selectedChannel) return;
      openConfirmationModal(`Are you sure you want to delete Channel ${channelNumber}?`, () => {
        updateActiveSet(setUserData, activeSetId, (activeSet) => {
          const currentTrack = activeSet.tracks[selectedChannel.trackIndex];
          const channelKey = String(channelNumber);

          delete currentTrack.channelMappings[channelKey];

          Object.keys(currentTrack.modulesData).forEach((moduleId) => {
            if (currentTrack.modulesData[moduleId].methods) {
              delete currentTrack.modulesData[moduleId].methods[channelKey];
            }
          });
        });
      });
    },
    [selectedChannel, setUserData, openConfirmationModal]
  );

  // Load settings on mount
  useEffect(() => {
    loadSettings().then((loadedSettings) => {
      setSettings(loadedSettings);
    });

    invokeIPC("input:get-midi-devices").then((devices) => {
      setAvailableMidiDevices(devices);
    });
  }, [invokeIPC]);

  // Initialize settings when userData loads (but don't overwrite user changes from settings modal)
  useEffect(() => {
    if (userData.config) {
      const storedAspect = userData.config.aspectRatio;
      setAspectRatio(!storedAspect || storedAspect === "landscape" ? "default" : storedAspect);
      setBgColor(userData.config.bgColor || "grey");
    }
  }, [userData]);

  useEffect(() => {
    updateUserData(setUserData, (draft) => {
      draft.config.aspectRatio = aspectRatio;
    });
  }, [aspectRatio]);

  useEffect(() => {
    sendToProjector("toggleAspectRatioStyle", { name: aspectRatio });
  }, [aspectRatio, sendToProjector]);

  const didInitAspectRefreshRef = useRef(false);
  useEffect(() => {
    if (!didInitAspectRefreshRef.current) {
      didInitAspectRefreshRef.current = true;
      return;
    }
    const t = setTimeout(() => {
      sendToProjector("refresh-projector", {});
    }, 200);
    return () => clearTimeout(t);
  }, [aspectRatio, sendToProjector]);

  useEffect(() => {
    updateUserData(setUserData, (draft) => {
      draft.config.bgColor = bgColor;
    });
  }, [bgColor]);

  useEffect(() => {
    sendToProjector("setBg", { value: bgColor });
  }, [bgColor, sendToProjector]);

  useDashboardPersistence({
    isInitialMountRef: isInitialMount,
    userDataLoadedSuccessfullyRef: userDataLoadedSuccessfully,
    userData,
    recordingData,
    activeTrackId,
    activeSetId,
    userDataRef,
    recordingDataRef,
    activeTrackIdRef,
    activeSetIdRef,
    workspacePathRef,
    sequencerMutedRef,
    sendToProjector,
    isSequencerMuted,
  });

  const isInitialMountInput = useRef(true);

  useEffect(() => {
    if (inputConfig && !isInitialMountInput.current) {
      updateUserData(setUserData, (draft) => {
        draft.config.input = inputConfig;
      });

      invokeIPC("input:configure", inputConfig).catch((err) => {
        console.error("[Dashboard] Failed to configure input:", err);
      });
    }
    isInitialMountInput.current = false;
  }, [inputConfig]);

  const prevSequencerModeRef = useRef(undefined);
  useEffect(() => {
    const next = userData?.config?.sequencerMode;
    const prev = prevSequencerModeRef.current;
    prevSequencerModeRef.current = next;

    if (prev === true && next === false) {
      invokeIPC("input:configure", inputConfig).catch((err) => {
        console.error("[Dashboard] Failed to configure input:", err);
      });
    }
  }, [userData?.config?.sequencerMode, inputConfig, invokeIPC]);

  useModuleIntrospection({
    activeSetId,
    setUserData,
    setPredefinedModules,
    setWorkspaceModuleLoadFailures,
  });
  useProjectorPerfStats(setPerfStats);

  const ipcInvoke = useIPCInvoke();
  useWorkspaceModules({
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
  });
  useDashboardBootstrap({
    isInitialMountRef: isInitialMount,
    userDataLoadedSuccessfullyRef: userDataLoadedSuccessfully,
    workspacePathRef,
    setUserData,
    setRecordingData,
    setActiveTrackId,
    setActiveSetId,
    setInputConfig,
    setIsSequencerMuted,
    setWorkspacePath,
    setWorkspaceModalMode,
    setWorkspaceModalPath,
    setIsWorkspaceModalOpen,
  });

  const handleSelectWorkspace = useCallback(async () => {
    await ipcInvoke("workspace:select");
  }, [ipcInvoke]);

  const openAddModuleModal = useCallback((trackIndex) => {
    setSelectedTrackForModuleMenu(trackIndex);
    setIsAddModuleModalOpen(true);
  }, []);

  const firstVisibleTrack = useMemo(() => {
    if (!activeTrackId) return null;
    const tracks = getActiveSetTracks(userData, activeSetId);
    const track = tracks.find((t) => t.id === activeTrackId);
    if (!track) return null;
    const trackIndex = tracks.findIndex((t) => t.id === activeTrackId);
    return { track, trackIndex };
  }, [activeTrackId, userData]);

  // NOTE: refs are declared above; keep this section focused on derived data + hooks.

  const {
    footerPlaybackState,
    isSequencerPlaying,
    sequencerCurrentStep,
    handleSequencerToggle,
    handleFooterPlayPause,
    handleFooterStop,
    sequencerEngineRef,
    sequencerRunIdRef,
    setIsSequencerPlaying,
    setSequencerCurrentStep,
  } = useDashboardPlayback({
    userData,
    userDataRef,
    activeTrackId,
    activeSetId,
    activeSetIdRef,
    firstVisibleTrack,
    recordingData,
    recordingDataRef,
    setRecordingData,
    sendToProjector,
    flashChannel,
    setFlashingConstructors,
    isSequencerMuted,
    setIsProjectorReady,
    isInitialMountRef: isInitialMount,
  });

  const updateConfig = useCallback(
    (updates) => {
      const wasSequencerMode = userData.config?.sequencerMode;
      const willBeSequencerMode = updates.hasOwnProperty("sequencerMode")
        ? updates.sequencerMode
        : wasSequencerMode;

      if (
        willBeSequencerMode &&
        Object.prototype.hasOwnProperty.call(updates || {}, "sequencerBpm") &&
        typeof updates.sequencerBpm === "number" &&
        Number.isFinite(updates.sequencerBpm) &&
        sequencerEngineRef.current
      ) {
        sequencerEngineRef.current.setBpm(updates.sequencerBpm);
      }

      if (wasSequencerMode && !willBeSequencerMode && isSequencerPlaying) {
        if (sequencerEngineRef.current) {
          sequencerEngineRef.current.stop();
          if (typeof sequencerEngineRef.current.getRunId === "function") {
            sequencerRunIdRef.current = sequencerEngineRef.current.getRunId();
          }
          setIsSequencerPlaying(false);
          setSequencerCurrentStep(0);
        }
      }

      const normalizeUserColors = (list) => {
        const raw = Array.isArray(list) ? list : [];
        const out = [];
        const seen = new Set();
        for (const v of raw) {
          const s = String(v || "").trim();
          if (!s) continue;
          const withHash = s.startsWith("#") ? s : `#${s}`;
          if (!/^#([0-9A-F]{3}){1,2}$/i.test(withHash)) continue;
          let hex = withHash.toLowerCase();
          if (hex.length === 4) {
            const r = hex[1];
            const g = hex[2];
            const b = hex[3];
            hex = `#${r}${r}${g}${g}${b}${b}`;
          }
          if (seen.has(hex)) continue;
          seen.add(hex);
          out.push(hex);
        }
        return out;
      };

      setUserData(
        produce((draft) => {
          if (!draft.config) {
            draft.config = {};
          }

          const hasUserColors = Object.prototype.hasOwnProperty.call(updates || {}, "userColors");

          if (hasUserColors) {
            const palette = normalizeUserColors(updates.userColors);
            draft.config.userColors = palette;

            const syncOptions = (options) => {
              const list = Array.isArray(options) ? options : [];
              for (const opt of list) {
                if (!opt || typeof opt !== "object") continue;
                if (opt.randomizeFromUserColors !== true) continue;
                if (palette.length > 0) {
                  opt.randomValues = [...palette];
                } else {
                  delete opt.randomValues;
                  delete opt.randomizeFromUserColors;
                }
              }
            };

            const syncMethodList = (methods) => {
              const list = Array.isArray(methods) ? methods : [];
              for (const m of list) {
                if (!m || typeof m !== "object") continue;
                syncOptions(m.options);
              }
            };

            const sets = Array.isArray(draft.sets) ? draft.sets : [];
            for (const set of sets) {
              const tracks = Array.isArray(set?.tracks) ? set.tracks : [];
              for (const track of tracks) {
                const modulesData = track && typeof track === "object" ? track.modulesData : null;
                if (!modulesData || typeof modulesData !== "object") continue;
                for (const instanceId of Object.keys(modulesData)) {
                  const md = modulesData[instanceId];
                  if (!md || typeof md !== "object") continue;
                  syncMethodList(md.constructor);
                  const methodsByChannel =
                    md.methods && typeof md.methods === "object" ? md.methods : null;
                  if (!methodsByChannel) continue;
                  for (const channelKey of Object.keys(methodsByChannel)) {
                    syncMethodList(methodsByChannel[channelKey]);
                  }
                }
              }
            }
          }

          const { userColors, ...rest } = updates || {};
          Object.assign(draft.config, hasUserColors ? rest : updates);
        })
      );
    },
    [setUserData, userData.config, isSequencerPlaying]
  );

  return (
    <div className="relative bg-[#101010] font-mono h-screen flex flex-col">
      <DashboardHeader
        onSets={() => setIsSelectSetModalOpen(true)}
        onTracks={() => setIsSelectTrackModalOpen(true)}
        onModules={() => setIsManageModulesModalOpen(true)}
        onSettings={() => setIsSettingsModalOpen(true)}
        onDebugOverlay={() => setIsDebugOverlayOpen(true)}
        onReleases={() => setIsReleaseNotesOpen(true)}
      />

      <div className="flex-1 overflow-y-auto pt-12 pb-32">
        <div className="bg-[#101010] p-6 font-mono">
          <DashboardBody
            userData={userData}
            activeSetId={activeSetId}
            activeTrackId={activeTrackId}
            predefinedModules={predefinedModules}
            openAddModuleModal={openAddModuleModal}
            openConfirmationModal={openConfirmationModal}
            setActiveTrackId={setActiveTrackId}
            inputConfig={inputConfig}
            config={userData.config}
            isSequencerPlaying={isSequencerPlaying}
            sequencerCurrentStep={sequencerCurrentStep}
            handleSequencerToggle={handleSequencerToggle}
            workspacePath={workspacePath}
            workspaceModuleFiles={workspaceModuleFiles}
            workspaceModuleLoadFailures={workspaceModuleLoadFailures}
          />
        </div>
      </div>

      <DashboardFooter
        track={firstVisibleTrack?.track || null}
        isPlaying={
          userData.config.sequencerMode
            ? isSequencerPlaying
            : firstVisibleTrack
              ? footerPlaybackState[firstVisibleTrack.track.id] || false
              : false
        }
        onPlayPause={handleFooterPlayPause}
        onStop={handleFooterStop}
        inputStatus={inputStatus}
        inputConfig={inputConfig}
        config={userData.config}
        onSettingsClick={() => setIsSettingsModalOpen(true)}
        isMuted={isSequencerMuted}
        onMuteChange={setIsSequencerMuted}
        isProjectorReady={isProjectorReady}
      />

      <DashboardModalLayer
        isCreateTrackOpen={isCreateTrackOpen}
        setIsCreateTrackOpen={setIsCreateTrackOpen}
        isCreateSetOpen={isCreateSetOpen}
        setIsCreateSetOpen={setIsCreateSetOpen}
        isSelectTrackModalOpen={isSelectTrackModalOpen}
        setIsSelectTrackModalOpen={setIsSelectTrackModalOpen}
        isSelectSetModalOpen={isSelectSetModalOpen}
        setIsSelectSetModalOpen={setIsSelectSetModalOpen}
        isSettingsModalOpen={isSettingsModalOpen}
        setIsSettingsModalOpen={setIsSettingsModalOpen}
        isInputMappingsModalOpen={isInputMappingsModalOpen}
        setIsInputMappingsModalOpen={setIsInputMappingsModalOpen}
        isReleaseNotesOpen={isReleaseNotesOpen}
        setIsReleaseNotesOpen={setIsReleaseNotesOpen}
        isAddModuleModalOpen={isAddModuleModalOpen}
        setIsAddModuleModalOpen={setIsAddModuleModalOpen}
        isManageModulesModalOpen={isManageModulesModalOpen}
        setIsManageModulesModalOpen={setIsManageModulesModalOpen}
        isDebugOverlayOpen={isDebugOverlayOpen}
        setIsDebugOverlayOpen={setIsDebugOverlayOpen}
        userData={userData}
        setUserData={setUserData}
        recordingData={recordingData}
        setRecordingData={setRecordingData}
        activeTrackId={activeTrackId}
        setActiveTrackId={setActiveTrackId}
        activeSetId={activeSetId}
        setActiveSetId={setActiveSetId}
        inputConfig={inputConfig}
        setInputConfig={setInputConfig}
        availableMidiDevices={availableMidiDevices}
        settings={settings}
        aspectRatio={aspectRatio}
        setAspectRatio={setAspectRatio}
        bgColor={bgColor}
        setBgColor={setBgColor}
        updateConfig={updateConfig}
        workspacePath={workspacePath}
        onSelectWorkspace={handleSelectWorkspace}
        predefinedModules={predefinedModules}
        selectedTrackForModuleMenu={selectedTrackForModuleMenu}
        setSelectedTrackForModuleMenu={setSelectedTrackForModuleMenu}
        onCreateNewModule={handleCreateNewModule}
        onEditModule={handleEditModule}
        isModuleEditorOpen={isModuleEditorOpen}
        onCloseModuleEditor={handleCloseModuleEditor}
        editingModuleName={editingModuleName}
        editingTemplateType={editingTemplateType}
        isNewModuleDialogOpen={isNewModuleDialogOpen}
        onCloseNewModuleDialog={() => setIsNewModuleDialogOpen(false)}
        onCreateModule={handleCreateModule}
        debugLogs={debugLogs}
        perfStats={perfStats}
        selectedChannel={selectedChannel}
        setSelectedChannel={setSelectedChannel}
        onEditChannel={handleEditChannel}
        onDeleteChannel={handleDeleteChannel}
        workspaceModuleFiles={workspaceModuleFiles}
        workspaceModuleLoadFailures={workspaceModuleLoadFailures}
        editChannelModalState={editChannelModalState}
        setEditChannelModalState={setEditChannelModalState}
        confirmationModal={confirmationModal}
        setConfirmationModal={setConfirmationModal}
        openAlertModal={openAlertModal}
        openConfirmationModal={openConfirmationModal}
      />

      <WorkspaceGateModal
        isOpen={isWorkspaceModalOpen}
        mode={workspaceModalMode}
        workspacePath={workspacePath}
        workspaceModalPath={workspaceModalPath}
        onSelectWorkspace={handleSelectWorkspace}
      />
    </div>
  );
};

// =========================
// Render the Dashboard
// =========================

const rootElement = document.getElementById("dashboard") || document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <ErrorBoundary>
      <Dashboard />
    </ErrorBoundary>
  );
}

export default Dashboard;

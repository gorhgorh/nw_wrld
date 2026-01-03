// Dashboard.js
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { createRoot } from "react-dom/client";
import { atom, useAtom } from "jotai";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import {
  FaBars,
  FaCog,
  FaCode,
  FaMusic,
  FaPlus,
  FaPlay,
  FaStop,
  FaTrash,
  FaEdit,
} from "react-icons/fa";
import { produce } from "immer";
import * as Tone from "tone";
import {
  noteNameToNumber,
  resolveChannelTrigger,
} from "../shared/midi/midiUtils.js";
import { loadSettings } from "../shared/json/configUtils.js";
import {
  loadRecordingData,
  saveRecordingData,
  saveRecordingDataSync,
  getRecordingForTrack,
  setRecordingForTrack,
  getSequencerForTrack,
  setSequencerForTrack,
} from "../shared/json/recordingUtils.js";
import {
  loadAppState,
  loadAppStateSync,
  saveAppState,
  saveAppStateSync,
} from "../shared/json/appStateUtils.js";
import MidiPlayback from "../shared/midi/midiPlayback.js";
import SequencerPlayback from "../shared/sequencer/SequencerPlayback.js";
import SequencerAudio from "../shared/audio/sequencerAudio.js";
import { getActiveSetTracks } from "../shared/utils/setUtils.js";
import { Checkbox } from "./components/FormInputs.js";
import { Button } from "./components/Button.js";
import { HelpIcon } from "./components/HelpIcon.js";
import { ModalHeader } from "./components/ModalHeader.js";
import { ModalFooter } from "./components/ModalFooter.js";
import { ModuleEditorModal } from "./components/ModuleEditorModal.js";
import { NewModuleDialog } from "./components/NewModuleDialog.js";
import {
  loadUserData,
  saveUserData,
  saveUserDataSync,
  updateUserData,
  updateActiveSet,
} from "./core/utils.js";
import {
  useIPCSend,
  useIPCListener,
  useIPCInvoke,
} from "./core/hooks/useIPC.js";
import {
  userDataAtom,
  recordingDataAtom,
  activeTrackIdAtom,
  activeSetIdAtom,
  selectedChannelAtom,
  flashingChannelsAtom,
  flashingConstructorsAtom,
  recordingStateAtom,
  useFlashingChannels,
} from "./core/state.js";
import { Modal } from "./shared/Modal.jsx";
import { ConfirmationModal } from "./modals/ConfirmationModal.jsx";
import { DebugOverlayModal } from "./modals/DebugOverlayModal.jsx";
import { EditSetModal } from "./modals/EditSetModal.jsx";
import { CreateSetModal } from "./modals/CreateSetModal.jsx";
import { CreateTrackModal } from "./modals/CreateTrackModal.jsx";
import { EditTrackModal } from "./modals/EditTrackModal.jsx";
import { EditChannelModal } from "./modals/EditChannelModal.jsx";
import { AddModuleModal } from "./modals/AddModuleModal.jsx";
import { SettingsModal } from "./modals/SettingsModal.jsx";
import { InputMappingsModal } from "./modals/InputMappingsModal.jsx";
import { SelectSetModal } from "./modals/SelectSetModal.jsx";
import { SelectTrackModal } from "./modals/SelectTrackModal.jsx";
import { MethodConfiguratorModal } from "./modals/MethodConfiguratorModal.jsx";
import { TrackItem } from "./components/track/TrackItem.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";

const PROJECT_DIR_ARG_PREFIX = "--nwWrldProjectDir=";
const getProjectDirFromArgv = () => {
  const arg = (process.argv || []).find((a) =>
    a.startsWith(PROJECT_DIR_ARG_PREFIX)
  );
  if (!arg) return null;
  const value = arg.slice(PROJECT_DIR_ARG_PREFIX.length);
  return value || null;
};

const isExistingDirectory = (dirPath) => {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
};

// =========================
// Components
// =========================

const DashboardHeader = ({
  onSets,
  onTracks,
  onModules,
  onSettings,
  onDebugOverlay,
}) => {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-[#101010] border-b border-neutral-800 px-6 py-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-6">
          <Button onClick={onSets} icon={<FaBars />}>
            SETS
          </Button>
          <Button onClick={onTracks} icon={<FaMusic />}>
            TRACKS
          </Button>
          <Button onClick={onModules} icon={<FaCode />}>
            MODULES
          </Button>
          <Button onClick={onSettings} icon={<FaCog />}>
            SETTINGS
          </Button>
          <Button onClick={onDebugOverlay} icon={<FaCode />}>
            DEBUG
          </Button>
        </div>
        <div className="flex items-center gap-6">
          <div className="opacity-50 text-[11px] text-neutral-300">nw_wrld</div>
        </div>
      </div>
    </div>
  );
};

const DashboardFooter = ({
  track,
  isPlaying,
  onPlayPause,
  onStop,
  inputStatus,
  inputConfig,
  onSettingsClick,
  config,
  isMuted,
  onMuteChange,
  isProjectorReady,
}) => {
  const [recordingData] = useAtom(recordingDataAtom);

  const getStatusColor = () => {
    switch (inputStatus.status) {
      case "connected":
        return "text-green-500";
      case "connecting":
        return "text-yellow-500";
      case "error":
        return "text-red-500";
      default:
        return "text-neutral-500";
    }
  };

  const getStatusIcon = () => {
    switch (inputStatus.status) {
      case "connected":
        return "●";
      case "connecting":
        return "◐";
      case "error":
        return "✕";
      default:
        return "○";
    }
  };

  const getStatusText = () => {
    if (inputStatus?.message && inputStatus.message !== "") {
      return inputStatus.message;
    }

    if (inputStatus?.config?.input) {
      const activeInput = inputStatus.config.input;
      if (activeInput.type === "osc") {
        return `Listening on Port ${activeInput.port || 8000}`;
      } else if (activeInput.type === "midi") {
        return `MIDI: ${activeInput.deviceName || "Not configured"}`;
      }
    }

    if (inputConfig?.type === "osc") {
      return `Listening on Port ${inputConfig.port || 8000}`;
    } else if (inputConfig?.type === "midi") {
      return `MIDI: ${inputConfig.deviceName || "Not configured"}`;
    }

    return "No input";
  };

  if (!track) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#101010] border-t border-neutral-800 px-6 py-4">
        <div className="w-full flex justify-start gap-4 items-center">
          <div className="text-neutral-300/30 text-[11px]">
            No track selected
          </div>
          {!config?.sequencerMode && (
            <button
              onClick={onSettingsClick}
              className={`text-[10px] font-mono flex items-center gap-2 cursor-pointer hover:opacity-70 transition-opacity ${getStatusColor()}`}
              title={`${inputStatus.status}: ${getStatusText()}`}
            >
              <span>{getStatusIcon()}</span>
              <span>{getStatusText()}</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#101010]">
      <div className="border-t border-neutral-800 py-4 px-6">
        <div className="flex justify-start items-start">
          <div className="text-[10px] text-neutral-600 font-mono leading-tight">
            <span>
              nw_wrld is developed & maintained by{" "}
              <a
                target="_blank"
                rel="noopener noreferrer"
                href="https://daniel.aagentah.tech/"
                className="underline"
              >
                Daniel Aagentah
              </a>{" "}
              [Open-sourced under GPL-3.0 license.]
            </span>
          </div>
        </div>
      </div>

      <div className="border-t border-neutral-800 py-4 px-6">
        <div className="w-full flex justify-start gap-4 items-center">
          {config?.sequencerMode ? (
            <>
              <Button
                onClick={isPlaying ? onStop : onPlayPause}
                className={isPlaying ? "decoration-neutral-300" : ""}
                title={isPlaying ? "Stop playback" : "Play sequencer"}
                icon={isPlaying ? <FaStop /> : <FaPlay />}
                disabled={!isProjectorReady && !isPlaying}
                as="button"
              >
                <span className="relative inline-block">
                  {isPlaying ? "STOP" : "PLAY"}
                </span>
              </Button>
              <label className="flex items-center gap-2 cursor-pointer text-[11px] text-neutral-300 font-mono">
                <Checkbox
                  checked={isMuted}
                  onChange={(e) => onMuteChange(e.target.checked)}
                />
                <span>Mute</span>
              </label>
            </>
          ) : (
            <button
              onClick={onSettingsClick}
              className={`text-[10px] font-mono flex items-center gap-2 cursor-pointer hover:opacity-70 transition-opacity ${getStatusColor()}`}
              title={`${inputStatus.status}: ${getStatusText()}`}
            >
              <span>{getStatusIcon()}</span>
              <span>{getStatusText()}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const Dashboard = () => {
  const [userData, setUserData] = useAtom(userDataAtom);
  const [recordingData, setRecordingData] = useAtom(recordingDataAtom);
  const [activeTrackId, setActiveTrackId] = useAtom(activeTrackIdAtom);
  const [activeSetId, setActiveSetId] = useAtom(activeSetIdAtom);
  const [predefinedModules, setPredefinedModules] = useState([]);
  const [selectedChannel, setSelectedChannel] = useAtom(selectedChannelAtom);
  const [selectedTrackForModuleMenu, setSelectedTrackForModuleMenu] =
    useState(null);
  const [flashingChannels, flashChannel] = useFlashingChannels();
  const [flashingConstructors, setFlashingConstructors] = useAtom(
    flashingConstructorsAtom
  );

  const sendToProjector = useIPCSend("dashboard-to-projector");
  const invokeIPC = useIPCInvoke();

  // Module editor states
  const [isModuleEditorOpen, setIsModuleEditorOpen] = useState(false);
  const [editingModuleName, setEditingModuleName] = useState(null);
  const [editingTemplateType, setEditingTemplateType] = useState(null);
  const [isNewModuleDialogOpen, setIsNewModuleDialogOpen] = useState(false);

  const userDataRef = useRef(userData);
  useEffect(() => {
    userDataRef.current = userData;
  }, [userData]);

  const recordingDataRef = useRef(recordingData);
  useEffect(() => {
    recordingDataRef.current = recordingData;
  }, [recordingData]);

  const activeTrackIdRef = useRef(activeTrackId);
  const activeSetIdRef = useRef(activeSetId);
  const workspacePathRef = useRef(workspacePath);
  useEffect(() => {
    activeTrackIdRef.current = activeTrackId;
    activeSetIdRef.current = activeSetId;
    workspacePathRef.current = workspacePath;
  }, [activeTrackId, activeSetId, workspacePath]);

  // Recording state management
  const [recordingState, setRecordingState] = useAtom(recordingStateAtom);
  const recordingStateRef = useRef(recordingState);
  useEffect(() => {
    recordingStateRef.current = recordingState;
  }, [recordingState]);

  // Memoized trigger maps to avoid recomputing on every input event
  const triggerMapsRef = useRef({ trackTriggersMap: {}, channelMappings: {} });
  useEffect(() => {
    const tracks = getActiveSetTracks(userData, activeSetId);
    const globalMappings = userData?.config || {};
    const inputType = globalMappings.input?.type || "midi";
    const { buildMidiConfig } = require("../shared/midi/midiUtils.js");
    triggerMapsRef.current = buildMidiConfig(tracks, globalMappings, inputType);
  }, [userData?.sets, userData?.config?.input, activeSetId]);

  // Track pending save timeouts for cancellation
  const userDataSaveTimeoutRef = useRef(null);
  const recordingDataSaveTimeoutRef = useRef(null);

  useEffect(() => {
    if (isInitialMount.current) {
      return;
    }

    if (!userDataLoadedSuccessfully.current) {
      return;
    }

    const debouncedSave = setTimeout(async () => {
      await saveUserData(userData);
      userDataSaveTimeoutRef.current = null;

      const tracks = getActiveSetTracks(userData, activeSetId);
      const track = tracks.find((t) => t.id === activeTrackId);

      sendToProjector("reload-data", {
        setId: activeSetId,
        trackName: track?.name || null,
      });
    }, 500);
    userDataSaveTimeoutRef.current = debouncedSave;
    return () => clearTimeout(debouncedSave);
  }, [userData, activeSetId, activeTrackId, sendToProjector]);

  useEffect(() => {
    if (isInitialMount.current) {
      return;
    }

    const debouncedSave = setTimeout(async () => {
      await saveRecordingData(recordingData);
      recordingDataSaveTimeoutRef.current = null;
    }, 500);
    recordingDataSaveTimeoutRef.current = debouncedSave;
    return () => clearTimeout(debouncedSave);
  }, [recordingData]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      try {
        if (isInitialMount.current) {
          return;
        }

        // Cancel any pending async saves
        if (userDataSaveTimeoutRef.current) {
          clearTimeout(userDataSaveTimeoutRef.current);
          userDataSaveTimeoutRef.current = null;
        }
        if (recordingDataSaveTimeoutRef.current) {
          clearTimeout(recordingDataSaveTimeoutRef.current);
          recordingDataSaveTimeoutRef.current = null;
        }

        // Now do sync saves with latest state
        saveUserDataSync(userDataRef.current);
        saveRecordingDataSync(recordingDataRef.current);
        const currentAppState = loadAppStateSync();
        const appStateToSave = {
          ...currentAppState,
          activeTrackId: activeTrackIdRef.current,
          activeSetId: activeSetIdRef.current,
          sequencerMuted: sequencerMutedRef.current,
          workspacePath: workspacePathRef.current,
        };
        saveAppStateSync(appStateToSave);
      } catch (e) {
        console.error("Failed to persist data on unload:", e);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const [aspectRatio, setAspectRatio] = useState("landscape");
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
  const [isManageModulesModalOpen, setIsManageModulesModalOpen] =
    useState(false);
  const [isDebugOverlayOpen, setIsDebugOverlayOpen] = useState(false);
  const [isInputMappingsModalOpen, setIsInputMappingsModalOpen] =
    useState(false);
  const [confirmationModal, setConfirmationModal] = useState(null);
  const [debugLogs, setDebugLogs] = useState([]);
  const [footerPlaybackState, setFooterPlaybackState] = useState({});
  const [isSequencerPlaying, setIsSequencerPlaying] = useState(false);
  const [sequencerCurrentStep, setSequencerCurrentStep] = useState(0);
  const [isSequencerMuted, setIsSequencerMuted] = useState(false);
  const [isProjectorReady, setIsProjectorReady] = useState(false);
  const [workspacePath, setWorkspacePath] = useState(null);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [workspaceModalMode, setWorkspaceModalMode] = useState("initial");
  const [workspaceModalPath, setWorkspaceModalPath] = useState(null);
  const [workspaceModuleFiles, setWorkspaceModuleFiles] = useState([]);
  const [workspaceModuleLoadFailures, setWorkspaceModuleLoadFailures] =
    useState([]);
  const sequencerEngineRef = useRef(null);
  const sequencerAudioRef = useRef(null);
  const sequencerMutedRef = useRef(false);
  const sequencerRunIdRef = useRef(0);
  const [editChannelModalState, setEditChannelModalState] = useState({
    isOpen: false,
    trackIndex: null,
    channelNumber: null,
  });

  useEffect(() => {
    sequencerMutedRef.current = isSequencerMuted;
  }, [isSequencerMuted]);

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
  const footerPlaybackEngineRef = useRef({});

  useEffect(() => {
    if (isInitialMount.current) {
      return;
    }

    if (sequencerEngineRef.current) {
      sequencerEngineRef.current.stop();
      if (typeof sequencerEngineRef.current.getRunId === "function") {
        sequencerRunIdRef.current = sequencerEngineRef.current.getRunId();
      }
      setIsSequencerPlaying(false);
      setSequencerCurrentStep(0);
    }

    Object.entries(footerPlaybackEngineRef.current).forEach(
      ([trackId, engine]) => {
        if (engine) {
          engine.stop();
        }
      }
    );
    setFooterPlaybackState({});

    const tracks = getActiveSetTracks(userDataRef.current || {}, activeSetId);
    const track = tracks.find((t) => t.id === activeTrackId);

    if (track) {
      setIsProjectorReady(false);
      sendToProjector("set-activate", {
        setId: activeSetId,
      });
      sendToProjector("track-activate", {
        trackName: track.name,
      });
    } else {
      setIsProjectorReady(true);
    }
  }, [activeTrackId, activeSetId, sendToProjector]);

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
      openConfirmationModal(
        `Are you sure you want to delete Channel ${channelNumber}?`,
        () => {
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
        }
      );
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

  useIPCListener("input-status", (event, statusPayload) => {
    setInputStatus(statusPayload.data);
  });

  // Initialize settings when userData loads (but don't overwrite user changes from settings modal)
  useEffect(() => {
    if (userData.config) {
      setAspectRatio(userData.config.aspectRatio || "landscape");
      setBgColor(userData.config.bgColor || "grey");
    }
  }, [userData]);

  useEffect(() => {
    updateUserData(setUserData, (draft) => {
      draft.config.aspectRatio = aspectRatio;
    });
  }, [aspectRatio]);

  useEffect(() => {
    updateUserData(setUserData, (draft) => {
      draft.config.bgColor = bgColor;
    });
  }, [bgColor]);

  useEffect(() => {
    if (isInitialMount.current) {
      return;
    }

    const updateAppState = async () => {
      const currentState = await loadAppState();
      const preservedWorkspacePath =
        workspacePathRef.current ?? currentState.workspacePath ?? null;
      const stateToSave = {
        ...currentState,
        activeTrackId,
        activeSetId,
        sequencerMuted: isSequencerMuted,
        workspacePath: preservedWorkspacePath,
      };
      await saveAppState(stateToSave);
    };
    updateAppState();
  }, [isSequencerMuted, activeTrackId, activeSetId]);

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

  useIPCListener("from-projector", (event, data) => {
    if (data.type === "debug-log") {
      const logEntries = data.log.split("\n\n").filter((entry) => entry.trim());
      setDebugLogs((prev) => {
        const newLogs = [...prev, ...logEntries];
        return newLogs.slice(-200);
      });
    }
  });

  useEffect(() => {
    sendToProjector("debug-overlay-visibility", {
      isOpen: isDebugOverlayOpen,
    });
  }, [isDebugOverlayOpen, sendToProjector]);

  const addDebugLog = useCallback((log) => {
    setDebugLogs((prev) => {
      const newLogs = [...prev, log];
      return newLogs.slice(-200);
    });
  }, []);

  const formatDebugLog = useCallback((eventData) => {
    const {
      timestamp,
      type,
      source,
      data,
      trackName,
      moduleInfo,
      methodInfo,
      props,
    } = eventData;
    const timeStr = timestamp.toFixed(5);
    const sourceLabel =
      source === "midi" ? "MIDI" : source === "osc" ? "OSC" : "Input";
    const eventTypeLabel =
      type === "track-selection" ? "Track Selection" : "Channel Trigger";

    let log = `[${timeStr}] ${sourceLabel} ${eventTypeLabel}\n`;

    if (source === "midi") {
      if (type === "track-selection") {
        log += `  Note: ${data.note}\n`;
        log += `  Channel: ${data.channel || 1}\n`;
      } else {
        log += `  Note: ${data.note}\n`;
        log += `  Channel: ${data.channel}\n`;
      }
    } else if (source === "osc") {
      if (data.address) {
        log += `  Address: ${data.address}\n`;
      }
      if (data.identifier) {
        log += `  Identifier: ${data.identifier}\n`;
      }
      if (data.channelName) {
        log += `  Channel: ${data.channelName}\n`;
      }
      if (data.value !== undefined) {
        log += `  Value: ${data.value}\n`;
      }
    }

    if (trackName) {
      log += `  Track: ${trackName}\n`;
    }
    if (moduleInfo) {
      log += `  Module: ${moduleInfo.instanceId} (${moduleInfo.type})\n`;
    }
    if (methodInfo) {
      log += `  Method: ${methodInfo.name}\n`;
    }
    if (props && Object.keys(props).length > 0) {
      log += `  Props: ${JSON.stringify(props, null, 2)}\n`;
    }
    return log;
  }, []);

  // Initialize Input Event Listener for visual feedback
  const handleInputEvent = useCallback(
    (event, payload) => {
      const { type, data } = payload;
      const timestamp = data.timestamp || performance.now() / 1000;

      const tracks = getActiveSetTracks(
        userDataRef.current || {},
        activeSetIdRef.current
      );
      let trackName = null;
      let moduleInfo = null;
      let methodInfo = null;
      let props = null;

      switch (type) {
        case "track-selection": {
          let resolvedTrackName = null;

          if (data.source === "midi") {
            resolvedTrackName =
              triggerMapsRef.current.trackTriggersMap[data.note];
          } else if (data.source === "osc") {
            resolvedTrackName =
              triggerMapsRef.current.trackTriggersMap[data.identifier];
          }

          if (resolvedTrackName) {
            const targetTrack = tracks.find(
              (t) => t.name === resolvedTrackName
            );
            if (targetTrack) {
              trackName = targetTrack.name;
              setActiveTrackId(targetTrack.id);

              const wasRecording = recordingStateRef.current[targetTrack.id];
              if (wasRecording) {
                setRecordingData((prev) =>
                  setRecordingForTrack(prev, targetTrack.id, { channels: [] })
                );
              }

              setRecordingState((prev) => ({
                ...prev,
                [targetTrack.id]: {
                  startTime: Date.now(),
                  isRecording: true,
                },
              }));

              if (Array.isArray(targetTrack.modules)) {
                const keys = targetTrack.modules.map(
                  (moduleInstance) => `${targetTrack.id}:${moduleInstance.id}`
                );
                setFlashingConstructors((prev) => {
                  const next = new Set(prev);
                  keys.forEach((k) => next.add(k));
                  return next;
                });
                setTimeout(() => {
                  setFlashingConstructors((prev) => {
                    const next = new Set(prev);
                    keys.forEach((k) => next.delete(k));
                    return next;
                  });
                }, 100);
              }
            }
          }
          break;
        }

        case "method-trigger":
          const currentActiveTrackId = activeTrackIdRef.current;
          const activeTrack = tracks.find((t) => t.id === currentActiveTrackId);

          if (activeTrack && activeTrack.channelMappings) {
            let channelsToFlash = [];
            const globalMappings = userDataRef.current?.config || {};
            const currentInputType = globalMappings.input?.type || "midi";

            if (data.source === "midi") {
              const trigger = data.note;
              Object.entries(activeTrack.channelMappings).forEach(
                ([channelNumber, slotNumber]) => {
                  const resolvedTrigger = resolveChannelTrigger(
                    slotNumber,
                    currentInputType,
                    globalMappings
                  );
                  const triggerNum = noteNameToNumber(resolvedTrigger);
                  if (triggerNum === trigger) {
                    channelsToFlash.push(channelNumber);
                  }
                }
              );
            } else if (data.source === "osc" && data.channelName) {
              Object.entries(activeTrack.channelMappings).forEach(
                ([channelNumber, slotNumber]) => {
                  const resolvedTrigger = resolveChannelTrigger(
                    slotNumber,
                    currentInputType,
                    globalMappings
                  );
                  if (resolvedTrigger === data.channelName) {
                    channelsToFlash.push(channelNumber);
                  }
                }
              );
            }

            channelsToFlash.forEach((channel) => {
              flashChannel(channel, 100);
            });

            if (currentActiveTrackId && channelsToFlash.length > 0) {
              const recordingStateForTrack =
                recordingStateRef.current[currentActiveTrackId];
              if (recordingStateForTrack?.isRecording) {
                const currentTime = Date.now();
                const relativeTime =
                  (currentTime - recordingStateForTrack.startTime) / 1000;

                channelsToFlash.forEach((channelNumber) => {
                  const channelName = `ch${channelNumber}`;
                  setRecordingData((prev) => {
                    const recording = getRecordingForTrack(
                      prev,
                      currentActiveTrackId
                    );
                    const newRecording = { ...recording };

                    if (!newRecording.channels) {
                      newRecording.channels = [];
                    }

                    const channelIndex = newRecording.channels.findIndex(
                      (ch) => ch.name === channelName
                    );

                    if (channelIndex === -1) {
                      newRecording.channels.push({
                        name: channelName,
                        sequences: [{ time: relativeTime, duration: 0.1 }],
                      });
                    } else {
                      newRecording.channels[channelIndex].sequences.push({
                        time: relativeTime,
                        duration: 0.1,
                      });
                    }

                    return setRecordingForTrack(
                      prev,
                      currentActiveTrackId,
                      newRecording
                    );
                  });
                });
              }
            }
          }
          break;
      }

      const log = formatDebugLog({
        timestamp,
        type,
        source: data.source,
        data,
        trackName,
        moduleInfo,
        methodInfo,
        props,
      });
      addDebugLog(log);
    },
    [
      flashChannel,
      formatDebugLog,
      addDebugLog,
      setActiveTrackId,
      setRecordingData,
      setRecordingState,
      setFlashingConstructors,
    ]
  );

  useIPCListener("input-event", handleInputEvent);

  useIPCListener("from-projector", (event, data) => {
    if (data.type === "projector-ready") {
      setIsProjectorReady(true);
    }
  });

  const ipcInvoke = useIPCInvoke();

  const pauseAllPlayback = useCallback(() => {
    if (sequencerEngineRef.current) {
      sequencerEngineRef.current.stop();
      if (typeof sequencerEngineRef.current.getRunId === "function") {
        sequencerRunIdRef.current = sequencerEngineRef.current.getRunId();
      }
      setIsSequencerPlaying(false);
      setSequencerCurrentStep(0);
    }

    Object.entries(footerPlaybackEngineRef.current).forEach(
      ([trackId, engine]) => {
        if (engine) {
          engine.stop();
        }
      }
    );
    setFooterPlaybackState({});
  }, []);

  const loadModules = useCallback(async () => {
    try {
      if (isWorkspaceModalOpen) return;
      const projectDirArg = getProjectDirFromArgv();
      if (!projectDirArg) return;
      if (!workspacePath) return;
      if (workspacePath) {
        const modulesDir = path.join(workspacePath, "modules");
        let entries = [];
        let hadImportError = false;
        const loadFailures = new Set();
        try {
          entries = await fs.promises.readdir(modulesDir);
        } catch {
          entries = [];
        }
        const jsFiles = entries.filter((f) => f.endsWith(".js"));
        setWorkspaceModuleFiles(
          jsFiles.map((f) => path.basename(f, ".js")).filter(Boolean)
        );

        const modules = await Promise.all(
          jsFiles.map(async (file) => {
            const fullPath = path.join(modulesDir, file);
            try {
              let mtimeMs = Date.now();
              try {
                mtimeMs = (await fs.promises.stat(fullPath)).mtimeMs;
              } catch {}
              const fileUrl = `${pathToFileURL(fullPath).href}?t=${mtimeMs}`;
              const imported = await import(/* webpackIgnore: true */ fileUrl);
              const mod = imported?.default || imported;
              if (!mod?.name) {
                console.warn(
                  `Skipping module ${file}: missing required static property "name".`
                );
                return null;
              }
              return {
                name: mod.name,
                category: mod.category || "Undefined",
                methods: mod.methods || [],
              };
            } catch (e) {
              hadImportError = true;
              loadFailures.add(path.basename(file, ".js"));
              console.error(`Error loading workspace module ${file}:`, e);
              return null;
            }
          })
        );

        const validModules = modules.filter(Boolean);
        setPredefinedModules(validModules);
        setWorkspaceModuleLoadFailures(Array.from(loadFailures));
        setIsProjectorReady(false);
        sendToProjector("refresh-projector", {});
        return;
      }
    } catch (error) {
      console.error("❌ [Dashboard] Error loading modules:", error);
      alert("Failed to load modules from ../projector/modules folder.");
    }
  }, [isWorkspaceModalOpen, sendToProjector, workspacePath]);

  useEffect(() => {
    loadModules();
  }, [loadModules]);

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

  // Accept HMR updates for modules context so dashboard doesn't full reload
  useEffect(() => {
    try {
      if (workspacePath) return;
      // Create a stable context reference purely for HMR subscription
      const hmrContext = require.context(
        "../projector/modules",
        false,
        /\.js$/
      );
      if (
        module &&
        module.hot &&
        hmrContext &&
        typeof hmrContext.id !== "undefined"
      ) {
        module.hot.accept(hmrContext.id, () => {
          loadModules();
        });
      }
      // Also accept changes to base helpers that affect available methods
      if (module && module.hot) {
        try {
          module.hot.accept("../projector/helpers/moduleBase.js", () => {
            loadModules();
          });
        } catch {}
        try {
          module.hot.accept("../projector/helpers/threeBase.js", () => {
            loadModules();
          });
        } catch {}
      }
    } catch (e) {
      console.warn(
        "⚠️ [HMR] Unable to register HMR for modules context:",
        e.message
      );
    }
  }, [loadModules, workspacePath]);

  const isInitialMount = useRef(true);
  const userDataLoadedSuccessfully = useRef(false);

  // Load userData and appState from JSON files on mount
  useEffect(() => {
    const initializeUserData = async () => {
      const data = await loadUserData();

      if (data?._loadedSuccessfully) {
        userDataLoadedSuccessfully.current = true;
      }

      const recordings = await loadRecordingData();

      const appState = await loadAppState();
      let activeTrackIdToUse = appState.activeTrackId;
      let activeSetIdToUse = appState.activeSetId;
      let sequencerMutedToUse = appState.sequencerMuted;
      const projectDir = getProjectDirFromArgv();
      const workspacePathToUse = projectDir || null;
      workspacePathRef.current = workspacePathToUse;
      setIsSequencerMuted(Boolean(sequencerMutedToUse));
      setWorkspacePath(workspacePathToUse);
      if (!workspacePathToUse) {
        setWorkspaceModalMode("initial");
        setWorkspaceModalPath(null);
        setIsWorkspaceModalOpen(true);
      } else if (!isExistingDirectory(workspacePathToUse)) {
        setWorkspaceModalMode("lostSync");
        setWorkspaceModalPath(workspacePathToUse);
        setIsWorkspaceModalOpen(true);
      }

      if (activeSetIdToUse) {
        setActiveSetId(activeSetIdToUse);
      }

      const tracksFromData = getActiveSetTracks(data, activeSetIdToUse);

      setUserData(data);
      setRecordingData(recordings);

      if (data.config && data.config.input) {
        setInputConfig(data.config.input);
      }

      const tracks = getActiveSetTracks(data, activeSetIdToUse);
      if (tracks.length > 0) {
        const storedTrack = activeTrackIdToUse
          ? tracks.find((t) => t.id === activeTrackIdToUse)
          : null;

        if (storedTrack) {
          setActiveTrackId(storedTrack.id);
        } else {
          const visibleTrack = tracks.find((t) => t.isVisible);
          const firstTrack = visibleTrack || tracks[0];
          setActiveTrackId(firstTrack.id);
        }
      }

      isInitialMount.current = false;
    };

    initializeUserData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useIPCListener("workspace:lostSync", (event, payload) => {
    const lostPath = payload?.workspacePath || workspacePathRef.current || null;
    setWorkspaceModalMode("lostSync");
    setWorkspaceModalPath(lostPath);
    setIsWorkspaceModalOpen(true);
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

  const updateConfig = useCallback(
    (updates) => {
      setUserData(
        produce((draft) => {
          if (!draft.config) {
            draft.config = {};
          }
          Object.assign(draft.config, updates);
        })
      );
    },
    [setUserData]
  );

  const handleSequencerToggle = useCallback(
    (channelName, stepIndex) => {
      if (!firstVisibleTrack) return;
      const { track } = firstVisibleTrack;

      setRecordingData(
        produce((draft) => {
          if (!draft[track.id]) {
            draft[track.id] = { channels: [], sequencer: { pattern: {} } };
          }
          if (!draft[track.id].sequencer) {
            draft[track.id].sequencer = { pattern: {} };
          }
          if (!draft[track.id].sequencer.pattern) {
            draft[track.id].sequencer.pattern = {};
          }
          if (
            !draft[track.id].sequencer.pattern[channelName] ||
            !Array.isArray(draft[track.id].sequencer.pattern[channelName])
          ) {
            draft[track.id].sequencer.pattern[channelName] = [];
          }

          const steps = draft[track.id].sequencer.pattern[channelName];
          const idx = steps.indexOf(stepIndex);

          if (idx > -1) {
            steps.splice(idx, 1);
          } else {
            steps.push(stepIndex);
            steps.sort((a, b) => a - b);
          }
        })
      );

      if (sequencerEngineRef.current && isSequencerPlaying) {
        const sequencerData = getSequencerForTrack(recordingData, track.id);
        const updatedPattern = { ...sequencerData.pattern };

        if (!updatedPattern[channelName]) {
          updatedPattern[channelName] = [];
        }

        const steps = [...updatedPattern[channelName]];
        const idx = steps.indexOf(stepIndex);

        if (idx > -1) {
          steps.splice(idx, 1);
        } else {
          steps.push(stepIndex);
          steps.sort((a, b) => a - b);
        }

        updatedPattern[channelName] = steps;

        const bpm = userData.config.sequencerBpm || 120;
        sequencerEngineRef.current.load(updatedPattern, bpm);
      }
    },
    [
      setRecordingData,
      firstVisibleTrack,
      recordingData,
      userData.config.sequencerBpm,
      isSequencerPlaying,
    ]
  );

  const handleFooterPlayPause = useCallback(async () => {
    if (!firstVisibleTrack) return;
    const { track, trackIndex } = firstVisibleTrack;
    const trackId = track.id;
    const config = userData.config;

    if (config.sequencerMode) {
      if (!sequencerEngineRef.current) {
        sequencerEngineRef.current = new SequencerPlayback();

        sequencerEngineRef.current.setOnStepCallback(
          (stepIndex, channels, time, runId) => {
            const hasScheduledTime =
              typeof time === "number" && Number.isFinite(time);

            if (
              typeof runId === "number" &&
              runId !== sequencerRunIdRef.current
            ) {
              return;
            }

            channels.forEach((channelName) => {
              if (sequencerAudioRef.current && !sequencerMutedRef.current) {
                const channelNumber = channelName.replace(/^ch/, "");
                sequencerAudioRef.current.playChannelBeep(
                  channelNumber,
                  hasScheduledTime ? time : undefined
                );
              }
            });

            if (hasScheduledTime) {
              const scheduledRunId = runId;
              Tone.Draw.schedule(() => {
                if (
                  typeof scheduledRunId === "number" &&
                  scheduledRunId !== sequencerRunIdRef.current
                ) {
                  return;
                }
                setSequencerCurrentStep(stepIndex);
                channels.forEach((channelName) => {
                  flashChannel(channelName, 100);
                  sendToProjector("channel-trigger", { channelName });
                });
              }, time);
            } else {
              setSequencerCurrentStep(stepIndex);
              channels.forEach((channelName) => {
                flashChannel(channelName, 100);
                sendToProjector("channel-trigger", { channelName });
              });
            }
          }
        );
      }

      if (!sequencerAudioRef.current) {
        sequencerAudioRef.current = new SequencerAudio();
      }

      if (!isSequencerPlaying) {
        const sequencerData = getSequencerForTrack(recordingData, track.id);
        const pattern = sequencerData.pattern || {};
        const bpm = config.sequencerBpm || 120;
        sequencerEngineRef.current.load(pattern, bpm);

        const keys = track.modules.map(
          (moduleInstance) => `${track.id}:${moduleInstance.id}`
        );
        setFlashingConstructors((prev) => {
          const next = new Set(prev);
          keys.forEach((k) => next.add(k));
          return next;
        });
        setTimeout(() => {
          setFlashingConstructors((prev) => {
            const next = new Set(prev);
            keys.forEach((k) => next.delete(k));
            return next;
          });
        }, 100);

        sendToProjector("track-activate", {
          trackName: track.name,
        });
        sequencerEngineRef.current.play();
        if (typeof sequencerEngineRef.current.getRunId === "function") {
          sequencerRunIdRef.current = sequencerEngineRef.current.getRunId();
        }
        setIsSequencerPlaying(true);
      }
    } else {
      const isPlaying = footerPlaybackState[trackId] || false;

      if (!footerPlaybackEngineRef.current[trackId]) {
        footerPlaybackEngineRef.current[trackId] = new MidiPlayback();

        footerPlaybackEngineRef.current[trackId].setOnNoteCallback(
          (channelName, midiNote) => {
            const channelNumber = channelName.replace(/^ch/, "");
            flashChannel(channelNumber, 100);

            sendToProjector("channel-trigger", {
              channelName: channelName,
            });
          }
        );

        footerPlaybackEngineRef.current[trackId].setOnStopCallback(() => {
          setFooterPlaybackState((prev) => ({ ...prev, [trackId]: false }));
        });

        try {
          const recording = getRecordingForTrack(recordingData, track.id);
          if (
            !recording ||
            !recording.channels ||
            recording.channels.length === 0
          ) {
            alert("No recording available. Trigger some channels first.");
            return;
          }

          const channels = recording.channels.map((ch) => ({
            name: ch.name,
            midi: 0,
            sequences: ch.sequences || [],
          }));

          const bpm = track.bpm || 120;
          footerPlaybackEngineRef.current[trackId].load(channels, bpm);
        } catch (error) {
          console.error("Error loading recording for playback:", error);
          alert(`Failed to load recording for playback: ${error.message}`);
          return;
        }
      }

      if (!isPlaying) {
        const keys = track.modules.map(
          (moduleInstance) => `${track.id}:${moduleInstance.id}`
        );
        setFlashingConstructors((prev) => {
          const next = new Set(prev);
          keys.forEach((k) => next.add(k));
          return next;
        });
        setTimeout(() => {
          setFlashingConstructors((prev) => {
            const next = new Set(prev);
            keys.forEach((k) => next.delete(k));
            return next;
          });
        }, 100);

        sendToProjector("track-activate", {
          trackName: track.name,
        });

        footerPlaybackEngineRef.current[trackId].play();
        setFooterPlaybackState((prev) => ({ ...prev, [trackId]: true }));
      }
    }
  }, [
    firstVisibleTrack,
    footerPlaybackState,
    flashChannel,
    setFlashingConstructors,
    userData.config,
    isSequencerPlaying,
    recordingData,
  ]);

  const handleFooterStop = useCallback(() => {
    if (!firstVisibleTrack) return;
    const config = userData.config;

    if (config.sequencerMode) {
      if (sequencerEngineRef.current) {
        sequencerEngineRef.current.stop();
        if (typeof sequencerEngineRef.current.getRunId === "function") {
          sequencerRunIdRef.current = sequencerEngineRef.current.getRunId();
        }
        setIsSequencerPlaying(false);
        setSequencerCurrentStep(0);
      }
    } else {
      const trackId = firstVisibleTrack.track.id;
      if (footerPlaybackEngineRef.current[trackId]) {
        footerPlaybackEngineRef.current[trackId].stop();
        setFooterPlaybackState((prev) => ({ ...prev, [trackId]: false }));
      }
    }
  }, [firstVisibleTrack, userData.config]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code !== "Space") return;

      const target = e.target;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (isTyping) return;

      const config = userData.config;
      if (!config.sequencerMode) return;

      e.preventDefault();

      if (isSequencerPlaying) {
        handleFooterStop();
      } else {
        handleFooterPlayPause();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    userData.config,
    isSequencerPlaying,
    handleFooterStop,
    handleFooterPlayPause,
  ]);

  useEffect(() => {
    return () => {
      Object.values(footerPlaybackEngineRef.current).forEach((engine) => {
        if (engine) {
          engine.stop();
        }
      });
    };
  }, []);

  useEffect(() => {
    Object.values(footerPlaybackEngineRef.current).forEach((engine) => {
      if (engine) {
        engine.stop();
      }
    });
    setFooterPlaybackState({});
  }, [activeTrackId]);

  return (
    <div className="relative bg-[#101010] font-mono h-screen flex flex-col">
      <DashboardHeader
        onSets={() => setIsSelectSetModalOpen(true)}
        onTracks={() => setIsSelectTrackModalOpen(true)}
        onModules={() => setIsManageModulesModalOpen(true)}
        onSettings={() => setIsSettingsModalOpen(true)}
        onDebugOverlay={() => setIsDebugOverlayOpen(true)}
      />

      <div className="flex-1 overflow-y-auto pt-12 pb-32">
        <div className="bg-[#101010] p-6 font-mono">
          {(() => {
            const tracks = getActiveSetTracks(userData, activeSetId);
            const hasActiveTrack =
              activeTrackId && tracks.find((t) => t.id === activeTrackId);

            if (!activeTrackId || !hasActiveTrack) {
              return (
                <div className="text-neutral-300/30 text-[11px]">
                  No tracks to display.
                </div>
              );
            }

            return (
              <div className="flex flex-col gap-8 px-8">
                {tracks
                  .filter((track) => track.id === activeTrackId)
                  .map((track) => {
                    const trackIndex = tracks.findIndex(
                      (t) => t.id === track.id
                    );
                    return (
                      <TrackItem
                        key={track.id}
                        track={track}
                        trackIndex={trackIndex}
                        predefinedModules={predefinedModules}
                        openRightMenu={openAddModuleModal}
                        onConfirmDelete={openConfirmationModal}
                        setActiveTrackId={setActiveTrackId}
                        inputConfig={inputConfig}
                        config={userData.config}
                        isSequencerPlaying={isSequencerPlaying}
                        sequencerCurrentStep={sequencerCurrentStep}
                        handleSequencerToggle={handleSequencerToggle}
                        workspacePath={workspacePath}
                        workspaceModuleFiles={workspaceModuleFiles}
                        workspaceModuleLoadFailures={
                          workspaceModuleLoadFailures
                        }
                      />
                    );
                  })}
              </div>
            );
          })()}
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

      <CreateTrackModal
        isOpen={isCreateTrackOpen}
        onClose={() => setIsCreateTrackOpen(false)}
        inputConfig={inputConfig}
        onAlert={openAlertModal}
      />
      <CreateSetModal
        isOpen={isCreateSetOpen}
        onClose={() => setIsCreateSetOpen(false)}
        onAlert={openAlertModal}
      />
      <SelectTrackModal
        isOpen={isSelectTrackModalOpen}
        onClose={() => setIsSelectTrackModalOpen(false)}
        userData={userData}
        setUserData={setUserData}
        activeTrackId={activeTrackId}
        setActiveTrackId={setActiveTrackId}
        activeSetId={activeSetId}
        recordingData={recordingData}
        setRecordingData={setRecordingData}
        onCreateTrack={() => {
          setIsSelectTrackModalOpen(false);
          setIsCreateTrackOpen(true);
        }}
        onConfirmDelete={openConfirmationModal}
      />
      <SelectSetModal
        isOpen={isSelectSetModalOpen}
        onClose={() => setIsSelectSetModalOpen(false)}
        userData={userData}
        setUserData={setUserData}
        activeTrackId={activeTrackId}
        setActiveTrackId={setActiveTrackId}
        activeSetId={activeSetId}
        setActiveSetId={setActiveSetId}
        recordingData={recordingData}
        setRecordingData={setRecordingData}
        onCreateSet={() => {
          setIsSelectSetModalOpen(false);
          setIsCreateSetOpen(true);
        }}
        onConfirmDelete={openConfirmationModal}
      />
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        aspectRatio={aspectRatio}
        setAspectRatio={setAspectRatio}
        bgColor={bgColor}
        setBgColor={setBgColor}
        settings={settings}
        inputConfig={inputConfig}
        setInputConfig={setInputConfig}
        availableMidiDevices={availableMidiDevices}
        onOpenMappings={() => {
          setIsSettingsModalOpen(false);
          setIsInputMappingsModalOpen(true);
        }}
        config={userData.config}
        updateConfig={updateConfig}
        workspacePath={workspacePath}
        onSelectWorkspace={handleSelectWorkspace}
      />
      <InputMappingsModal
        isOpen={isInputMappingsModalOpen}
        onClose={() => setIsInputMappingsModalOpen(false)}
      />
      <AddModuleModal
        isOpen={isAddModuleModalOpen}
        onClose={() => {
          setIsAddModuleModalOpen(false);
          setSelectedTrackForModuleMenu(null);
        }}
        trackIndex={selectedTrackForModuleMenu}
        userData={userData}
        setUserData={setUserData}
        predefinedModules={predefinedModules}
        onCreateNewModule={handleCreateNewModule}
        onEditModule={handleEditModule}
        mode="add-to-track"
      />
      <AddModuleModal
        isOpen={isManageModulesModalOpen}
        onClose={() => setIsManageModulesModalOpen(false)}
        trackIndex={null}
        userData={userData}
        setUserData={setUserData}
        predefinedModules={predefinedModules}
        onCreateNewModule={handleCreateNewModule}
        onEditModule={handleEditModule}
        mode="manage-modules"
      />
      <ModuleEditorModal
        isOpen={isModuleEditorOpen}
        onClose={handleCloseModuleEditor}
        moduleName={editingModuleName}
        templateType={editingTemplateType}
        onModuleSaved={null}
        predefinedModules={predefinedModules}
        workspacePath={workspacePath}
      />
      <NewModuleDialog
        isOpen={isNewModuleDialogOpen}
        onClose={() => setIsNewModuleDialogOpen(false)}
        onCreateModule={handleCreateModule}
        workspacePath={workspacePath}
      />
      <DebugOverlayModal
        isOpen={isDebugOverlayOpen}
        onClose={() => setIsDebugOverlayOpen(false)}
        debugLogs={debugLogs}
      />
      <MethodConfiguratorModal
        isOpen={!!selectedChannel}
        onClose={() => setSelectedChannel(null)}
        predefinedModules={predefinedModules}
        onEditChannel={handleEditChannel}
        onDeleteChannel={handleDeleteChannel}
        workspacePath={workspacePath}
        workspaceModuleFiles={workspaceModuleFiles}
        workspaceModuleLoadFailures={workspaceModuleLoadFailures}
      />
      <EditChannelModal
        isOpen={editChannelModalState.isOpen}
        onClose={() =>
          setEditChannelModalState({
            isOpen: false,
            trackIndex: null,
            channelNumber: null,
          })
        }
        trackIndex={editChannelModalState.trackIndex}
        channelNumber={editChannelModalState.channelNumber}
        inputConfig={inputConfig}
        config={userData.config}
      />
      <ConfirmationModal
        isOpen={!!confirmationModal}
        onClose={() => setConfirmationModal(null)}
        message={confirmationModal?.message || ""}
        onConfirm={confirmationModal?.onConfirm}
        type={confirmationModal?.type || "confirm"}
      />

      <Modal isOpen={isWorkspaceModalOpen} onClose={() => {}}>
        <ModalHeader
          title={
            workspaceModalMode === "lostSync"
              ? "PROJECT FOLDER NOT FOUND"
              : "OPEN PROJECT"
          }
          onClose={() => {}}
        />
        <div className="flex flex-col gap-4">
          <div className="text-neutral-300/70">
            {workspaceModalMode === "lostSync"
              ? "We lost sync with your project folder. It may have been moved or renamed. Reopen the project folder to continue."
              : "Open (or create) a project folder to begin. Your project folder contains your modules and performance data."}
          </div>
          {workspaceModalPath || workspacePath ? (
            <div className="text-neutral-300/50 break-all">
              {workspaceModalPath || workspacePath}
            </div>
          ) : null}
        </div>
        <ModalFooter>
          <div className="flex justify-end gap-3">
            <Button onClick={handleSelectWorkspace}>
              {workspaceModalMode === "lostSync"
                ? "REOPEN PROJECT"
                : "OPEN PROJECT"}
            </Button>
          </div>
        </ModalFooter>
      </Modal>
    </div>
  );
};

// =========================
// Render the Dashboard
// =========================

const rootElement =
  document.getElementById("dashboard") || document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <ErrorBoundary>
      <Dashboard />
    </ErrorBoundary>
  );
}

export default Dashboard;

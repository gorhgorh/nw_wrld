import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { getRecordingForTrack, setRecordingForTrack } from "../../../shared/json/recordingUtils";
import {
  buildMidiConfig,
  normalizeNoteMatchMode,
  noteNumberToTriggerKey,
  parseMidiTriggerValue,
  pitchClassToName,
  resolveChannelTrigger,
} from "../../../shared/midi/midiUtils";
import { getActiveSetTracks } from "../../../shared/utils/setUtils";
import { useIPCListener } from "./useIPC";

type TriggerMaps = ReturnType<typeof buildMidiConfig>;

type RecordingStateEntry = { startTime: number; isRecording: boolean };
type RecordingState = Record<string, RecordingStateEntry | undefined>;

export type LastInputEvent = {
  source: string;
  summary: string;
  type: string;
  ts: number;
};

type UseInputEventsArgs = {
  userData: unknown;
  activeSetId: unknown;
  userDataRef: MutableRefObject<unknown>;
  activeTrackIdRef: MutableRefObject<string | number | null>;
  activeSetIdRef: MutableRefObject<unknown>;
  recordingStateRef: MutableRefObject<RecordingState>;
  triggerMapsRef: MutableRefObject<TriggerMaps>;
  setActiveTrackId: (trackId: string | number) => void;
  setRecordingData: Dispatch<SetStateAction<Record<string, unknown>>>;
  setRecordingState: Dispatch<SetStateAction<RecordingState>>;
  flashChannel: (channel: string, durationMs: number) => void;
  setFlashingConstructors: Dispatch<SetStateAction<Set<string>>>;
  setInputStatus: (data: unknown) => void;
  setDebugLogs: Dispatch<SetStateAction<string[]>>;
  setLastInputEvents: Dispatch<SetStateAction<Record<string, LastInputEvent>>>;
  sendToProjector: (type: string, props: Record<string, unknown>) => void;
  isDebugOverlayOpen: boolean;
  setIsProjectorReady: (ready: boolean) => void;
};

export const useInputEvents = ({
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
  setLastInputEvents,
  sendToProjector,
  isDebugOverlayOpen,
  setIsProjectorReady,
}: UseInputEventsArgs) => {
  const triggerMapsBySourceRef = useRef<Record<string, TriggerMaps>>({});

  useEffect(() => {
    const tracks = getActiveSetTracks(userData, activeSetId);
    const globalMappings =
      userData && typeof userData === "object"
        ? (userData as Record<string, unknown>).config || {}
        : {};
    const gm =
      globalMappings && typeof globalMappings === "object"
        ? (globalMappings as Record<string, unknown>)
        : {};
    const inputRaw = gm.input;
    const inputObj =
      inputRaw && typeof inputRaw === "object" ? (inputRaw as Record<string, unknown>) : null;
    const inputType =
      (inputObj && typeof inputObj.type === "string" ? inputObj.type : null) || "midi";
    triggerMapsRef.current = buildMidiConfig(tracks, globalMappings, inputType);
    // Pre-build maps for other source types so cross-source events resolve correctly
    const otherTypes = ["midi", "osc", "websocket", "audio", "file"].filter((t) => t !== inputType);
    const bySource: Record<string, TriggerMaps> = { [inputType]: triggerMapsRef.current };
    for (const t of otherTypes) {
      bySource[t] = buildMidiConfig(tracks, globalMappings, t);
    }
    triggerMapsBySourceRef.current = bySource;
  }, [
    (userData as { sets?: unknown })?.sets,
    (userData as { config?: { input?: unknown } })?.config?.input,
    (userData as { config?: { trackMappings?: unknown } })?.config?.trackMappings,
    (userData as { config?: { channelMappings?: unknown } })?.config?.channelMappings,
    activeSetId,
  ]);

  useIPCListener("input-status", (_event, statusPayload) => {
    const sp =
      statusPayload && typeof statusPayload === "object"
        ? (statusPayload as Record<string, unknown>)
        : null;
    setInputStatus(sp?.data);
  });

  useIPCListener("from-projector", (_event, data) => {
    const d = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    const t = typeof d?.type === "string" ? d.type : null;
    if (t === "debug-log") {
      const rawLog =
        typeof d?.log === "string"
          ? d.log
          : d?.props && typeof d.props === "object"
            ? typeof (d.props as Record<string, unknown>).log === "string"
              ? ((d.props as Record<string, unknown>).log as string)
              : ""
            : "";
      const logEntries = rawLog.split("\n\n").filter((entry) => entry.trim());
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

  const addDebugLog = useCallback((log: string) => {
    setDebugLogs((prev) => {
      const newLogs = [...prev, log];
      return newLogs.slice(-200);
    });
  }, []);

  const formatDebugLog = useCallback((eventData: Record<string, unknown>) => {
    const timestampRaw = eventData.timestamp;
    const timestamp =
      typeof timestampRaw === "number" && Number.isFinite(timestampRaw) ? timestampRaw : 0;
    const type = typeof eventData.type === "string" ? eventData.type : "";
    const source = typeof eventData.source === "string" ? eventData.source : "";
    const data =
      eventData.data && typeof eventData.data === "object"
        ? (eventData.data as Record<string, unknown>)
        : {};
    const trackName = typeof eventData.trackName === "string" ? eventData.trackName : null;
    const moduleInfo =
      eventData.moduleInfo && typeof eventData.moduleInfo === "object"
        ? (eventData.moduleInfo as Record<string, unknown>)
        : null;
    const methodInfo =
      eventData.methodInfo && typeof eventData.methodInfo === "object"
        ? (eventData.methodInfo as Record<string, unknown>)
        : null;
    const props =
      eventData.props && typeof eventData.props === "object"
        ? (eventData.props as Record<string, unknown>)
        : null;

    const timeStr = timestamp.toFixed(5);
    const sourceLabel =
      source === "midi"
        ? "MIDI"
        : source === "osc"
          ? "OSC"
          : source === "audio"
            ? "AUDIO"
            : source === "file"
              ? "FILE"
              : source === "websocket"
                ? "WS"
                : "Input";
    const eventTypeLabel = type === "track-selection" ? "Track Selection" : "Method Trigger";

    let log = `[${timeStr}] ${sourceLabel} ${eventTypeLabel}\n`;

    if (source === "midi") {
      const noteMatchMode = normalizeNoteMatchMode(
        (userDataRef.current as { config?: { input?: { noteMatchMode?: unknown } } })?.config?.input
          ?.noteMatchMode
      );
      const key = noteNumberToTriggerKey(data.note, noteMatchMode);
      const pcName = noteMatchMode === "pitchClass" && key !== null ? pitchClassToName(key) : null;
      if (type === "track-selection") {
        log += `  Note: ${String(data.note)}${
          key !== null
            ? noteMatchMode === "pitchClass"
              ? ` (pitchClass: ${key} ${pcName || ""})`
              : ` (note: ${key})`
            : ""
        }\n`;
        log += `  Channel: ${String(data.channel || 1)}\n`;
      } else {
        log += `  Note: ${String(data.note)}${
          key !== null
            ? noteMatchMode === "pitchClass"
              ? ` (pitchClass: ${key} ${pcName || ""})`
              : ` (note: ${key})`
            : ""
        }\n`;
        log += `  Channel: ${String(data.channel)}\n`;
      }
    } else if (source === "osc" || source === "audio" || source === "file" || source === "websocket") {
      const address = typeof data.address === "string" ? (data.address as string) : null;
      const identifier = typeof data.identifier === "string" ? (data.identifier as string) : null;
      const channelName =
        typeof data.channelName === "string" ? (data.channelName as string) : null;
      const value = data.value;
      if (address && (source === "osc" || source === "websocket")) {
        log += `  Address: ${address}\n`;
      }
      if (identifier && (source === "osc" || source === "websocket")) {
        log += `  Identifier: ${identifier}\n`;
      }
      if (channelName) {
        log += `  Channel: ${channelName}\n`;
      }
      if (value !== undefined) {
        log += `  Value: ${String(value)}\n`;
      }
    }

    if (trackName) {
      log += `  Track: ${trackName}\n`;
    }
    if (moduleInfo) {
      const instanceId = typeof moduleInfo.instanceId === "string" ? moduleInfo.instanceId : "";
      const typeLabel = typeof moduleInfo.type === "string" ? moduleInfo.type : "";
      log += `  Module: ${instanceId} (${typeLabel})\n`;
    }
    if (methodInfo) {
      const name = typeof methodInfo.name === "string" ? methodInfo.name : "";
      log += `  Method: ${name}\n`;
    }
    if (props && Object.keys(props).length > 0) {
      log += `  Props: ${JSON.stringify(props, null, 2)}\n`;
    }
    return log;
  }, []);

  const handleInputEvent = useCallback(
    (_event: unknown, payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const p = payload as Record<string, unknown>;
      const type = p.type;
      const dataRaw = p.data;
      if (type !== "track-selection" && type !== "method-trigger") return;
      if (!dataRaw || typeof dataRaw !== "object") return;
      const data = dataRaw as Record<string, unknown>;

      const timestamp =
        typeof data.timestamp === "number" && Number.isFinite(data.timestamp)
          ? data.timestamp
          : performance.now() / 1000;

      const activeConfig =
        userDataRef.current && typeof userDataRef.current === "object"
          ? ((userDataRef.current as Record<string, unknown>).config as
              | Record<string, unknown>
              | undefined) || {}
          : {};
      const isSequencerMode = activeConfig?.sequencerMode === true;
      const inputCfgRaw = activeConfig?.input;
      const inputCfg =
        inputCfgRaw && typeof inputCfgRaw === "object"
          ? (inputCfgRaw as Record<string, unknown>)
          : null;
      if (isSequencerMode) {
        return;
      }
      const source = typeof data.source === "string" ? data.source : null;

      // Track last input event per source for debug display
      if (source) {
        const summary = (() => {
          if (source === "midi") {
            const note = typeof data.note === "number" ? data.note : "?";
            return type === "track-selection" ? `track note ${note}` : `note ${note}`;
          }
          if (source === "osc" || source === "websocket") {
            const addr = typeof data.address === "string" ? data.address : "";
            const ident = typeof data.identifier === "string" ? data.identifier : "";
            return addr || ident || type;
          }
          if (source === "audio" || source === "file") {
            const ch = typeof data.channelName === "string" ? data.channelName : "";
            return ch || type;
          }
          return type;
        })();
        setLastInputEvents((prev) => ({
          ...prev,
          [source]: { source, summary, type, ts: Date.now() },
        }));
      }

      const tracks = getActiveSetTracks(userDataRef.current || {}, activeSetIdRef.current);

      const noteMatchMode = normalizeNoteMatchMode(inputCfg?.noteMatchMode);
      let trackName: string | null = null;
      const moduleInfo: Record<string, unknown> | null = null;
      const methodInfo: Record<string, unknown> | null = null;
      const props: Record<string, unknown> | null = null;

      switch (type) {
        case "track-selection": {
          let resolvedTrackName: string | null = null;

          if (source === "midi") {
            const key = noteNumberToTriggerKey(data.note, noteMatchMode);
            const maps = triggerMapsBySourceRef.current[source] || triggerMapsRef.current;
            const mapped = key !== null ? maps.trackTriggersMap[key] : null;
            resolvedTrackName = typeof mapped === "string" ? mapped : null;
          } else if (source === "osc" || source === "websocket") {
            const identifier =
              typeof data.identifier === "string" ? (data.identifier as string) : null;
            const maps = triggerMapsBySourceRef.current[source] || triggerMapsRef.current;
            const mapped = identifier ? maps.trackTriggersMap[identifier] : null;
            resolvedTrackName = typeof mapped === "string" ? mapped : null;
          }

          if (resolvedTrackName) {
            const targetTrack = (tracks as unknown[]).find((t) => {
              const tr = t && typeof t === "object" ? (t as Record<string, unknown>) : null;
              return tr ? tr.name === resolvedTrackName : false;
            }) as Record<string, unknown> | undefined;
            if (targetTrack) {
              const idRaw = targetTrack.id;
              const id = typeof idRaw === "string" || typeof idRaw === "number" ? idRaw : null;
              const idKey = id == null ? null : String(id);
              const name = typeof targetTrack.name === "string" ? targetTrack.name : null;
              if (id != null && idKey && name) {
                trackName = name;
                setActiveTrackId(id);

                const wasRecording = recordingStateRef.current[idKey];
                if (wasRecording) {
                  setRecordingData((prev) => {
                    const existing = getRecordingForTrack(prev, idKey);
                    return setRecordingForTrack(prev, idKey, {
                      ...(existing as Record<string, unknown>),
                      channels: [],
                    });
                  });
                }

                setRecordingState((prev) => ({
                  ...prev,
                  [idKey]: {
                    startTime: Date.now(),
                    isRecording: true,
                  },
                }));

                const modules = targetTrack.modules;
                if (Array.isArray(modules)) {
                  const keys = modules
                    .map((moduleInstance) => {
                      const mi =
                        moduleInstance && typeof moduleInstance === "object"
                          ? (moduleInstance as Record<string, unknown>)
                          : null;
                      const mid = mi && typeof mi.id === "string" ? mi.id : null;
                      return mid ? `${idKey}:${mid}` : null;
                    })
                    .filter((k): k is string => Boolean(k));
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
          }
          break;
        }

        case "method-trigger": {
          const currentActiveTrackIdRaw = activeTrackIdRef.current;
          const currentActiveTrackIdKey =
            currentActiveTrackIdRaw == null ? null : String(currentActiveTrackIdRaw);
          const activeTrack = (tracks as unknown[]).find((t) => {
            const tr = t && typeof t === "object" ? (t as Record<string, unknown>) : null;
            if (!tr) return false;
            const idRaw = tr.id;
            if (idRaw == null || currentActiveTrackIdKey == null) return false;
            return String(idRaw) === currentActiveTrackIdKey;
          }) as Record<string, unknown> | undefined;

          if (activeTrack && activeTrack.channelMappings) {
            const globalMappings = userDataRef.current
              ? ((userDataRef.current as Record<string, unknown>).config as
                  | Record<string, unknown>
                  | undefined) || {}
              : {};
            const gmInputRaw = globalMappings.input;
            const gmInput =
              gmInputRaw && typeof gmInputRaw === "object"
                ? (gmInputRaw as Record<string, unknown>)
                : null;
            const currentInputType =
              (gmInput && typeof gmInput.type === "string" ? gmInput.type : null) || "midi";

            const modules = Array.isArray(activeTrack.modules) ? (activeTrack.modules as Record<string, unknown>[]) : [];
            const modulesData = activeTrack.modulesData && typeof activeTrack.modulesData === "object"
              ? (activeTrack.modulesData as Record<string, unknown>)
              : {};

            // Determine whether a trigger value matches the incoming event
            const matchesTrigger = (triggerValue: unknown, sourceType: string): boolean => {
              if (sourceType === "midi") {
                const triggerKey = noteNumberToTriggerKey(data.note, noteMatchMode);
                if (triggerKey === null) return false;
                const resolvedKey = parseMidiTriggerValue(triggerValue, noteMatchMode);
                return resolvedKey === triggerKey;
              }
              // osc / websocket / audio / file
              const channelName = typeof data.channelName === "string" ? data.channelName : null;
              if (!channelName) return false;
              return String(triggerValue) === channelName;
            };

            // Per-module channel matching: for each channel, check each module
            // considering its inputSource and inputMappings overrides
            const channelsToFlash = new Set<string>();

            Object.entries(activeTrack.channelMappings as Record<string, unknown>).forEach(
              ([channelNumber, slotNumber]) => {
                const hasAnyModuleSource = modules.some(
                  (m) => m && typeof m.inputSource === "string" && m.inputSource
                );

                for (const m of modules) {
                  if (!m || m.disabled === true) continue;
                  const mId = typeof m.id === "string" ? m.id : null;
                  if (!mId) continue;

                  // Check this module has methods on this channel
                  const modData = modulesData[mId] && typeof modulesData[mId] === "object"
                    ? (modulesData[mId] as Record<string, unknown>)
                    : null;
                  const methods = modData?.methods && typeof modData.methods === "object"
                    ? (modData.methods as Record<string, unknown>)
                    : null;
                  if (!methods || !methods[channelNumber]) continue;

                  // Determine the effective source for this module
                  const moduleSource = typeof m.inputSource === "string" && m.inputSource
                    ? m.inputSource
                    : currentInputType;

                  // Source filtering: skip if event source doesn't match module's source
                  if (hasAnyModuleSource && moduleSource !== source) continue;
                  if (!hasAnyModuleSource && source !== currentInputType) continue;

                  // Check per-module inputMappings override
                  const rawMappings = m.inputMappings && typeof m.inputMappings === "object" && !Array.isArray(m.inputMappings)
                    ? (m.inputMappings as Record<string, unknown>)
                    : null;

                  if (rawMappings && rawMappings[channelNumber] !== undefined) {
                    // Module has a custom override for this channel — use it
                    const overrideValue = rawMappings[channelNumber];
                    if (matchesTrigger(overrideValue, moduleSource)) {
                      channelsToFlash.add(channelNumber);
                    }
                  } else {
                    // Use global channel trigger
                    const resolvedTrigger = resolveChannelTrigger(slotNumber, moduleSource, globalMappings);
                    if (matchesTrigger(resolvedTrigger, moduleSource)) {
                      channelsToFlash.add(channelNumber);
                    }
                  }
                }
              }
            );

            const filteredChannels = Array.from(channelsToFlash);

            filteredChannels.forEach((channel) => {
              flashChannel(channel, 100);
            });

            if (currentActiveTrackIdKey && filteredChannels.length > 0) {
              const recordingStateForTrack = recordingStateRef.current[currentActiveTrackIdKey];
              if (recordingStateForTrack?.isRecording) {
                const currentTime = Date.now();
                const relativeTime = (currentTime - recordingStateForTrack.startTime) / 1000;

                filteredChannels.forEach((channelNumber) => {
                  const channelName = `ch${channelNumber}`;
                  setRecordingData((prev) => {
                    const recording = getRecordingForTrack(prev, currentActiveTrackIdKey);
                    const newRecording = { ...(recording as Record<string, unknown>) };

                    const channels = Array.isArray(newRecording.channels)
                      ? (newRecording.channels as unknown[])
                      : [];

                    const channelIndex = channels.findIndex((ch) => {
                      const c =
                        ch && typeof ch === "object" ? (ch as Record<string, unknown>) : null;
                      return c ? c.name === channelName : false;
                    });

                    if (channelIndex === -1) {
                      channels.push({
                        name: channelName,
                        sequences: [{ time: relativeTime, duration: 0.1 }],
                      });
                    } else {
                      const entry = channels[channelIndex] as Record<string, unknown>;
                      const sequences = Array.isArray(entry.sequences)
                        ? (entry.sequences as unknown[])
                        : [];
                      sequences.push({ time: relativeTime, duration: 0.1 });
                      channels[channelIndex] = { ...entry, sequences };
                    }

                    newRecording.channels = channels;

                    return setRecordingForTrack(prev, currentActiveTrackIdKey, newRecording);
                  });
                });
              }
            }
          }
          break;
        }
      }

      const log = formatDebugLog({
        timestamp,
        type: String(type),
        source: source || "",
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

  useIPCListener("from-projector", (_event, data) => {
    const d = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    const t = typeof d?.type === "string" ? d.type : null;
    if (t === "projector-ready") {
      setIsProjectorReady(true);
    }
  });
};

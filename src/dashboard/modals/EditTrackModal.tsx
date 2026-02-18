import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useAtom } from "jotai";
import { Modal } from "../shared/Modal";
import { ModalHeader } from "../components/ModalHeader";
import { ModalFooter } from "../components/ModalFooter";
import { Button } from "../components/Button";
import { NumberInput, TextInput, Select, Label, ValidationError } from "../components/FormInputs";
import { HelpIcon } from "../components/HelpIcon";
import { SignalThresholdMeter } from "../components/SignalThresholdMeter";
import { userDataAtom, activeSetIdAtom, activeTrackIdAtom } from "../core/state";
import { updateActiveSet } from "../core/utils";
import { getActiveSetTracks } from "../../shared/utils/setUtils";
import { HELP_TEXT } from "../../shared/helpText";
import { useNameValidation } from "../core/hooks/useNameValidation";
import { useTrackSlots } from "../core/hooks/useTrackSlots";
import { parsePitchClass, pitchClassToName, resolveChannelTrigger } from "../../shared/midi/midiUtils";
import type { AudioCaptureState } from "../core/hooks/useDashboardAudioCapture";
import type { FileAudioState } from "../core/hooks/useDashboardFileAudio";

type InputConfigLike = {
  type?: unknown;
  noteMatchMode?: unknown;
};

type EditTrackModalProps = {
  isOpen: boolean;
  onClose: () => void;
  trackIndex: number;
  inputConfig?: InputConfigLike | null;
  audioCaptureState?: AudioCaptureState | null;
  fileAudioState?: FileAudioState | null;
};

export const EditTrackModal = ({
  isOpen,
  onClose,
  trackIndex,
  inputConfig,
  audioCaptureState,
  fileAudioState,
}: EditTrackModalProps) => {
  const [userData, setUserData] = useAtom(userDataAtom);
  const [activeSetId] = useAtom(activeSetIdAtom);
  const [activeTrackId] = useAtom(activeTrackIdAtom);
  const [trackName, setTrackName] = useState("");
  const [trackSlot, setTrackSlot] = useState(1);
  const [audioMinIntervalMs, setAudioMinIntervalMs] = useState(120);
  const [audioThresholds, setAudioThresholds] = useState({ low: 0.5, medium: 0.5, high: 0.5 });
  const [fileMinIntervalMs, setFileMinIntervalMs] = useState(120);
  const [fileThresholds, setFileThresholds] = useState({ low: 0.5, medium: 0.5, high: 0.5 });
  const [fileAssetRelPath, setFileAssetRelPath] = useState("");
  const [fileAssetName, setFileAssetName] = useState("");
  const [fileUploadError, setFileUploadError] = useState<string | null>(null);

  type ModuleTransportState = {
    inputSource: string; // "" = global default, "midi" | "osc" | "websocket"
    inputMappings: Record<string, string>; // channelNumber → trigger value
  };
  const [moduleTransports, setModuleTransports] = useState<Record<string, ModuleTransportState>>({});

  type Band = "low" | "medium" | "high";
  const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
  const normalizeLevels = (levels: unknown): Record<Band, number> | null => {
    if (!levels || typeof levels !== "object") return null;
    const obj = levels as Record<string, unknown>;
    const read = (k: Band) => {
      const v = obj[k];
      return typeof v === "number" && Number.isFinite(v) ? clamp01(v) : 0;
    };
    return { low: read("low"), medium: read("medium"), high: read("high") };
  };

  const tracks = getActiveSetTracks(userData, activeSetId);
  const track = (tracks as unknown[])[trackIndex] as Record<string, unknown> | undefined;
  const trackIdRaw = track?.id;
  const trackId =
    typeof trackIdRaw === "string" || typeof trackIdRaw === "number" ? trackIdRaw : null;
  const inputType =
    inputConfig?.type === "osc"
      ? "osc"
      : inputConfig?.type === "audio"
        ? "audio"
        : inputConfig?.type === "file"
          ? "file"
          : "midi";
  const noteMatchMode = inputConfig?.noteMatchMode === "exactNote" ? "exactNote" : "pitchClass";
  const globalMappings = (userData as Record<string, unknown>).config || {};
  const maxTrackSlots = inputType === "midi" ? 12 : 10;
  const isAudioMode = inputType === "audio";
  const isFileMode = inputType === "file";

  const isEditingActiveTrack = useMemo(() => {
    if (trackId == null || activeTrackId == null) return false;
    return String(trackId) === String(activeTrackId);
  }, [activeTrackId, trackId]);

  const audioLevels = useMemo(
    () => normalizeLevels(audioCaptureState && (audioCaptureState as AudioCaptureState).levels),
    [audioCaptureState]
  );
  const fileLevels = useMemo(
    () => normalizeLevels(fileAudioState && (fileAudioState as FileAudioState).levels),
    [fileAudioState]
  );
  const liveLevels = isAudioMode
    ? audioLevels
    : isFileMode && isEditingActiveTrack
      ? fileLevels
      : null;

  const { validate } = useNameValidation(tracks, trackId);
  const validation = validate(trackName);

  const { availableSlots, getTrigger } = useTrackSlots(tracks, globalMappings, inputType, trackId);

  const resolvedTrigger = getTrigger(trackSlot);
  const resolvedNoteName =
    inputType === "midi"
      ? (() => {
          const pc =
            typeof resolvedTrigger === "number"
              ? resolvedTrigger
              : parsePitchClass(resolvedTrigger);
          if (pc === null) return null;
          return pitchClassToName(pc) || String(pc);
        })()
      : null;

  const takenSlotToTrackName = useMemo(() => {
    const map = new Map<number, string>();
    (tracks as unknown[]).forEach((t) => {
      const tr = t as Record<string, unknown> | null;
      const slot = typeof tr?.trackSlot === "number" ? tr.trackSlot : null;
      if (!slot) return;
      if (track?.id && tr?.id === track.id) return;
      map.set(slot, String(tr?.name || "").trim() || `Track ${slot}`);
    });
    return map;
  }, [tracks, track?.id]);

  useEffect(() => {
    if (!isOpen) {
      setTrackName("");
      setTrackSlot(1);
      setAudioMinIntervalMs(120);
      setAudioThresholds({ low: 0.5, medium: 0.5, high: 0.5 });
      setFileMinIntervalMs(120);
      setFileThresholds({ low: 0.5, medium: 0.5, high: 0.5 });
      setFileAssetRelPath("");
      setFileAssetName("");
      setFileUploadError(null);
      setModuleTransports({});
    } else if (track) {
      setTrackName(typeof track.name === "string" ? track.name : "");
      setTrackSlot(typeof track.trackSlot === "number" ? track.trackSlot : 1);
      const signal =
        track.signal && typeof track.signal === "object"
          ? (track.signal as Record<string, unknown>)
          : {};
      const audio =
        signal.audio && typeof signal.audio === "object"
          ? (signal.audio as Record<string, unknown>)
          : {};
      const file =
        signal.file && typeof signal.file === "object"
          ? (signal.file as Record<string, unknown>)
          : {};

      const normalizeThreshold = (v: unknown) =>
        typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
      const normalizeThrObj = (t: unknown) => {
        const obj = t && typeof t === "object" ? (t as Record<string, unknown>) : {};
        return {
          low: normalizeThreshold(obj.low),
          medium: normalizeThreshold(obj.medium),
          high: normalizeThreshold(obj.high),
        };
      };
      const normalizeInterval = (v: unknown) =>
        typeof v === "number" && Number.isFinite(v)
          ? Math.max(0, Math.min(10_000, Math.round(v)))
          : 120;

      setAudioThresholds(normalizeThrObj(audio.thresholds));
      setAudioMinIntervalMs(normalizeInterval(audio.minIntervalMs));
      setFileThresholds(normalizeThrObj(file.thresholds));
      setFileMinIntervalMs(normalizeInterval(file.minIntervalMs));
      setFileAssetRelPath(typeof file.assetRelPath === "string" ? file.assetRelPath : "");
      setFileAssetName(typeof file.assetName === "string" ? file.assetName : "");
      setFileUploadError(null);

      // Initialize per-module transport state
      const modules = Array.isArray(track.modules) ? (track.modules as unknown[]) : [];
      const transports: Record<string, ModuleTransportState> = {};
      for (const mod of modules) {
        const m = mod && typeof mod === "object" ? (mod as Record<string, unknown>) : null;
        if (!m || !m.id || typeof m.id !== "string") continue;
        const src = typeof m.inputSource === "string" ? m.inputSource : "";
        const rawMappings = m.inputMappings && typeof m.inputMappings === "object" && !Array.isArray(m.inputMappings)
          ? (m.inputMappings as Record<string, unknown>)
          : {};
        const mappings: Record<string, string> = {};
        for (const [k, v] of Object.entries(rawMappings)) {
          if (typeof v === "string" || typeof v === "number") {
            mappings[k] = String(v);
          }
        }
        transports[m.id] = { inputSource: src, inputMappings: mappings };
      }
      setModuleTransports(transports);
    }
  }, [isOpen, track]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const uploadFileToAssets = useCallback(async (file: File) => {
    setFileUploadError(null);
    const bridge = (globalThis as unknown as { nwWrldBridge?: unknown }).nwWrldBridge;
    const bridgeObj =
      bridge && typeof bridge === "object" ? (bridge as Record<string, unknown>) : null;
    const workspace =
      bridgeObj && typeof bridgeObj.workspace === "object"
        ? (bridgeObj.workspace as Record<string, unknown>)
        : null;
    const write =
      workspace && typeof workspace.writeAudioAsset === "function"
        ? (workspace.writeAudioAsset as (payload: unknown) => Promise<unknown>)
        : null;
    if (!write) {
      setFileUploadError("Upload not available.");
      return;
    }
    const maxBytes = 50 * 1024 * 1024;
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > maxBytes) {
      setFileUploadError("Upload failed: file is too large (max 50MB).");
      return;
    }
    try {
      const bytes = await file.arrayBuffer();
      const res = await write({ filename: file.name, bytes });
      const r = res && typeof res === "object" ? (res as Record<string, unknown>) : null;
      const ok = Boolean(r && r.ok === true);
      const relPath = r && typeof r.relPath === "string" ? r.relPath : "";
      if (!ok || !relPath) {
        const reason = r && typeof r.reason === "string" ? r.reason : "";
        setFileUploadError(reason ? `Upload failed: ${reason}` : "Upload failed.");
        return;
      }
      setFileAssetRelPath(relPath);
      setFileAssetName(file.name);
      setFileUploadError(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setFileUploadError(message || "Upload failed.");
    }
  }, []);

  const persistTrackChanges = useCallback(() => {
    if (!track) return;

    const canPersistIdentity = validation.isValid && Boolean(trackSlot) && availableSlots.includes(trackSlot);
    const nextTrackName = trackName.trim();
    const nextTrackSlot = trackSlot;
    const nextSignal = {
      audio: {
        thresholds: {
          low: Math.max(0, Math.min(1, audioThresholds.low)),
          medium: Math.max(0, Math.min(1, audioThresholds.medium)),
          high: Math.max(0, Math.min(1, audioThresholds.high)),
        },
        minIntervalMs: Math.max(0, Math.min(10_000, Math.round(audioMinIntervalMs))),
      },
      file: {
        thresholds: {
          low: Math.max(0, Math.min(1, fileThresholds.low)),
          medium: Math.max(0, Math.min(1, fileThresholds.medium)),
          high: Math.max(0, Math.min(1, fileThresholds.high)),
        },
        minIntervalMs: Math.max(0, Math.min(10_000, Math.round(fileMinIntervalMs))),
        assetRelPath: String(fileAssetRelPath || ""),
        assetName: String(fileAssetName || ""),
      },
    };

    updateActiveSet(setUserData, activeSetId, (activeSet: unknown) => {
      const s = activeSet as Record<string, unknown>;
      const ts = Array.isArray(s.tracks) ? (s.tracks as unknown[]) : [];
      const t = (ts[trackIndex] as Record<string, unknown> | null) || null;
      if (!t) return;

      let changed = false;
      if (canPersistIdentity && t.name !== nextTrackName) {
        t.name = nextTrackName;
        changed = true;
      }
      if (canPersistIdentity && t.trackSlot !== nextTrackSlot) {
        t.trackSlot = nextTrackSlot;
        changed = true;
      }

      const signal =
        t.signal && typeof t.signal === "object" ? (t.signal as Record<string, unknown>) : null;
      const audio =
        signal && signal.audio && typeof signal.audio === "object"
          ? (signal.audio as Record<string, unknown>)
          : null;
      const file =
        signal && signal.file && typeof signal.file === "object"
          ? (signal.file as Record<string, unknown>)
          : null;
      const audioThr =
        audio && audio.thresholds && typeof audio.thresholds === "object"
          ? (audio.thresholds as Record<string, unknown>)
          : null;
      const fileThr =
        file && file.thresholds && typeof file.thresholds === "object"
          ? (file.thresholds as Record<string, unknown>)
          : null;

      const signalChanged =
        !audio ||
        !file ||
        !audioThr ||
        !fileThr ||
        audioThr.low !== nextSignal.audio.thresholds.low ||
        audioThr.medium !== nextSignal.audio.thresholds.medium ||
        audioThr.high !== nextSignal.audio.thresholds.high ||
        audio.minIntervalMs !== nextSignal.audio.minIntervalMs ||
        fileThr.low !== nextSignal.file.thresholds.low ||
        fileThr.medium !== nextSignal.file.thresholds.medium ||
        fileThr.high !== nextSignal.file.thresholds.high ||
        file.minIntervalMs !== nextSignal.file.minIntervalMs ||
        file.assetRelPath !== nextSignal.file.assetRelPath ||
        file.assetName !== nextSignal.file.assetName;

      if (signalChanged) {
        t.signal = nextSignal;
        changed = true;
      }

      // Persist per-module transport settings
      const modules = Array.isArray(t.modules) ? (t.modules as Record<string, unknown>[]) : [];
      for (const mod of modules) {
        const mId = typeof mod.id === "string" ? mod.id : null;
        if (!mId) continue;
        const transport = moduleTransports[mId];
        if (!transport) continue;

        const prevSource = typeof mod.inputSource === "string" ? mod.inputSource : "";
        const prevMappings = mod.inputMappings && typeof mod.inputMappings === "object"
          ? mod.inputMappings as Record<string, unknown>
          : null;

        if (transport.inputSource) {
          if (mod.inputSource !== transport.inputSource) {
            mod.inputSource = transport.inputSource;
            changed = true;
          }
          // Persist non-empty inputMappings
          const hasEntries = Object.keys(transport.inputMappings).some((k) => transport.inputMappings[k] !== "");
          if (hasEntries) {
            const cleaned: Record<string, string | number> = {};
            for (const [k, v] of Object.entries(transport.inputMappings)) {
              if (v !== "") {
                const numVal = transport.inputSource === "midi" ? parseInt(v, 10) : NaN;
                cleaned[k] = Number.isFinite(numVal) ? numVal : v;
              }
            }
            const prevStr = prevMappings ? JSON.stringify(prevMappings) : "";
            if (JSON.stringify(cleaned) !== prevStr) {
              mod.inputMappings = cleaned;
              changed = true;
            }
          } else if (prevMappings) {
            delete mod.inputMappings;
            changed = true;
          }
        } else {
          if (prevSource) {
            delete mod.inputSource;
            changed = true;
          }
          if (prevMappings) {
            delete mod.inputMappings;
            changed = true;
          }
        }
      }

      if (!changed) return;
    });
  }, [
    activeSetId,
    audioMinIntervalMs,
    audioThresholds.high,
    audioThresholds.low,
    audioThresholds.medium,
    availableSlots,
    fileAssetName,
    fileAssetRelPath,
    fileMinIntervalMs,
    fileThresholds.high,
    fileThresholds.low,
    fileThresholds.medium,
    moduleTransports,
    setUserData,
    track,
    trackIndex,
    trackName,
    trackSlot,
    validation.isValid,
  ]);

  const flushAutoSave = useCallback(() => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }
    persistTrackChanges();
  }, [persistTrackChanges]);

  useEffect(() => {
    if (!isOpen || !track) return;
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    autoSaveTimeoutRef.current = setTimeout(() => {
      autoSaveTimeoutRef.current = null;
      persistTrackChanges();
    }, 250);
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
    };
  }, [
    audioMinIntervalMs,
    audioThresholds.high,
    audioThresholds.low,
    audioThresholds.medium,
    fileAssetName,
    fileAssetRelPath,
    fileMinIntervalMs,
    fileThresholds.high,
    fileThresholds.low,
    fileThresholds.medium,
    isOpen,
    moduleTransports,
    persistTrackChanges,
    track,
    trackName,
    trackSlot,
  ]);

  const handleClose = useCallback(() => {
    flushAutoSave();
    onClose();
  }, [flushAutoSave, onClose]);

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
      <ModalHeader title="EDIT TRACK" onClose={handleClose} />

      <div className="px-6 flex flex-col gap-4">
        <div>
          <Label>Track Name</Label>
          <TextInput
            value={trackName}
            onChange={(e) => setTrackName(e.target.value)}
            className="w-full"
            placeholder="My Performance Track"
            autoFocus
          />
          <ValidationError value={trackName} validation={validation} />
        </div>

        <div>
          <div className="relative inline-block">
            <Label>Track Number</Label>
            <HelpIcon helpText={HELP_TEXT.trackSlot} />
          </div>
          <Select
            value={trackSlot}
            onChange={(e) => setTrackSlot(parseInt(e.target.value, 10))}
            className="w-full py-1 font-mono"
          >
            {Array.from({ length: maxTrackSlots }, (_, i) => i + 1).map((slot) => {
              const rawTrigger = getTrigger(slot);
              const trigger =
                inputType === "midi"
                  ? noteMatchMode === "pitchClass"
                    ? (() => {
                        const pc =
                          typeof rawTrigger === "number" ? rawTrigger : parsePitchClass(rawTrigger);
                        if (pc === null) return String(rawTrigger || "").trim();
                        return pitchClassToName(pc) || String(pc);
                      })()
                    : String(rawTrigger || "").trim()
                  : rawTrigger;
              const takenBy = takenSlotToTrackName.get(slot) || "";
              const isTaken = Boolean(takenBy);
              return (
                <option key={slot} value={slot} className="bg-[#101010]" disabled={isTaken}>
                  Track {slot} ({trigger || "not configured"})
                  {isTaken ? ` — used by ${takenBy}` : ""}
                </option>
              );
            })}
          </Select>
          {inputType === "midi" && resolvedNoteName ? (
            <div className="text-blue-500 text-[11px] mt-1 font-mono">
              ✓ Will use trigger: <span className="text-blue-500">{resolvedNoteName}</span>
            </div>
          ) : resolvedTrigger ? (
            <div className="text-blue-500 text-[11px] mt-1 font-mono">
              ✓ Will use trigger: {resolvedTrigger}
            </div>
          ) : null}
        </div>

        {/* Per-Module Transport Settings */}
        {track && Array.isArray(track.modules) && (track.modules as unknown[]).filter((m) => {
          const mm = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
          return mm && mm.id && mm.disabled !== true;
        }).length > 0 && (
          <div className="pt-2 border-t border-neutral-800">
            <div className="opacity-50 mb-2 text-[11px]">Module Input Sources</div>
            <div className="flex flex-col gap-3">
              {(track.modules as unknown[]).map((mod) => {
                const m = mod && typeof mod === "object" ? (mod as Record<string, unknown>) : null;
                if (!m || !m.id || typeof m.id !== "string" || m.disabled === true) return null;
                const mId = m.id;
                const mType = typeof m.type === "string" ? m.type : "unknown";
                const transport = moduleTransports[mId] || { inputSource: "", inputMappings: {} };
                const transportSource = transport.inputSource;
                const sourceLabel = transportSource
                  ? transportSource === "midi" ? "MIDI" : transportSource === "osc" ? "OSC" : "WebSocket"
                  : "Global Default";

                // Find which channels this module has methods on
                const modulesData = track.modulesData && typeof track.modulesData === "object"
                  ? (track.modulesData as Record<string, unknown>)
                  : {};
                const modData = modulesData[mId] && typeof modulesData[mId] === "object"
                  ? (modulesData[mId] as Record<string, unknown>)
                  : {};
                const methods = modData.methods && typeof modData.methods === "object"
                  ? Object.keys(modData.methods as Record<string, unknown>).filter((k) => /^\d+$/.test(k)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
                  : [];

                // Resolve the effective source type for trigger display
                const effectiveSource = transportSource || inputType;

                // Format a trigger value for display
                const formatTriggerDisplay = (trigger: unknown, srcType: string) => {
                  if (trigger === "" || trigger === null || trigger === undefined) return null;
                  if (srcType === "midi") {
                    const pc = typeof trigger === "number" ? trigger : parsePitchClass(trigger);
                    if (pc !== null) {
                      const name = pitchClassToName(pc);
                      return name || String(pc);
                    }
                    return String(trigger);
                  }
                  return String(trigger);
                };

                return (
                  <div key={mId} className="bg-neutral-900 rounded px-3 py-2">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[11px] text-neutral-300 font-mono">{mType}</div>
                      <div className="text-[9px] text-neutral-500">{sourceLabel}</div>
                    </div>
                    <Select
                      value={transportSource}
                      onChange={(e) => {
                        const val = e.target.value;
                        const prev = moduleTransports[mId];
                        const prevSource = prev?.inputSource || "";
                        // Clear overrides when transport type changes
                        const keepMappings = val && val === prevSource;
                        setModuleTransports((prev) => ({
                          ...prev,
                          [mId]: {
                            ...prev[mId],
                            inputSource: val,
                            inputMappings: keepMappings ? (prev[mId]?.inputMappings || {}) : {},
                          },
                        }));
                      }}
                      className="w-full py-1 font-mono text-[11px]"
                      data-testid={`module-transport-${mId}`}
                    >
                      <option value="" className="bg-[#101010]">Global Default</option>
                      <option value="midi" className="bg-[#101010]">MIDI</option>
                      <option value="osc" className="bg-[#101010]">OSC</option>
                      <option value="websocket" className="bg-[#101010]">WebSocket</option>
                    </Select>

                    {transportSource && methods.length > 0 && (
                      <div className="mt-2 flex flex-col gap-1">
                        <div className="text-[10px] opacity-40 mb-1">
                          Channel Triggers
                        </div>
                        {methods.map((ch) => {
                          // Get the channel's slot number from track.channelMappings
                          const chMappings = track.channelMappings && typeof track.channelMappings === "object"
                            ? (track.channelMappings as Record<string, unknown>)
                            : {};
                          const slotNumber = chMappings[ch];

                          // Resolve the global trigger for this channel
                          const globalTrigger = resolveChannelTrigger(slotNumber, effectiveSource, globalMappings);
                          const globalLabel = formatTriggerDisplay(globalTrigger, effectiveSource);

                          const mappingVal = transport.inputMappings[ch] || "";
                          const hasOverride = mappingVal !== "";
                          const placeholder = transportSource === "midi"
                            ? "note #"
                            : "address";

                          return (
                            <div key={ch} className="flex flex-col gap-0.5">
                              <div className="grid grid-cols-[50px_1fr_auto] gap-2 items-center">
                                <div className="text-[10px] opacity-50">Ch {ch}</div>
                                <div className="text-[10px] text-blue-500/70">
                                  {hasOverride ? (
                                    <span className="text-neutral-500 line-through">{globalLabel || "—"}</span>
                                  ) : (
                                    globalLabel || <span className="text-neutral-600">—</span>
                                  )}
                                  {hasOverride && (
                                    <span className="text-blue-500 ml-1">{mappingVal}</span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                                    hasOverride
                                      ? "bg-blue-500/20 text-blue-400"
                                      : "bg-neutral-800 text-neutral-500 hover:text-neutral-300"
                                  }`}
                                  onClick={() => {
                                    if (hasOverride) {
                                      // Clear override
                                      setModuleTransports((prev) => ({
                                        ...prev,
                                        [mId]: {
                                          ...prev[mId],
                                          inputMappings: {
                                            ...(prev[mId]?.inputMappings || {}),
                                            [ch]: "",
                                          },
                                        },
                                      }));
                                    } else {
                                      // Set override to current global value as starting point
                                      setModuleTransports((prev) => ({
                                        ...prev,
                                        [mId]: {
                                          ...prev[mId],
                                          inputMappings: {
                                            ...(prev[mId]?.inputMappings || {}),
                                            [ch]: globalLabel || "",
                                          },
                                        },
                                      }));
                                    }
                                  }}
                                  data-testid={`module-override-toggle-${mId}-${ch}`}
                                >
                                  {hasOverride ? "CLEAR" : "OVERRIDE"}
                                </button>
                              </div>
                              {hasOverride && (
                                <div className="grid grid-cols-[50px_1fr] gap-2 items-center">
                                  <div />
                                  <TextInput
                                    value={mappingVal}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setModuleTransports((prev) => ({
                                        ...prev,
                                        [mId]: {
                                          ...prev[mId],
                                          inputMappings: {
                                            ...(prev[mId]?.inputMappings || {}),
                                            [ch]: val,
                                          },
                                        },
                                      }));
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        (e.target as HTMLInputElement).blur();
                                      }
                                    }}
                                    className="py-0.5 text-[10px]"
                                    placeholder={placeholder}
                                    data-testid={`module-mapping-${mId}-${ch}`}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(isAudioMode || isFileMode) && (
          <div className="pt-2 border-t border-neutral-800">
            <div className="opacity-50 mb-2 text-[11px]">Signal Settings</div>

            <div className="flex flex-col gap-3">
              <div>
                <div className="text-[10px] opacity-50 mb-1">Trigger Cooldown (ms)</div>
                <NumberInput
                  value={isAudioMode ? audioMinIntervalMs : fileMinIntervalMs}
                  data-testid={isAudioMode ? "track-audio-cooldown" : "track-file-cooldown"}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isFinite(n)) return;
                    const next = Math.max(0, Math.min(10_000, n));
                    if (isAudioMode) setAudioMinIntervalMs(next);
                    else setFileMinIntervalMs(next);
                  }}
                  step={10}
                  min={0}
                  max={10_000}
                  className="py-1 w-full"
                  style={{ width: "100%" }}
                />
              </div>

              <div className="flex flex-col gap-2">
                {(["low", "medium", "high"] as const).map((band) => {
                  const value = isAudioMode ? audioThresholds[band] : fileThresholds[band];
                  const level = liveLevels ? liveLevels[band] : 0;
                  return (
                    <div key={band} className="grid grid-cols-[80px_1fr] gap-2 items-center">
                      <div className="text-[10px] opacity-50">{band.toUpperCase()}</div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <SignalThresholdMeter
                            level={level}
                            threshold={value}
                            testId={`track-${isAudioMode ? "audio" : "file"}-threshold-meter-${band}`}
                          />
                        </div>
                        <NumberInput
                          value={value}
                          data-testid={`track-${isAudioMode ? "audio" : "file"}-threshold-${band}`}
                          onChange={(e) => {
                            const n = parseFloat(e.target.value);
                            if (!Number.isFinite(n)) return;
                            const next = Math.max(0, Math.min(1, n));
                            if (isAudioMode) {
                              setAudioThresholds((prev) => ({ ...prev, [band]: next }));
                            } else {
                              setFileThresholds((prev) => ({ ...prev, [band]: next }));
                            }
                          }}
                          step={0.01}
                          min={0}
                          max={1}
                          className="py-1 w-[92px]"
                          style={{ width: "92px" }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {isFileMode && (
                <div className="pt-2 border-t border-neutral-800">
                  <div className="opacity-50 mb-1 text-[11px]">Audio File (MP3/WAV)</div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".mp3,.wav"
                    data-testid="track-file-upload-input"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                      if (f) uploadFileToAssets(f).catch(() => {});
                      e.target.value = "";
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => {
                        fileInputRef.current?.click();
                      }}
                      className="px-3"
                    >
                      UPLOAD
                    </Button>
                    <Button
                      onClick={() => {
                        setFileAssetRelPath("");
                        setFileAssetName("");
                        setFileUploadError(null);
                      }}
                      className="px-3"
                    >
                      CLEAR
                    </Button>
                  </div>
                  <div className="mt-2 text-[10px] text-neutral-400">
                    {fileAssetName
                      ? fileAssetName
                      : fileAssetRelPath
                        ? String(fileAssetRelPath)
                        : "No file selected"}
                  </div>
                  {fileUploadError && (
                    <div className="text-[10px] text-red-400 mt-1">Upload: {fileUploadError}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <ModalFooter>
        <Button onClick={handleClose} type="secondary">
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
};

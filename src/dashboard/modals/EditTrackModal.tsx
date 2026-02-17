import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useAtom } from "jotai";
import { Modal } from "../shared/Modal";
import { ModalHeader } from "../components/ModalHeader";
import { ModalFooter } from "../components/ModalFooter";
import { Button } from "../components/Button";
import { NumberInput, TextInput, Select, Label, ValidationError } from "../components/FormInputs";
import { HelpIcon } from "../components/HelpIcon";
import { userDataAtom, activeSetIdAtom, activeTrackIdAtom } from "../core/state";
import { updateActiveSet } from "../core/utils";
import { getActiveSetTracks } from "../../shared/utils/setUtils";
import { HELP_TEXT } from "../../shared/helpText";
import { useNameValidation } from "../core/hooks/useNameValidation";
import { useTrackSlots } from "../core/hooks/useTrackSlots";
import { parsePitchClass, pitchClassToName } from "../../shared/midi/midiUtils";
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

  const Meter = useMemo(() => {
    const C = ({
      level,
      threshold,
      testId,
    }: {
      level: number;
      threshold: number;
      testId: string;
    }) => {
      const levelPct = clamp01(level) * 100;
      const thresholdPct = clamp01(threshold) * 100;
      return (
        <div
          className="relative h-2 rounded bg-neutral-800 overflow-hidden border border-neutral-700"
          data-testid={testId}
        >
          <div
            className="absolute inset-y-0 left-0 bg-neutral-400/25"
            style={{ width: `${levelPct}%` }}
          />
          <div
            className="absolute inset-y-0 w-[2px] bg-green-500"
            style={{ left: `${levelPct}%`, transform: "translateX(-1px)" }}
          />
          <div
            className="absolute inset-y-0 w-[2px] bg-neutral-200/80"
            style={{ left: `${thresholdPct}%`, transform: "translateX(-1px)" }}
          />
        </div>
      );
    };
    return C;
  }, []);

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
    }
  }, [isOpen, track]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  if (!isOpen) return null;

  const canSubmit = validation.isValid && trackSlot && availableSlots.includes(trackSlot);

  const handleSubmit = () => {
    if (!canSubmit) return;

    updateActiveSet(setUserData, activeSetId, (activeSet: unknown) => {
      const s = activeSet as Record<string, unknown>;
      const ts = Array.isArray(s.tracks) ? (s.tracks as unknown[]) : [];
      const t = (ts[trackIndex] as Record<string, unknown> | null) || null;
      if (!t) return;
      t.name = trackName.trim();
      t.trackSlot = trackSlot;
      t.signal = {
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
    });

    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalHeader title="EDIT TRACK" onClose={onClose} />

      <div className="px-6 flex flex-col gap-4">
        <div>
          <Label>Track Name</Label>
          <TextInput
            value={trackName}
            onChange={(e) => setTrackName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) {
                handleSubmit();
              }
            }}
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
                          <Meter
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
        <Button onClick={onClose} type="secondary">
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit}>
          Save Changes
        </Button>
      </ModalFooter>
    </Modal>
  );
};

import { useAtom } from "jotai";
import { FaPlay, FaStop } from "react-icons/fa";
import { recordingDataAtom } from "../core/state";
import { Checkbox } from "./FormInputs";
import { Button } from "./Button";

type InputConfig = {
  type?: string;
  port?: number;
  deviceName?: string;
};

type InputStatus = {
  status: string;
  message?: string;
  config?: { input?: InputConfig } | null;
  activeSources?: string[];
};

type LastInputEvent = {
  source: string;
  summary: string;
  type: string;
  ts: number;
};

type DashboardConfig = { sequencerMode?: boolean } & Record<string, unknown>;

type DashboardFooterProps = {
  track: unknown | null;
  isPlaying: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  inputStatus: InputStatus;
  inputConfig: InputConfig | null;
  onSettingsClick: () => void;
  config: DashboardConfig | null;
  isMuted: boolean;
  onMuteChange: (next: boolean) => void;
  isProjectorReady: boolean;
  lastInputEvents?: Record<string, LastInputEvent>;
};

const SOURCE_LABELS: Record<string, string> = {
  midi: "MIDI",
  osc: "OSC",
  websocket: "WS",
  audio: "AUDIO",
  file: "FILE",
};

const formatRelativeTime = (ts: number): string => {
  const delta = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (delta < 1) return "now";
  if (delta < 60) return `${delta}s ago`;
  const mins = Math.floor(delta / 60);
  return `${mins}m ago`;
};

export const DashboardFooter = ({
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
  lastInputEvents,
}: DashboardFooterProps) => {
  const [_recordingData] = useAtom(recordingDataAtom);
  const isFileMode = !config?.sequencerMode && inputConfig?.type === "file";
  const trackObj = track && typeof track === "object" ? (track as Record<string, unknown>) : null;
  const trackSignal =
    trackObj && trackObj.signal && typeof trackObj.signal === "object"
      ? (trackObj.signal as Record<string, unknown>)
      : null;
  const trackFile =
    trackSignal && trackSignal.file && typeof trackSignal.file === "object"
      ? (trackSignal.file as Record<string, unknown>)
      : null;
  const trackFileAssetRelPath =
    trackFile && typeof trackFile.assetRelPath === "string" ? trackFile.assetRelPath : "";

  const getStatusColor = () => {
    switch (inputStatus.status) {
      case "connected":
        return "text-blue-500";
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
        return "\u25CF";
      case "connecting":
        return "\u25D0";
      case "error":
        return "\u2715";
      default:
        return "\u25CB";
    }
  };

  // Build active sources display from status payload
  const activeSources = inputStatus.activeSources || [];

  // Find the most recent input event
  const lastEvent = (() => {
    if (!lastInputEvents) return null;
    const entries = Object.values(lastInputEvents);
    if (entries.length === 0) return null;
    return entries.reduce((a, b) => (a.ts > b.ts ? a : b));
  })();

  const renderSourceBadges = () => {
    if (activeSources.length === 0 && inputConfig?.type) {
      // Fallback: show configured type
      return (
        <span className="text-neutral-500">
          {SOURCE_LABELS[inputConfig.type] || inputConfig.type}
        </span>
      );
    }
    return activeSources.map((s) => (
      <span
        key={s}
        className="inline-flex items-center gap-1 text-blue-500"
      >
        <span className="text-[8px]">{"\u25CF"}</span>
        {SOURCE_LABELS[s] || s}
      </span>
    ));
  };

  const renderLastEvent = () => {
    if (!lastEvent) return null;
    const label = SOURCE_LABELS[lastEvent.source] || lastEvent.source;
    return (
      <span className="text-neutral-500">
        <span className="text-neutral-400">{label}</span>{" "}
        {lastEvent.summary}{" "}
        <span className="text-neutral-600">{formatRelativeTime(lastEvent.ts)}</span>
      </span>
    );
  };

  const inputStatusRow = (
    <div className="w-full flex justify-between items-center gap-4">
      <button
        onClick={onSettingsClick}
        className={`text-[10px] font-mono flex items-center gap-3 cursor-pointer hover:opacity-70 transition-opacity ${getStatusColor()}`}
        title={`${inputStatus.status}: ${inputStatus.message || ""}`}
      >
        <span>{getStatusIcon()}</span>
        <span className="flex items-center gap-2">
          {renderSourceBadges()}
        </span>
      </button>
      {lastEvent && (
        <div className="text-[10px] font-mono">
          {renderLastEvent()}
        </div>
      )}
    </div>
  );

  if (!track) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#101010] border-t border-neutral-800 px-6 py-4">
        <div className="w-full flex justify-start gap-4 items-center">
          <div className="text-neutral-300/30 text-[11px]">No track selected</div>
          {!config?.sequencerMode && inputStatusRow}
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
          {config?.sequencerMode || isFileMode ? (
            <>
              <Button
                onClick={isPlaying ? onStop : onPlayPause}
                className={isPlaying ? "decoration-neutral-300" : ""}
                title={
                  isPlaying
                    ? "Stop playback"
                    : config?.sequencerMode
                      ? "Play sequencer"
                      : "Play file"
                }
                icon={isPlaying ? <FaStop /> : <FaPlay />}
                disabled={
                  (!isProjectorReady && !isPlaying) ||
                  (isFileMode && !trackFileAssetRelPath && !isPlaying)
                }
                as="button"
                data-testid={config?.sequencerMode ? "sequencer-play-toggle" : "file-play-toggle"}
              >
                <span className="relative inline-block">{isPlaying ? "STOP" : "PLAY"}</span>
              </Button>
              <label
                className="flex items-center gap-2 cursor-pointer text-[11px] text-neutral-300 font-mono"
                onClickCapture={(e) => {
                  if (e.detail === 0) return;
                  const input = e.currentTarget.querySelector(
                    'input[type="checkbox"]'
                  ) as HTMLInputElement | null;
                  if (!input) return;
                  setTimeout(() => input.blur(), 0);
                }}
              >
                <Checkbox checked={isMuted} onChange={(e) => onMuteChange(e.target.checked)} />
                <span>Mute</span>
              </label>
            </>
          ) : (
            inputStatusRow
          )}
        </div>
      </div>
    </div>
  );
};

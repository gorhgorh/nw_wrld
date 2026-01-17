import {
  buildMidiConfig,
  normalizeNoteMatchMode,
  noteNumberToTriggerKey,
  pitchClassToName,
} from "../../shared/midi/midiUtils.ts";
import logger from "../helpers/logger";
import { getMessaging } from "./bridge.js";

export function initInputListener() {
  const messaging = getMessaging();
  if (!messaging || typeof messaging.onInputEvent !== "function") return;
  messaging.onInputEvent((event, payload) => {
    const { type, data } = payload;
    const debugEnabled = logger.debugEnabled;

    const isSequencerMode = this.config?.sequencerMode === true;
    const selectedInputType = this.config?.input?.type || "midi";
    const midiConfig = buildMidiConfig(
      this.userData,
      this.config,
      selectedInputType
    );
    if (isSequencerMode) {
      return;
    }
    if (data?.source && data.source !== selectedInputType) {
      return;
    }

    if (debugEnabled) {
      logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      logger.log(`🎵 [INPUT] Event type: ${type}, source: ${data.source}`);
    }

    let trackName = null;
    const timestamp = data.timestamp || performance.now() / 1000;
    const noteMatchMode = normalizeNoteMatchMode(this.config?.input?.noteMatchMode);

    switch (type) {
      case "track-selection":
        if (debugEnabled) logger.log("🎯 [INPUT] Track selection event...");

        if (data.source === "midi") {
          const key = noteNumberToTriggerKey(data.note, noteMatchMode);
          const trackNameFromNote =
            key !== null ? midiConfig.trackTriggersMap[key] : null;
          if (debugEnabled) {
            logger.log(`🎯 [INPUT] Note ${data.note} maps to track:`, trackNameFromNote);
          }

          if (trackNameFromNote) {
            if (debugEnabled) {
              logger.log(`✅ [INPUT] Activating track: "${trackNameFromNote}"`);
            }
            trackName = trackNameFromNote;
            this.handleTrackSelection(trackNameFromNote);
          } else {
            if (debugEnabled) {
              logger.warn(`⚠️ [INPUT] Note ${data.note} not mapped to any track`);
            }
          }
        } else if (data.source === "osc") {
          const trackNameFromIdentifier = midiConfig.trackTriggersMap[data.identifier];
          if (debugEnabled) {
            logger.log(
              `🎯 [INPUT] OSC address ${data.identifier} maps to track:`,
              trackNameFromIdentifier
            );
          }

          if (trackNameFromIdentifier) {
            if (debugEnabled) {
              logger.log(`✅ [INPUT] Activating track: "${trackNameFromIdentifier}"`);
            }
            trackName = trackNameFromIdentifier;
            this.handleTrackSelection(trackNameFromIdentifier);
          } else {
            if (debugEnabled) {
              logger.warn(
                `⚠️ [INPUT] OSC address ${data.identifier} not mapped to any track`
              );
              logger.log("📋 [INPUT] Available OSC mappings:", Object.keys(midiConfig.trackTriggersMap));
            }
          }
        }
        break;

      case "method-trigger":
        if (debugEnabled) {
          logger.log("🎯 [INPUT] Method trigger event...");
          logger.log("🎯 [INPUT] Current active track:", this.activeTrack?.name);
        }

        let channelNames = [];
        const activeTrackName = this.activeTrack?.name;

        if (activeTrackName && midiConfig.channelMappings[activeTrackName]) {
          const trackMappings = midiConfig.channelMappings[activeTrackName];

          if (data.source === "midi") {
            const key = noteNumberToTriggerKey(data.note, noteMatchMode);
            const mappedChannels = key !== null ? trackMappings[key] : null;
            if (mappedChannels) {
              channelNames = Array.isArray(mappedChannels)
                ? mappedChannels
                : [mappedChannels];
              if (debugEnabled) {
                logger.log(`🎯 [INPUT] Note ${data.note} maps to channels:`, channelNames);
              }
            }
          } else if (data.source === "osc") {
            const mappedChannels = trackMappings[data.channelName];
            if (mappedChannels) {
              channelNames = Array.isArray(mappedChannels)
                ? mappedChannels
                : [mappedChannels];
              if (debugEnabled) {
                logger.log(`🎯 [INPUT] OSC address maps to channels:`, channelNames);
              }
            }
          }
        } else {
          if (debugEnabled) {
            logger.warn(`⚠️ [INPUT] No channel mappings for track "${activeTrackName}"`);
          }
        }

        if (channelNames.length > 0 && activeTrackName) {
          trackName = activeTrackName;
          channelNames.forEach((channelName) => {
            if (debugEnabled) {
              logger.log(`✅ [INPUT] Triggering ${channelName} on track "${activeTrackName}"`);
            }
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
          if (debugEnabled) {
            logger.warn(`⚠️ [INPUT] Event not mapped to any channel`);
          }
        } else if (!activeTrackName) {
          if (debugEnabled) {
            logger.warn(`⚠️ [INPUT] No active track - select a track first`);
          }
        }
        break;
    }

    if (this.debugOverlayActive && debugEnabled) {
      const timeStr = timestamp.toFixed(5);
      const source = data.source === "midi" ? "MIDI" : "OSC";
      let log = `[${timeStr}] ${source} Event\n`;
      if (data.source === "midi") {
        const key = noteNumberToTriggerKey(data.note, noteMatchMode);
        const pcName =
          noteMatchMode === "pitchClass" && key !== null ? pitchClassToName(key) : null;
        log += `  Note: ${data.note}${
          key !== null
            ? noteMatchMode === "pitchClass"
              ? ` (pitchClass: ${key} ${pcName || ""})`
              : ` (note: ${key})`
            : ""
        }\n`;
        log += `  Channel: ${data.channel}\n`;
      } else if (data.source === "osc") {
        log += `  Address: ${data.address}\n`;
      }
      if (trackName) {
        log += `  Track: ${trackName}\n`;
      }
      this.queueDebugLog(log);
    }

    if (debugEnabled) logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  });
}


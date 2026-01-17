import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import * as Tone from "tone";
import { produce } from "immer";
import MidiPlayback from "../../../shared/midi/midiPlayback";
import SequencerPlayback from "../../../shared/sequencer/SequencerPlayback";
import SequencerAudio from "../../../shared/audio/sequencerAudio";
import { getActiveSetTracks } from "../../../shared/utils/setUtils";
import { getRecordingForTrack, getSequencerForTrack } from "../../../shared/json/recordingUtils";
import { useLatestRef } from "./useLatestRef";

type UseDashboardPlaybackArgs = {
  userData: any;
  userDataRef: MutableRefObject<any>;
  activeTrackId: string | number | null;
  activeSetId: any;
  activeSetIdRef: MutableRefObject<any>;
  firstVisibleTrack: { track: any; trackIndex: number } | null;
  recordingData: any;
  recordingDataRef: MutableRefObject<any>;
  setRecordingData: any;
  sendToProjector: (type: string, props: Record<string, unknown>) => void;
  flashChannel: (channelName: string, durationMs?: number) => void;
  setFlashingConstructors: (updater: (prev: Set<string>) => Set<string>) => void;
  isSequencerMuted: boolean;
  setIsProjectorReady: (ready: boolean) => void;
  isInitialMountRef: MutableRefObject<boolean>;
};

export const useDashboardPlayback = ({
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
  isInitialMountRef,
}: UseDashboardPlaybackArgs) => {
  const [footerPlaybackState, setFooterPlaybackState] = useState<Record<string, boolean>>({});
  const [isSequencerPlaying, setIsSequencerPlaying] = useState(false);
  const [sequencerCurrentStep, setSequencerCurrentStep] = useState(0);

  const isSequencerPlayingRef = useLatestRef(isSequencerPlaying);
  const sequencerMutedRef = useLatestRef(isSequencerMuted);

  const footerPlaybackEngineRef = useRef<Record<string, MidiPlayback>>({});
  const sequencerEngineRef = useRef<SequencerPlayback | null>(null);
  const sequencerAudioRef = useRef<SequencerAudio | null>(null);
  const sequencerRunIdRef = useRef(0);

  useEffect(() => {
    if (isInitialMountRef.current) {
      return;
    }

    const shouldKeepSequencerPlaying =
      userDataRef.current?.config?.sequencerMode && isSequencerPlayingRef.current;
    if (sequencerEngineRef.current && !shouldKeepSequencerPlaying) {
      sequencerEngineRef.current.stop();
      if (typeof sequencerEngineRef.current.getRunId === "function") {
        sequencerRunIdRef.current = sequencerEngineRef.current.getRunId();
      }
      setIsSequencerPlaying(false);
      setSequencerCurrentStep(0);
    }

    Object.entries(footerPlaybackEngineRef.current).forEach(([_trackId, engine]) => {
      if (engine) {
        engine.stop();
      }
    });
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
  }, [activeTrackId, activeSetId, sendToProjector, setIsProjectorReady, userDataRef, isInitialMountRef, isSequencerPlayingRef]);

  const handleSequencerToggle = useCallback(
    (channelName: string, stepIndex: number) => {
      if (!firstVisibleTrack) return;
      const { track } = firstVisibleTrack;

      setRecordingData(
        produce((draft: any) => {
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
            steps.sort((a: number, b: number) => a - b);
          }
        })
      );

      if (sequencerEngineRef.current && isSequencerPlaying) {
        const sequencerData = getSequencerForTrack(recordingData, track.id as any);
        const updatedPattern = { ...(sequencerData as any).pattern };

        if (!updatedPattern[channelName]) {
          updatedPattern[channelName] = [];
        }

        const steps = [...updatedPattern[channelName]];
        const idx = steps.indexOf(stepIndex);

        if (idx > -1) {
          steps.splice(idx, 1);
        } else {
          steps.push(stepIndex);
          steps.sort((a: number, b: number) => a - b);
        }

        updatedPattern[channelName] = steps;

        const bpm = userData.config.sequencerBpm || 120;
        sequencerEngineRef.current.load(updatedPattern, bpm);
      }
    },
    [firstVisibleTrack, isSequencerPlaying, recordingData, setRecordingData, userData]
  );

  const handleFooterPlayPause = useCallback(async () => {
    if (!firstVisibleTrack) return;
    const { track } = firstVisibleTrack;
    const trackId = track.id as any;
    const config = userData.config;

    if (config.sequencerMode) {
      if (!sequencerEngineRef.current) {
        sequencerEngineRef.current = new SequencerPlayback();

        sequencerEngineRef.current.setOnStepCallback((stepIndex, channels, time, runId) => {
          const hasScheduledTime = typeof time === "number" && Number.isFinite(time);

          if (typeof runId === "number" && runId !== sequencerRunIdRef.current) {
            return;
          }

          channels.forEach((channelName) => {
            if (sequencerAudioRef.current && !sequencerMutedRef.current) {
              const channelNumber = channelName.replace(/^ch/, "");
              sequencerAudioRef.current.playChannelBeep(channelNumber, hasScheduledTime ? time : undefined);
            }
          });

          if (hasScheduledTime) {
            const scheduledRunId = runId;
            Tone.Draw.schedule(() => {
              if (typeof scheduledRunId === "number" && scheduledRunId !== sequencerRunIdRef.current) {
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
        });
      }

      if (!sequencerAudioRef.current) {
        sequencerAudioRef.current = new SequencerAudio();
      }

      if (!isSequencerPlaying) {
        const sequencerData = getSequencerForTrack(recordingData, track.id as any) as any;
        const pattern = sequencerData.pattern || {};
        const bpm = config.sequencerBpm || 120;
        sequencerEngineRef.current.load(pattern, bpm);

        const keys = (track.modules || []).map((moduleInstance: any) => `${track.id}:${moduleInstance.id}`);
        setFlashingConstructors((prev) => {
          const next = new Set(prev);
          keys.forEach((k: string) => next.add(k));
          return next;
        });
        setTimeout(() => {
          setFlashingConstructors((prev) => {
            const next = new Set(prev);
            keys.forEach((k: string) => next.delete(k));
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

        footerPlaybackEngineRef.current[trackId].setOnNoteCallback((channelName: any) => {
          const channelNumber = String(channelName).replace(/^ch/, "");
          flashChannel(channelNumber, 100);

          sendToProjector("channel-trigger", {
            channelName: String(channelName),
          });
        });

        footerPlaybackEngineRef.current[trackId].setOnStopCallback(() => {
          setFooterPlaybackState((prev) => ({ ...prev, [trackId]: false }));
        });

        try {
          const recording = getRecordingForTrack(recordingData, track.id as any) as any;
          if (!recording || !recording.channels || recording.channels.length === 0) {
            alert("No recording available. Trigger some channels first.");
            return;
          }

          const channels = recording.channels.map((ch: any) => ({
            name: ch.name,
            midi: 0,
            sequences: ch.sequences || [],
          }));

          const bpm = track.bpm || 120;
          footerPlaybackEngineRef.current[trackId].load(channels, bpm);
        } catch (error: any) {
          console.error("Error loading recording for playback:", error);
          alert(`Failed to load recording for playback: ${error.message}`);
          return;
        }
      }

      if (!isPlaying) {
        const keys = (track.modules || []).map((moduleInstance: any) => `${track.id}:${moduleInstance.id}`);
        setFlashingConstructors((prev) => {
          const next = new Set(prev);
          keys.forEach((k: string) => next.add(k));
          return next;
        });
        setTimeout(() => {
          setFlashingConstructors((prev) => {
            const next = new Set(prev);
            keys.forEach((k: string) => next.delete(k));
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
    isSequencerPlaying,
    recordingData,
    sendToProjector,
    setFlashingConstructors,
    userData,
    sequencerMutedRef,
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
  }, [firstVisibleTrack, userData]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e as any).code !== "Space") return;

      const target = e.target as any;
      const isTyping =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;

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

    window.addEventListener("keydown", handleKeyDown as any);

    return () => {
      window.removeEventListener("keydown", handleKeyDown as any);
    };
  }, [userData, isSequencerPlaying, handleFooterStop, handleFooterPlayPause]);

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

  useEffect(() => {
    if (!userDataRef.current?.config?.sequencerMode) return;
    if (!isSequencerPlaying) return;
    if (!sequencerEngineRef.current) return;
    if (!activeTrackId) return;

    const tracks = getActiveSetTracks(userDataRef.current || {}, activeSetIdRef.current);
    const track = tracks.find((t) => t.id === activeTrackId) || null;
    if (!track) return;

    const sequencerData = getSequencerForTrack(recordingDataRef.current || {}, track.id as any) as any;
    const pattern = sequencerData.pattern || {};
    const bpm = userDataRef.current?.config?.sequencerBpm || 120;
    sequencerEngineRef.current.load(pattern, bpm);
  }, [activeTrackId, isSequencerPlaying, activeSetIdRef, recordingDataRef, userDataRef]);

  return {
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
  };
};


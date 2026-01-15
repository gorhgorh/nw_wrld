import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAtom } from "jotai";
import { remove } from "lodash";
import { FaPlus } from "react-icons/fa";
import { SortableList, arrayMove } from "../../shared/SortableList.jsx";
import { useIPCSend } from "../../core/hooks/useIPC";
import {
  userDataAtom,
  recordingDataAtom,
  activeSetIdAtom,
  flashingConstructorsAtom,
  helpTextAtom,
  useFlashingChannels,
} from "../../core/state.ts";
import { updateActiveSet } from "../../core/utils";
import { getActiveSetTracks } from "../../../shared/utils/setUtils.ts";
import {
  getRecordingForTrack,
  setRecordingForTrack,
} from "../../../shared/json/recordingUtils.ts";
import MidiPlayback from "../../../shared/midi/midiPlayback.ts";
import { Button } from "../Button";
import { TrackDataModal } from "../../modals/TrackDataModal.jsx";
import { ModuleSelector, SortableModuleItem } from "./ModuleComponents.jsx";

export const TrackItem = React.memo(
  ({
    track,
    trackIndex,
    predefinedModules,
    openRightMenu,
    onConfirmDelete,
    setActiveTrackId,
    inputConfig,
    config,
    isSequencerPlaying,
    sequencerCurrentStep,
    handleSequencerToggle,
    workspacePath = null,
    workspaceModuleFiles = [],
    workspaceModuleLoadFailures = [],
  }) => {
    const [userData, setUserData] = useAtom(userDataAtom);
    const [recordingData] = useAtom(recordingDataAtom);
    const [activeSetId] = useAtom(activeSetIdAtom);
    const [flashingChannels, flashChannel] = useFlashingChannels();
    const [flashingConstructors, setFlashingConstructors] = useAtom(
      flashingConstructorsAtom
    );
    const [selectedTrackForData, setSelectedTrackForData] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const playbackEngineRef = useRef(null);
    const [helpText, setHelpText] = useAtom(helpTextAtom);

    const sendToProjector = useIPCSend("dashboard-to-projector");

    const stopPlayback = useCallback(() => {
      if (playbackEngineRef.current) {
        playbackEngineRef.current.stop();
        setIsPlaying(false);
      }
    }, []);

    const handleAddChannel = useCallback(() => {
      const existingChannelNumbers = new Set(
        Object.keys(track?.channelMappings || {}).map(Number)
      );

      let nextChannel = null;
      for (let i = 1; i <= 12; i++) {
        if (!existingChannelNumbers.has(i)) {
          nextChannel = i;
          break;
        }
      }

      if (!nextChannel) {
        alert("All 12 channels are already in use.");
        return;
      }

      updateActiveSet(setUserData, activeSetId, (activeSet) => {
        const currentTrack = activeSet.tracks[trackIndex];
        if (!currentTrack.channelMappings) {
          currentTrack.channelMappings = {};
        }
        currentTrack.channelMappings[String(nextChannel)] = nextChannel;
      });
    }, [track, trackIndex, setUserData]);


    const handleRemoveModule = useCallback(
      (instanceId) => {
        const module = track.modules.find((m) => m.id === instanceId);
        if (!module) return;

        onConfirmDelete(
          `Are you sure you want to delete the ${module.type} module?`,
          () => {
            updateActiveSet(setUserData, activeSetId, (activeSet) => {
              const track = activeSet.tracks[trackIndex];
              remove(track.modules, (m) => m.id === instanceId);
              delete track.modulesData[instanceId];
            });
          }
        );
      },
      [setUserData, trackIndex, track.modules, onConfirmDelete, activeSetId]
    );

    const handleRemoveChannel = useCallback(
      (channelName) => {
        onConfirmDelete(
          `Are you sure you want to delete channel ${channelName}?`,
          () => {
            updateActiveSet(setUserData, activeSetId, (activeSet) => {
              const currentTrack = activeSet.tracks[trackIndex];

              delete currentTrack.channelMappings[channelName];

              Object.keys(currentTrack.modulesData).forEach((moduleId) => {
                if (currentTrack.modulesData[moduleId].methods) {
                  delete currentTrack.modulesData[moduleId].methods[
                    channelName
                  ];
                }
              });
            });
          }
        );
      },
      [setUserData, trackIndex, onConfirmDelete]
    );

    const handlePlayPause = useCallback(async () => {
      if (!playbackEngineRef.current) {
        playbackEngineRef.current = new MidiPlayback();

        playbackEngineRef.current.setOnNoteCallback((channelName, midiNote) => {
          flashChannel(channelName, 100);

          sendToProjector("channel-trigger", {
            channelName: channelName,
          });
        });

        playbackEngineRef.current.setOnStopCallback(() => {
          setIsPlaying(false);
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
          playbackEngineRef.current.load(channels, bpm);
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

        playbackEngineRef.current.play();
        setIsPlaying(true);
      }
    }, [
      isPlaying,
      recordingData,
      track.id,
      track.bpm,
      track.name,
      track.modules,
      flashChannel,
      setFlashingConstructors,
    ]);

    const handleStop = useCallback(() => {
      if (playbackEngineRef.current) {
        playbackEngineRef.current.stop();
        setIsPlaying(false);
      }
    }, []);

    useEffect(() => {
      return () => {
        if (playbackEngineRef.current) {
          playbackEngineRef.current.stop();
        }
      };
    }, []);

    return (
      <div className="mb-4 pb-4 font-mono">
        <div className="flex flex-col h-full w-full mb-4 relative">
          <div className="relative">
            <ModuleSelector
              trackIndex={trackIndex}
              predefinedModules={predefinedModules}
              openRightMenu={openRightMenu}
              stopPlayback={stopPlayback}
              onShowTrackData={(track) => {
                setSelectedTrackForData(track);
              }}
              inputConfig={inputConfig}
            />
            {track.modules.length > 0 && (
              <div className="absolute left-[11px] bottom-0 w-[2px] bg-neutral-800 h-4" />
            )}
          </div>

          <div className="mb-6 relative">
            {track.modules.length === 0 ? (
              <div className="pl-12 text-neutral-300/30 text-[11px]">
                [NO MODULES ADDED]
              </div>
            ) : (
              <>
                <div
                  className="absolute left-[11px] top-0 w-[2px] bg-neutral-800"
                  style={{ height: `calc(100% - 8px)` }}
                />
                <SortableList
                  items={track.modules}
                  onReorder={(oldIndex, newIndex) => {
                    updateActiveSet(setUserData, activeSetId, (activeSet) => {
                      const modules = activeSet.tracks[trackIndex].modules;
                      activeSet.tracks[trackIndex].modules = arrayMove(
                        modules,
                        oldIndex,
                        newIndex
                      );
                    });
                  }}
                >
                  {track.modules.map((moduleInstance, index) => (
                    <div
                      key={moduleInstance.id}
                      className="relative mb-4 last:mb-0"
                    >
                      <div className="relative flex items-start">
                        <div className="absolute left-[11px] top-[8px] w-[25px] h-[2px] bg-neutral-800" />
                        <div
                          className="absolute left-[11px] top-[9px] w-[6px] h-[6px] bg-neutral-800 rounded-full"
                          style={{ transform: "translate(-50%, -50%)" }}
                        />
                        <div className="flex-1">
                          <SortableModuleItem
                            id={moduleInstance.id}
                            moduleInstance={moduleInstance}
                            trackIndex={trackIndex}
                            predefinedModules={predefinedModules}
                            onRemoveModule={handleRemoveModule}
                            inputConfig={inputConfig}
                            config={config}
                            isSequencerPlaying={isSequencerPlaying}
                            sequencerCurrentStep={sequencerCurrentStep}
                            handleSequencerToggle={handleSequencerToggle}
                            workspacePath={workspacePath}
                            workspaceModuleFiles={workspaceModuleFiles}
                            workspaceModuleLoadFailures={workspaceModuleLoadFailures}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </SortableList>
              </>
            )}
          </div>

          <div className="flex items-center gap-6 mb-4">
            <Button onClick={() => openRightMenu(trackIndex)} icon={<FaPlus />}>
              MODULE
            </Button>
            <Button
              onClick={handleAddChannel}
              icon={<FaPlus />}
              disabled={track.modules.length === 0}
              className={
                track.modules.length === 0
                  ? "opacity-50 cursor-not-allowed"
                  : ""
              }
              title={
                track.modules.length === 0
                  ? "Add a module first"
                  : "Add Channel"
              }
            >
              CHANNEL
            </Button>
          </div>
        </div>

        <TrackDataModal
          isOpen={!!selectedTrackForData}
          onClose={() => setSelectedTrackForData(null)}
          trackData={selectedTrackForData}
        />
      </div>
    );
  }
);


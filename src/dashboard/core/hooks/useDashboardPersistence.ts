import { useEffect, useRef } from "react";
import { getActiveSetTracks } from "../../../shared/utils/setUtils";
import { loadAppState, saveAppState, loadAppStateSync, saveAppStateSync } from "../../../shared/json/appStateUtils";
import { saveRecordingData, saveRecordingDataSync } from "../../../shared/json/recordingUtils";
import { saveUserData, saveUserDataSync } from "../utils";

type UseDashboardPersistenceArgs = {
  isInitialMountRef: { current: boolean };
  userDataLoadedSuccessfullyRef: { current: boolean };
  userData: any;
  recordingData: any;
  activeTrackId: any;
  activeSetId: any;
  userDataRef: { current: any };
  recordingDataRef: { current: any };
  activeTrackIdRef: { current: any };
  activeSetIdRef: { current: any };
  workspacePathRef: { current: any };
  sequencerMutedRef: { current: any };
  sendToProjector: (type: string, props: Record<string, unknown>) => void;
  isSequencerMuted: boolean;
};

export const useDashboardPersistence = ({
  isInitialMountRef,
  userDataLoadedSuccessfullyRef,
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
}: UseDashboardPersistenceArgs) => {
  const userDataSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingDataSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isInitialMountRef.current) {
      return;
    }

    if (!userDataLoadedSuccessfullyRef.current) {
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
  }, [userData, activeSetId, activeTrackId, sendToProjector, isInitialMountRef, userDataLoadedSuccessfullyRef]);

  useEffect(() => {
    if (isInitialMountRef.current) {
      return;
    }

    const debouncedSave = setTimeout(async () => {
      await saveRecordingData(recordingData);
      recordingDataSaveTimeoutRef.current = null;
    }, 500);
    recordingDataSaveTimeoutRef.current = debouncedSave;
    return () => clearTimeout(debouncedSave);
  }, [recordingData, isInitialMountRef]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      try {
        if (isInitialMountRef.current) {
          return;
        }

        if (userDataSaveTimeoutRef.current) {
          clearTimeout(userDataSaveTimeoutRef.current);
          userDataSaveTimeoutRef.current = null;
        }
        if (recordingDataSaveTimeoutRef.current) {
          clearTimeout(recordingDataSaveTimeoutRef.current);
          recordingDataSaveTimeoutRef.current = null;
        }

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
  }, [
    isInitialMountRef,
    userDataRef,
    recordingDataRef,
    activeTrackIdRef,
    activeSetIdRef,
    sequencerMutedRef,
    workspacePathRef,
  ]);

  useEffect(() => {
    if (isInitialMountRef.current) {
      return;
    }

    const updateAppState = async () => {
      const currentState = await loadAppState();
      const preservedWorkspacePath = workspacePathRef.current ?? (currentState as any).workspacePath ?? null;
      const stateToSave = {
        ...(currentState as any),
        activeTrackId,
        activeSetId,
        sequencerMuted: isSequencerMuted,
        workspacePath: preservedWorkspacePath,
      };
      await saveAppState(stateToSave);
    };
    updateAppState();
  }, [isSequencerMuted, activeTrackId, activeSetId, isInitialMountRef, workspacePathRef]);
};


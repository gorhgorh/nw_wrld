import { useEffect } from "react";
import { getProjectDir } from "../../../shared/utils/projectDir";
import { getActiveSetTracks } from "../../../shared/utils/setUtils";
import { loadRecordingData } from "../../../shared/json/recordingUtils";
import { loadAppState } from "../../../shared/json/appStateUtils";
import { loadUserData } from "../utils";
import { useIPCListener } from "./useIPC";

type UseDashboardBootstrapArgs = {
  isInitialMountRef: { current: boolean };
  userDataLoadedSuccessfullyRef: { current: boolean };
  workspacePathRef: { current: string | null };
  setUserData: (next: any) => void;
  setRecordingData: (next: any) => void;
  setActiveTrackId: (id: any) => void;
  setActiveSetId: (id: any) => void;
  setInputConfig: (cfg: any) => void;
  setIsSequencerMuted: (next: boolean) => void;
  setWorkspacePath: (next: string | null) => void;
  setWorkspaceModalMode: (mode: "initial" | "lostSync") => void;
  setWorkspaceModalPath: (path: string | null) => void;
  setIsWorkspaceModalOpen: (open: boolean) => void;
};

export const useDashboardBootstrap = ({
  isInitialMountRef,
  userDataLoadedSuccessfullyRef,
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
}: UseDashboardBootstrapArgs) => {
  useEffect(() => {
    const initializeUserData = async () => {
      const data = (await loadUserData()) as any;

      if (data?._loadedSuccessfully) {
        userDataLoadedSuccessfullyRef.current = true;
      }

      const recordings = await loadRecordingData();

      const appState = (await loadAppState()) as any;
      const activeTrackIdToUse = appState?.activeTrackId;
      const activeSetIdToUse = appState?.activeSetId;
      const sequencerMutedToUse = appState?.sequencerMuted;
      const projectDirRaw = getProjectDir();
      const workspacePathToUse =
        typeof projectDirRaw === "string" && projectDirRaw ? projectDirRaw : null;
      workspacePathRef.current = workspacePathToUse;
      setIsSequencerMuted(Boolean(sequencerMutedToUse));
      setWorkspacePath(workspacePathToUse);
      if (!workspacePathToUse) {
        setWorkspaceModalMode("initial");
        setWorkspaceModalPath(null);
        setIsWorkspaceModalOpen(true);
      } else {
        const bridge = (globalThis as any).nwWrldBridge;
        const isAvailable =
          bridge && bridge.project && typeof bridge.project.isDirAvailable === "function"
            ? bridge.project.isDirAvailable()
            : false;
        if (!isAvailable) {
          setWorkspaceModalMode("lostSync");
          setWorkspaceModalPath(workspacePathToUse);
          setIsWorkspaceModalOpen(true);
        }
      }

      if (activeSetIdToUse) {
        setActiveSetId(activeSetIdToUse);
      }

      setUserData(data);
      setRecordingData(recordings);

      const cfg = data?.config || null;
      if (cfg && cfg.input) {
        setInputConfig(cfg.input);
      }

      const tracks = getActiveSetTracks(data, activeSetIdToUse);
      if (tracks.length > 0) {
        const storedTrack = activeTrackIdToUse ? tracks.find((t) => t.id === activeTrackIdToUse) : null;
        if (storedTrack) {
          setActiveTrackId(storedTrack.id);
        } else {
          const visibleTrack = tracks.find((t) => t.isVisible);
          const firstTrack = visibleTrack || tracks[0];
          setActiveTrackId(firstTrack.id);
        }
      }

      isInitialMountRef.current = false;
    };

    initializeUserData();
  }, []);

  useIPCListener("workspace:lostSync", (_event, payload: any) => {
    const lostPath = payload?.workspacePath || workspacePathRef.current || null;
    setWorkspaceModalMode("lostSync");
    setWorkspaceModalPath(lostPath);
    setIsWorkspaceModalOpen(true);
  });
};


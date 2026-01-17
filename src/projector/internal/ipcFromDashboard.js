import { find, isEqual } from "lodash";
import { getMessaging } from "./bridge.js";

export function initDashboardIpc() {
  const messaging = getMessaging();
  if (messaging && typeof messaging.onFromDashboard === "function") {
    messaging.onFromDashboard((event, data) => {
      try {
        if (!data || typeof data !== "object") {
          console.error("❌ [PROJECTOR-IPC] Invalid IPC message received:", data);
          return;
        }

        const { type, props = {} } = data;

        if (!type) {
          console.error("❌ [PROJECTOR-IPC] Message missing type field:", data);
          return;
        }

        if (type === "module-introspect") {
          const moduleId = props?.moduleId || null;
          if (!moduleId) return;
          this.introspectModule(moduleId).then((result) => {
            const messaging = getMessaging();
            messaging?.sendToDashboard?.("module-introspect-result", result);
          });
          return;
        }

        if (type === "toggleAspectRatioStyle") {
          if (!props.name) {
            console.error("❌ [PROJECTOR-IPC] toggleAspectRatioStyle missing name");
            return;
          }
          return this.toggleAspectRatioStyle(props.name);
        }

        if (type === "setBg") {
          if (!props.value) {
            console.error("❌ [PROJECTOR-IPC] setBg missing value");
            return;
          }
          return this.setBg(props.value);
        }

        if (type === "preview-module") {
          if (!props.moduleName) {
            console.error("❌ [PROJECTOR-IPC] preview-module missing moduleName");
            return;
          }
          return this.previewModule(
            props.moduleName,
            props.moduleData,
            props.requestId || null
          );
        }

        if (type === "clear-preview") {
          return this.clearPreview();
        }

        if (type === "trigger-preview-method") {
          if (!props.moduleName || !props.methodName) {
            console.error(
              "❌ [PROJECTOR-IPC] trigger-preview-method missing moduleName or methodName"
            );
            return;
          }
          return this.triggerPreviewMethod(
            props.moduleName,
            props.methodName,
            props.options || {}
          );
        }

        if (type === "refresh-projector") {
          return this.refreshPage();
        }

        if (type === "reload-data") {
          if (this.isLoadingTrack) {
            this.pendingReloadData = {
              setId: props.setId,
              trackName: props.trackName || this.activeTrack?.name,
            };
            return;
          }

          const currentTrackName = props.trackName || this.activeTrack?.name;
          this.loadUserData(props.setId);
          this.applyConfigSettings();

          if (currentTrackName) {
            const nextTrack = find(this.userData, { name: currentTrackName });
            if (
              this.activeTrack &&
              this.activeTrack.name === currentTrackName &&
              nextTrack &&
              isEqual(
                {
                  name: this.activeTrack.name,
                  modules: this.activeTrack.modules,
                  modulesData: this.activeTrack.modulesData,
                  channelMappings: this.activeTrack.channelMappings,
                },
                {
                  name: nextTrack.name,
                  modules: nextTrack.modules,
                  modulesData: nextTrack.modulesData,
                  channelMappings: nextTrack.channelMappings,
                }
              )
            ) {
              return;
            }
            this.deactivateActiveTrack();
            return this.handleTrackSelection(currentTrackName);
          }
          return;
        }

        if (type === "set-activate") {
          this.loadUserData(props.setId);
          this.deactivateActiveTrack();
          return;
        }

        if (type === "track-activate") {
          if (!props.trackName) {
            console.error("❌ [PROJECTOR-IPC] track-activate missing trackName");
            return;
          }
          return this.handleTrackSelection(props.trackName);
        }

        if (type === "channel-trigger") {
          let channelNumber = props.channelNumber;

          if (!channelNumber && props.channelName) {
            const match = String(props.channelName).match(/^ch(\d+)$/i);
            channelNumber = match ? match[1] : props.channelName;
          }

          if (!channelNumber) {
            console.error(
              "❌ [PROJECTOR-IPC] channel-trigger missing channelNumber/channelName"
            );
            return;
          }

          console.log("🎵 [PROJECTOR-IPC] Channel trigger:", channelNumber);
          return this.handleChannelMessage(`/Ableton/${channelNumber}`);
        }

        if (type === "debug-overlay-visibility") {
          if (typeof props.isOpen !== "boolean") {
            console.error(
              "❌ [PROJECTOR-IPC] debug-overlay-visibility missing isOpen"
            );
            return;
          }
          this.debugOverlayActive = props.isOpen;
          if (!props.isOpen) {
            if (this.debugLogTimeout) {
              clearTimeout(this.debugLogTimeout);
              this.debugLogTimeout = null;
            }
            this.debugLogQueue = [];
          }
          return;
        }
      } catch (error) {
        console.error("❌ [PROJECTOR-IPC] Error processing IPC message:", error);
        console.error("❌ [PROJECTOR-IPC] Error stack:", error.stack);
        console.error("❌ [PROJECTOR-IPC] Message that caused error:", data);
      }
    });
  }
}


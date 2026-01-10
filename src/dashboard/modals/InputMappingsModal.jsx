import React, { useState } from "react";
import { useAtom } from "jotai";
import { Modal } from "../shared/Modal.jsx";
import { ModalHeader } from "../components/ModalHeader.js";
import { TextInput, RadioButton } from "../components/FormInputs.js";
import { userDataAtom } from "../core/state.js";
import { updateUserData } from "../core/utils.js";
import { DEFAULT_GLOBAL_MAPPINGS } from "../../shared/config/defaultConfig.js";

export const InputMappingsModal = ({ isOpen, onClose }) => {
  const [userData, setUserData] = useAtom(userDataAtom);
  const [activeTab, setActiveTab] = useState("midi");

  const trackMappings = userData.config?.trackMappings || {};
  const channelMappings = userData.config?.channelMappings || {};

  const updateTrackMapping = (slot, value) => {
    updateUserData(setUserData, (draft) => {
      if (!draft.config.trackMappings) {
        draft.config.trackMappings = DEFAULT_GLOBAL_MAPPINGS.trackMappings;
      }
      draft.config.trackMappings[activeTab][slot] = value;
    });
  };

  const updateChannelMapping = (slot, value) => {
    updateUserData(setUserData, (draft) => {
      if (!draft.config.channelMappings) {
        draft.config.channelMappings = DEFAULT_GLOBAL_MAPPINGS.channelMappings;
      }
      draft.config.channelMappings[activeTab][slot] = value;
    });
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="large">
      <ModalHeader title="INPUT MAPPINGS" onClose={onClose} />

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2 border-b border-neutral-800 pb-4 font-mono">
          <div className="text-neutral-300 text-[11px]">Mapping Type:</div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3 py-1">
              <RadioButton
                id="input-mappings-midi"
                name="input-mappings-tab"
                value="midi"
                checked={activeTab === "midi"}
                onChange={() => setActiveTab("midi")}
              />
              <label
                htmlFor="input-mappings-midi"
                className="cursor-pointer text-[11px] font-mono text-neutral-300"
              >
                MIDI
              </label>
            </div>
            <div className="flex items-center gap-3 py-1">
              <RadioButton
                id="input-mappings-osc"
                name="input-mappings-tab"
                value="osc"
                checked={activeTab === "osc"}
                onChange={() => setActiveTab("osc")}
              />
              <label
                htmlFor="input-mappings-osc"
                className="cursor-pointer text-[11px] font-mono text-neutral-300"
              >
                OSC
              </label>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div>
            <div className="text-neutral-300 text-[11px] mb-3 font-mono">
              Track Trigger Mappings (1-10):
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((slot) => (
                <div key={slot} className="flex items-center gap-2">
                  <span className="text-neutral-500 text-[11px] font-mono w-12">
                    Track {slot}:
                  </span>
                  <TextInput
                    value={trackMappings[activeTab]?.[slot] || ""}
                    onChange={(e) => updateTrackMapping(slot, e.target.value)}
                    className="flex-1 text-[11px]"
                    placeholder={
                      activeTab === "midi" ? "C-1" : `/track/${slot}`
                    }
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-neutral-300 text-[11px] mb-3 font-mono">
              Trigger Slot Mappings (1-16):
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map(
                (slot) => (
                  <div key={slot} className="flex items-center gap-2">
                    <span className="text-neutral-500 text-[11px] font-mono w-12">
                      Ch {slot}:
                    </span>
                    <TextInput
                      value={channelMappings[activeTab]?.[slot] || ""}
                      onChange={(e) =>
                        updateChannelMapping(slot, e.target.value)
                      }
                      className="flex-1 text-[11px]"
                      placeholder={activeTab === "midi" ? "E7" : `/ch/${slot}`}
                    />
                  </div>
                )
              )}
            </div>
          </div>
        </div>

        <div className="text-neutral-500 text-[10px] font-mono border-t border-neutral-800 pt-4">
          These mappings define what trigger values are used for each slot
          across all tracks.
        </div>
      </div>
    </Modal>
  );
};

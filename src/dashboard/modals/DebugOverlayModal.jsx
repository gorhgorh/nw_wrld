import React, { useRef, useEffect, useMemo } from "react";
import { Button } from "../components/Button";
import { HelpIcon } from "../components/HelpIcon";
import { HELP_TEXT } from "../../shared/helpText.ts";

const renderColoredLog = (log) => {
  const lines = log.split("\n");
  const parts = [];

  lines.forEach((line, lineIndex) => {
    if (line.trim() === "") {
      parts.push(<span key={`line-${lineIndex}`}>{line}</span>);
      return;
    }

    const timestampMatch = line.match(/^(\[[\d.]+?\])/);
    if (timestampMatch) {
      const timestamp = timestampMatch[1];
      const rest = line.slice(timestamp.length);
      parts.push(
        <span key={`timestamp-${lineIndex}`} className="text-neutral-300/30">
          {timestamp}
        </span>
      );
      parts.push(<span key={`rest-${lineIndex}`}>{rest}</span>);
      return;
    }

    if (line.startsWith("  ")) {
      const labelMatch = line.match(/^  ([A-Za-z]+):\s*(.*)$/);
      if (labelMatch) {
        const [, label, value] = labelMatch;
        parts.push(
          <span key={`indent-${lineIndex}`}> </span>,
          <span key={`label-${lineIndex}`} className="text-neutral-300/60">
            {label}:
          </span>
        );

        if (label === "Method") {
          parts.push(
            <span key={`value-${lineIndex}`} className="text-neutral-300">
              {" "}
              <span className="text-[rgba(255,150,150,0.9)] font-medium">
                {value}
              </span>
            </span>
          );
        } else if (label === "Track" || label === "Module") {
          parts.push(
            <span key={`value-${lineIndex}`} className="text-neutral-300">
              {" "}
              <span className="text-neutral-300">{value}</span>
            </span>
          );
        } else if (label === "Props") {
          try {
            const jsonMatch = value.match(/^(\{[\s\S]*\})$/);
            if (jsonMatch) {
              const jsonStr = jsonMatch[1];
              const jsonParts = [];
              let inString = false;
              let stringChar = null;
              let currentPart = "";
              let keyMode = true;

              for (let i = 0; i < jsonStr.length; i++) {
                const char = jsonStr[i];
                const prevChar = jsonStr[i - 1];

                if ((char === '"' || char === "'") && prevChar !== "\\") {
                  if (!inString) {
                    inString = true;
                    stringChar = char;
                    if (currentPart.trim()) {
                      jsonParts.push(
                        <span
                          key={`json-${i}-struct`}
                          className="text-neutral-300/30"
                        >
                          {currentPart}
                        </span>
                      );
                      currentPart = "";
                    }
                    currentPart += char;
                  } else if (char === stringChar) {
                    inString = false;
                    stringChar = null;
                    currentPart += char;
                    jsonParts.push(
                      <span
                        key={`json-${i}-string`}
                        className="text-[rgba(180,120,120,0.85)]"
                      >
                        {currentPart}
                      </span>
                    );
                    currentPart = "";
                    keyMode = false;
                  } else {
                    currentPart += char;
                  }
                } else if (inString) {
                  currentPart += char;
                } else if (char === ":" && !inString) {
                  if (currentPart.trim()) {
                    jsonParts.push(
                      <span
                        key={`json-${i}-key`}
                        className="text-neutral-300/70"
                      >
                        {currentPart}
                      </span>
                    );
                    currentPart = "";
                  }
                  jsonParts.push(
                    <span
                      key={`json-${i}-colon`}
                      className="text-neutral-300/30"
                    >
                      {char}
                    </span>
                  );
                  keyMode = false;
                } else if (
                  (char === "," || char === "{" || char === "}") &&
                  !inString
                ) {
                  if (currentPart.trim()) {
                    jsonParts.push(
                      <span
                        key={`json-${i}-value`}
                        className="text-neutral-300"
                      >
                        {currentPart}
                      </span>
                    );
                    currentPart = "";
                  }
                  jsonParts.push(
                    <span
                      key={`json-${i}-struct`}
                      className="text-neutral-300/30"
                    >
                      {char}
                    </span>
                  );
                  keyMode = char === ",";
                } else {
                  currentPart += char;
                }
              }

              if (currentPart.trim()) {
                jsonParts.push(
                  <span key={`json-final`} className="text-neutral-300">
                    {currentPart}
                  </span>
                );
              }

              parts.push(
                <span key={`value-${lineIndex}`} className="text-neutral-300">
                  {" "}
                  {jsonParts}
                </span>
              );
            } else {
              parts.push(
                <span key={`value-${lineIndex}`} className="text-neutral-300">
                  {" "}
                  {value}
                </span>
              );
            }
          } catch (e) {
            parts.push(
              <span key={`value-${lineIndex}`} className="text-neutral-300">
                {" "}
                {value}
              </span>
            );
          }
        } else {
          parts.push(
            <span key={`value-${lineIndex}`} className="text-neutral-300">
              {" "}
              {value}
            </span>
          );
        }
      } else {
        parts.push(<span key={`line-${lineIndex}`}>{line}</span>);
      }
    } else {
      const eventTypeMatch = line.match(/^(MIDI Event|Method Execution)/);
      if (eventTypeMatch) {
        const eventType = eventTypeMatch[1];
        const rest = line.slice(eventType.length);
        parts.push(
          <span key={`event-${lineIndex}`} className="text-neutral-300/80">
            {eventType}
          </span>
        );
        if (rest) {
          parts.push(<span key={`rest-event-${lineIndex}`}>{rest}</span>);
        }
      } else {
        parts.push(<span key={`line-${lineIndex}`}>{line}</span>);
      }
    }
  });

  return <>{parts}</>;
};

const LogItem = React.memo(({ log, index }) => {
  return (
    <div className="flex flex-wrap gap-x-2 mb-1">{renderColoredLog(log)}</div>
  );
});

LogItem.displayName = "LogItem";

export const DebugOverlayModal = React.memo(
  ({ isOpen, onClose, debugLogs }) => {
    const logContainerRef = useRef(null);
    const scrollTimeoutRef = useRef(null);

    const visibleLogs = useMemo(() => {
      return debugLogs.slice(-200);
    }, [debugLogs]);

    useEffect(() => {
      if (!isOpen || !logContainerRef.current) return;

      if (scrollTimeoutRef.current) {
        cancelAnimationFrame(scrollTimeoutRef.current);
      }

      scrollTimeoutRef.current = requestAnimationFrame(() => {
        if (logContainerRef.current) {
          logContainerRef.current.scrollTop =
            logContainerRef.current.scrollHeight;
        }
      });

      return () => {
        if (scrollTimeoutRef.current) {
          cancelAnimationFrame(scrollTimeoutRef.current);
        }
      };
    }, [visibleLogs, isOpen]);

    if (!isOpen) return null;

    return (
      <div className="fixed inset-0 z-[100] bg-[#101010] font-mono flex flex-col">
        <div className="px-6 py-4 border-b border-neutral-800 flex justify-between items-center">
          <span className="relative uppercase text-neutral-300">
            DEBUG
            <HelpIcon helpText={HELP_TEXT.debugOverlay} />
          </span>
          <Button onClick={onClose} type="secondary">
            CLOSE
          </Button>
        </div>
        <div
          ref={logContainerRef}
          className="flex-1 overflow-y-auto px-6 py-4 text-neutral-300 text-[11px] leading-[1.5] [scrollbar-width:none] [-ms-overflow-style:none] hide-scrollbar"
        >
          {visibleLogs.length === 0 ? (
            <div className="text-neutral-300/30">
              No debug logs yet. External inputs, track selections, and method
              triggers will appear here.
            </div>
          ) : (
            visibleLogs.map((log, index) => (
              <LogItem
                key={`${index}-${log.slice(0, 20)}`}
                log={log}
                index={index}
              />
            ))
          )}
        </div>
      </div>
    );
  }
);

DebugOverlayModal.displayName = "DebugOverlayModal";

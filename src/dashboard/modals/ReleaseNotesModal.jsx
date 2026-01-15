import React, { useEffect, useMemo, useState } from "react";
import { Modal } from "../shared/Modal.jsx";
import { ModalHeader } from "../components/ModalHeader";
import { ModalFooter } from "../components/ModalFooter";
import { Button } from "../components/Button";

const REQUEST_TIMEOUT_MS = 6000;

const getBridge = () => globalThis.nwWrldBridge;

const parseRepoFromUrl = (repoUrl) => {
  const raw = String(repoUrl || "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/^git\+/i, "");

  try {
    const u = new URL(normalized);
    if (!u.hostname.endsWith("github.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, "");
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
};

const formatDate = (iso) => {
  const raw = String(iso || "").trim();
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
};

const openExternal = (url) => {
  const u = String(url || "").trim();
  if (!u) return;
  const bridge = getBridge();
  if (bridge?.os?.openExternal) {
    bridge.os.openExternal(u);
    return;
  }
  try {
    window.open(u, "_blank", "noopener,noreferrer");
  } catch {}
};

export const ReleaseNotesModal = ({ isOpen, onClose }) => {
  const repoInfo = useMemo(() => {
    const bridge = getBridge();
    const repoUrl =
      bridge && bridge.app && typeof bridge.app.getRepositoryUrl === "function"
        ? bridge.app.getRepositoryUrl()
        : null;
    return parseRepoFromUrl(repoUrl);
  }, []);

  const currentVersion = useMemo(() => {
    const bridge = getBridge();
    return bridge?.app?.getVersion ? bridge.app.getVersion() : null;
  }, []);

  const [status, setStatus] = useState("idle");
  const [releases, setReleases] = useState([]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const controller = new AbortController();

    const run = async () => {
      if (!repoInfo?.owner || !repoInfo?.repo) {
        setStatus("error");
        return;
      }

      setStatus("loading");
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const apiUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/releases?per_page=30&page=1`;
        const res = await fetch(apiUrl, {
          method: "GET",
          headers: { Accept: "application/vnd.github+json" },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        const json = await res.json();
        const list = Array.isArray(json) ? json : [];
        const cleaned = list
          .filter((r) => r && r.draft !== true)
          .map((r) => ({
            id: r.id,
            tag: r.tag_name ? String(r.tag_name) : "",
            name: r.name ? String(r.name) : "",
            url: r.html_url ? String(r.html_url) : "",
            prerelease: r.prerelease === true,
            publishedAt: r.published_at ? String(r.published_at) : "",
            body: r.body ? String(r.body) : "",
          }))
          .filter((r) => r.tag && r.url);

        if (cancelled) return;
        setReleases(cleaned);
        setStatus("ready");
      } catch {
        if (cancelled) return;
        setStatus("error");
      } finally {
        clearTimeout(timeout);
      }
    };

    run();

    return () => {
      cancelled = true;
      try {
        controller.abort();
      } catch {}
    };
  }, [isOpen, repoInfo?.owner, repoInfo?.repo]);

  const releasesPageUrl =
    repoInfo?.owner && repoInfo?.repo
      ? `https://github.com/${repoInfo.owner}/${repoInfo.repo}/releases`
      : null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="large">
      <ModalHeader title="RELEASES" onClose={onClose} />

      <div className="flex flex-col gap-4">
        <div className="text-neutral-300/70">
          Current version:{" "}
          <span className="text-neutral-300">
            {currentVersion || "unknown"}
          </span>
        </div>

        {status === "loading" ? (
          <div className="text-neutral-300/30 text-[11px]">
            Loading releases…
          </div>
        ) : status === "error" ? (
          <div className="text-neutral-300/30 text-[11px]">
            Failed to load releases.
          </div>
        ) : releases.length === 0 ? (
          <div className="text-neutral-300/30 text-[11px]">
            No releases found.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {releases.map((r) => (
              <div
                key={r.id}
                className="border border-neutral-800 bg-[#101010] p-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <div className="text-neutral-300">
                      <span className="opacity-50">
                        {r.prerelease ? "[PRE] " : ""}
                      </span>
                      {r.tag}
                      {r.name ? (
                        <span className="opacity-50"> — {r.name}</span>
                      ) : null}
                    </div>
                    <div className="text-[10px] text-neutral-500">
                      {r.publishedAt
                        ? `Published: ${formatDate(r.publishedAt)}`
                        : ""}
                    </div>
                  </div>
                  <Button onClick={() => openExternal(r.url)}>OPEN</Button>
                </div>

                {r.body ? (
                  <div className="mt-3 whitespace-pre-wrap text-neutral-300/70">
                    {r.body}
                  </div>
                ) : (
                  <div className="mt-3 text-neutral-300/30">No notes.</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <ModalFooter>
        {releasesPageUrl ? (
          <Button onClick={() => openExternal(releasesPageUrl)}>
            OPEN RELEASES PAGE
          </Button>
        ) : null}
      </ModalFooter>
    </Modal>
  );
};

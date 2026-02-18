type ImplFn = (value: unknown) => unknown;
type AsyncImplFn = (value: unknown) => Promise<unknown>;

type CreateSdkHelpersArgs = {
  assetUrlImpl?: ImplFn;
  readTextImpl?: AsyncImplFn;
  normalizeRelPath?: ImplFn;
};

export const createSdkHelpers = (
  { assetUrlImpl, readTextImpl, normalizeRelPath }: CreateSdkHelpersArgs = {}
) => {
  const normalize = (relPath: unknown) => {
    if (typeof normalizeRelPath === "function") {
      try {
        return normalizeRelPath(relPath);
      } catch {
        return null;
      }
    }
    return relPath;
  };

  const assetUrl = (relPath: unknown) => {
    const safe = normalize(relPath);
    if (safe == null) return null;
    if (typeof assetUrlImpl !== "function") return null;
    try {
      return assetUrlImpl(safe);
    } catch {
      return null;
    }
  };

  const readText = async (relPath: unknown) => {
    const safe = normalize(relPath);
    if (safe == null) return null;
    if (typeof readTextImpl !== "function") return null;
    try {
      const res = await readTextImpl(safe);
      return typeof res === "string" ? res : null;
    } catch {
      return null;
    }
  };

  const loadJson = async (relPath: unknown) => {
    try {
      const text = await readText(relPath);
      if (!text) return null;
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  const tween = (
    from: unknown,
    to: unknown,
    duration: unknown,
    easing: unknown,
    onUpdate: unknown
  ): unknown => {
    const tweenHelperFn = (globalThis as Record<string, unknown>).__nwWrldTweenHelper;
    if (typeof tweenHelperFn !== "function") return null;
    try {
      return tweenHelperFn(from, to, duration, easing, onUpdate);
    } catch {
      return null;
    }
  };

  const resolveEasingFn = (name: unknown): unknown => {
    const fn = (globalThis as Record<string, unknown>).__nwWrldResolveEasing;
    if (typeof fn !== "function") return null;
    try {
      return fn(name);
    } catch {
      return null;
    }
  };

  return { assetUrl, readText, loadJson, tween, resolveEasing: resolveEasingFn };
};


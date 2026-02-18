type Jsonish = string | number | boolean | null | undefined | { [k: string]: Jsonish };

const BLOCKED_NAMES = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "globalThis",
  "window",
  "document",
  "eval",
  "Function",
  "process",
  "require",
  "module",
  "exports",
  "__dirname",
  "__filename",
  "nwWrldSdk",
  "nwSandboxIpc",
]);

const BUILTIN_IMPORTS = new Set([
  "ModuleBase",
  "BaseThreeJsModule",
  "assetUrl",
  "readText",
  "loadJson",
  "listAssets",
  "THREE",
  "p5",
  "d3",
  "Noise",
  "OBJLoader",
  "PLYLoader",
  "PCDLoader",
  "GLTFLoader",
  "STLLoader",
  "TWEEN",
  "tween",
  "resolveEasing",
]);

const VALID_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export type UserImportEntry = {
  name: string;
  source: string;
};

export function validateUserImportsManifest(
  raw: Jsonish
): { ok: true; imports: UserImportEntry[] } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Manifest must be a JSON object" };
  }

  const obj = raw as Record<string, Jsonish>;
  const importsRaw = obj.imports;
  if (!importsRaw || typeof importsRaw !== "object" || Array.isArray(importsRaw)) {
    return { ok: false, error: 'Manifest must have an "imports" object' };
  }

  const imports: UserImportEntry[] = [];
  const entries = Object.entries(importsRaw as Record<string, Jsonish>);

  if (entries.length > 50) {
    return { ok: false, error: "Too many imports (max 50)" };
  }

  for (const [name, source] of entries) {
    if (typeof name !== "string" || !VALID_IDENTIFIER.test(name)) {
      return { ok: false, error: `Invalid import name: "${name}"` };
    }
    if (BLOCKED_NAMES.has(name)) {
      return { ok: false, error: `Blocked import name: "${name}"` };
    }
    if (BUILTIN_IMPORTS.has(name)) {
      return { ok: false, error: `Import name collides with built-in: "${name}"` };
    }
    if (typeof source !== "string" || !source.trim()) {
      return { ok: false, error: `Invalid source for import "${name}"` };
    }
    const trimmed = source.trim();
    const isRelative = trimmed.startsWith("./");
    const isAbsoluteUrl = /^https?:\/\//i.test(trimmed);
    if (!isRelative && !isAbsoluteUrl) {
      return {
        ok: false,
        error: `Import "${name}" source must be a relative path (./...) or https URL`,
      };
    }
    if (isRelative && trimmed.includes("..")) {
      return { ok: false, error: `Import "${name}" source must not contain ".."` };
    }
    imports.push({ name, source: trimmed });
  }

  return { ok: true, imports };
}

import {
  createModelLoader,
  OnnxRuntimes,
  type InferenceSession,
  type ModelSource,
  type SessionOptions,
} from "react-native-nitro-onnxruntime";
import { useEffect, useState } from "react";
import { Image } from "react-native";

// Mirrors ai/tfliteModelCache.ts's role-scoped single-slot cache, but for
// react-native-nitro-onnxruntime's InferenceSession instead of TfliteModel.
// Deliberately NOT unified into one generic cache shared with the TFLite
// side in this first pass -- the two libraries' hook result shapes differ
// slightly, and unifying them now would add abstraction risk before the ONNX
// path is even proven working end to end.
//
// InferenceSession also extends Nitro's HybridObject (same base as
// TfliteModel), so the exact same reasoning applies: native resources are
// only reliably freed via .dispose(), and app/media.tsx fully unmounts and
// remounts on every photo capture, swapping between SAM variants -- so the
// same "reuse if same model requested again, dispose old only after new is
// ready AND old has gone idle" policy is needed here too.

export type OnnxTensorPlugin =
  | { state: "loading"; model: undefined; error: undefined }
  | { state: "loaded"; model: InferenceSession; error: undefined }
  | { state: "error"; model: undefined; error: Error };

// --- In-flight run tracking --------------------------------------------
const activeRunCounts = new WeakMap<InferenceSession, number>();
const idleWaiters = new WeakMap<InferenceSession, Set<() => void>>();

export function markOnnxRunStart(session: InferenceSession): void {
  activeRunCounts.set(session, (activeRunCounts.get(session) ?? 0) + 1);
}

export function markOnnxRunEnd(session: InferenceSession): void {
  const nextCount = (activeRunCounts.get(session) ?? 1) - 1;
  activeRunCounts.set(session, nextCount);
  if (nextCount <= 0) {
    const waiters = idleWaiters.get(session);
    if (waiters) {
      waiters.forEach((resolve) => resolve());
      waiters.clear();
    }
  }
}

function waitForOnnxIdle(session: InferenceSession): Promise<void> {
  if ((activeRunCounts.get(session) ?? 0) <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let waiters = idleWaiters.get(session);
    if (!waiters) {
      waiters = new Set();
      idleWaiters.set(session, waiters);
    }
    waiters.add(resolve);
  });
}

// --- Role-scoped single-slot cache -----------------------------------------
function cacheKey(source: ModelSource, options: SessionOptions | undefined): string {
  const sourceKey = typeof source === "number" ? String(source) : JSON.stringify(source);
  return `${sourceKey}::${JSON.stringify(options ?? {})}`;
}

function describeSource(source: ModelSource): string {
  if (typeof source !== "number") {
    return JSON.stringify(source);
  }
  try {
    const resolved = Image.resolveAssetSource(source);
    return resolved?.uri ? resolved.uri : `<unresolved require() id ${source}>`;
  } catch (error) {
    return `<resolveAssetSource(${source}) threw: ${String(error)}>`;
  }
}

// react-native-nitro-onnxruntime's default createModelLoader() path (for a
// require()'d asset) downloads the resolved http/file URI to a local cache
// file keyed by its derived filename (ModelLoaderFactory.kt / .swift), then
// opens THAT file. Loading 2 different .onnx assets back to back has been
// observed -- on a genuinely fresh app launch, on BOTH iOS and Android -- to
// leave the second session bound to the first session's model (confirmed via
// mismatched inputNames/outputNames at the point of failure). Since both
// platforms' independent implementations of that same download-and-cache
// pattern show the identical symptom, the pattern itself is the suspect, not
// either platform individually. Bypass it: for http/file sources, fetch the
// bytes ourselves (plain JS, no native rebuild needed to iterate on this) and
// hand them straight to loadModelFromBuffer, which never touches that file
// cache. Only bare Android "resource" identifiers (release builds resolve
// require()'d assets this way) can't be fetch()'d -- those still have to go
// through the library's own native resource loader.
async function loadModelSource(
  source: ModelSource,
  options: SessionOptions | undefined,
): Promise<InferenceSession> {
  if (typeof source !== "number") {
    return createModelLoader(source, options);
  }

  const resolved = Image.resolveAssetSource(source);
  if (resolved?.uri && (resolved.uri.startsWith("http") || resolved.uri.startsWith("file"))) {
    const response = await fetch(resolved.uri);
    const buffer = await response.arrayBuffer();
    return OnnxRuntimes.loadModelFromBuffer(buffer, options);
  }

  return createModelLoader(source, options);
}

interface RoleSlot {
  key: string;
  promise: Promise<InferenceSession>;
}

const roleSlots = new Map<string, RoleSlot>();

function loadIntoRoleSlot(
  role: string,
  source: ModelSource,
  options: SessionOptions | undefined,
): Promise<InferenceSession> {
  const key = cacheKey(source, options);
  const existing = roleSlots.get(role);

  if (existing && existing.key === key) {
    return existing.promise;
  }

  console.log(`[SAM] ONNX load starting for role "${role}": ${describeSource(source)}`);
  const promise = loadModelSource(source, options);
  roleSlots.set(role, { key, promise });

  if (existing) {
    Promise.all([promise, existing.promise])
      .then(([, oldSession]) =>
        waitForOnnxIdle(oldSession).then(() => oldSession.dispose()),
      )
      .catch(() => {
        // Either load failed -- nothing valid to dispose in that case.
      });
  }

  promise
    .then((session) => {
      console.log(
        `[SAM] ONNX load resolved for role "${role}": in [${session.inputNames
          .map((t) => `${t.name}:${t.type}[${t.dims.join(",")}]`)
          .join(", ")}] out [${session.outputNames
          .map((t) => `${t.name}:${t.type}[${t.dims.join(",")}]`)
          .join(", ")}]`,
      );
    })
    .catch((error) => {
      console.log(`[SAM] ONNX load FAILED for role "${role}": ${String(error)}`);
      if (roleSlots.get(role)?.promise === promise) {
        roleSlots.delete(role);
      }
    });

  return promise;
}

/**
 * Like ai/tfliteModelCache.ts's useTensorflowModelSlot, but for ONNX Runtime
 * InferenceSessions. A "role" (e.g. "sam-encoder-onnx", "sam-decoder-onnx")
 * may only ever have ONE session resident at a time: requesting the SAME
 * (source, options) again reuses the already-loaded instance; requesting a
 * DIFFERENT one disposes the previous occupant once the new one is ready AND
 * the old one has finished any in-flight run.
 *
 * Pass `enabled: false` to skip loading entirely (still returns the
 * "loading" shape) -- used when this role isn't the active SAM variant, so
 * both TFLite and ONNX model hooks can be called unconditionally every
 * render (required by rules of hooks) without wastefully loading a model
 * that isn't selected.
 */
export function useOnnxModelSlot(
  role: string,
  source: ModelSource,
  options?: SessionOptions,
  enabled = true,
): OnnxTensorPlugin {
  const [state, setState] = useState<OnnxTensorPlugin>({
    model: undefined,
    state: "loading",
    error: undefined,
  });

  useEffect(() => {
    if (!enabled) {
      setState({ model: undefined, state: "loading", error: undefined });
      return;
    }
    let cancelled = false;
    setState({ model: undefined, state: "loading", error: undefined });
    loadIntoRoleSlot(role, source, options)
      .then((model) => {
        if (!cancelled) setState({ model, state: "loaded", error: undefined });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            model: undefined,
            state: "error",
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, source, JSON.stringify(options), enabled]);

  return state;
}

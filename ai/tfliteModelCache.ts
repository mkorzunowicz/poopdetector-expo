import {
  loadTensorflowModel,
  type ModelSource,
  type TensorflowModelDelegate,
  type TensorflowPlugin,
  type TfliteModel,
} from "react-native-fast-tflite";
import { useEffect, useState } from "react";

// Model loads are expensive (hundreds of ms to multiple seconds -- e.g. the
// poop detector takes ~900ms on CPU) and this app loads the SAME detector
// asset on both the live camera screen and the photo-detail screen. Cache the
// load Promise by (asset, delegates) so a second mount for the same
// combination resolves immediately instead of re-parsing the model from disk.
const modelCache = new Map<string, Promise<TfliteModel>>();

// --- In-flight run tracking --------------------------------------------
//
// model.run()/runSync() calls (e.g. the SAM encoder, which can take several
// SECONDS) are not cancellable. If a component unmounts and a role-slot
// switches to a different model while the OLD model still has a call
// in-flight, disposing it mid-inference is a native use-after-free -- a hard
// crash, not a catchable JS error. ai/mobileSamPhoto.ts's runModelAsync wraps
// every model.run() call with markModelRunStart/End so the cache can wait for
// a model to actually go idle before disposing it, instead of only waiting
// for its replacement to finish loading (which says nothing about whether the
// old model is still busy).
const activeRunCounts = new WeakMap<TfliteModel, number>();
const idleWaiters = new WeakMap<TfliteModel, Set<() => void>>();

export function markModelRunStart(model: TfliteModel): void {
  activeRunCounts.set(model, (activeRunCounts.get(model) ?? 0) + 1);
}

export function markModelRunEnd(model: TfliteModel): void {
  const nextCount = (activeRunCounts.get(model) ?? 1) - 1;
  activeRunCounts.set(model, nextCount);
  if (nextCount <= 0) {
    const waiters = idleWaiters.get(model);
    if (waiters) {
      waiters.forEach((resolve) => resolve());
      waiters.clear();
    }
  }
}

function waitForModelIdle(model: TfliteModel): Promise<void> {
  if ((activeRunCounts.get(model) ?? 0) <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let waiters = idleWaiters.get(model);
    if (!waiters) {
      waiters = new Set();
      idleWaiters.set(model, waiters);
    }
    waiters.add(resolve);
  });
}

function cacheKey(
  source: ModelSource,
  delegates: TensorflowModelDelegate[],
): string {
  const sourceKey = typeof source === "number" ? String(source) : source.url;
  return `${sourceKey}::${delegates.join(",")}`;
}

function loadCachedModel(
  source: ModelSource,
  delegates: TensorflowModelDelegate[],
): Promise<TfliteModel> {
  const key = cacheKey(source, delegates);
  let promise = modelCache.get(key);
  if (!promise) {
    promise = loadTensorflowModel(source, delegates);
    // Don't cache a failed load -- let the next mount retry from scratch.
    promise.catch(() => modelCache.delete(key));
    modelCache.set(key, promise);
  }
  return promise;
}

/**
 * Drop-in replacement for react-native-fast-tflite's useTensorflowModel that
 * shares loaded model instances across every caller requesting the same
 * (asset, delegates) pair, so the same detector loaded on both the camera
 * screen and the photo-detail screen only pays the load cost once.
 */
export function useCachedTensorflowModel(
  source: ModelSource,
  delegates: TensorflowModelDelegate[],
): TensorflowPlugin {
  const [state, setState] = useState<TensorflowPlugin>({
    model: undefined,
    state: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    setState({ model: undefined, state: "loading" });
    loadCachedModel(source, delegates)
      .then((model) => {
        if (!cancelled) setState({ model, state: "loaded" });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ model: undefined, state: "error", error });
        }
      });
    return () => {
      cancelled = true;
    };
    // JSON.stringify compares delegates by value, matching useTensorflowModel's
    // own dependency handling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, JSON.stringify(delegates)]);

  return state;
}

// --- Role-scoped single-slot cache -----------------------------------------
//
// TfliteModel is a Nitro HybridObject: it holds native (potentially large --
// tens to hundreds of MB for a 1024x1024 SAM model) resources that are only
// guaranteed to be freed via its own dispose(), NOT promptly by JS GC (see
// HybridObject.dispose()'s own docs: "NOT required... JS Garbage Collector
// automatically disposes... when needed" -- i.e. timing is not guaranteed).
// media.tsx fully unmounts/remounts on every photo capture, and swaps between
// several large SAM model variants, so relying on GC alone leaked a model
// instance on every retake and eventually OOM-crashed the app.
//
// A "role" (e.g. "sam-encoder", "sam-decoder") may only ever have ONE model
// resident at a time: requesting the SAME (asset, delegates) again reuses the
// already-loaded instance (no reload, no leak); requesting a DIFFERENT one
// disposes the previous occupant once the new one is ready.
interface RoleSlot {
  key: string;
  promise: Promise<TfliteModel>;
}

const roleSlots = new Map<string, RoleSlot>();

function loadIntoRoleSlot(
  role: string,
  source: ModelSource,
  delegates: TensorflowModelDelegate[],
): Promise<TfliteModel> {
  const key = cacheKey(source, delegates);
  const existing = roleSlots.get(role);

  if (existing && existing.key === key) {
    // Same model already resident (or loading) for this role -- reuse it.
    return existing.promise;
  }

  // Different model for this role (or first request for it): start the new
  // load immediately so concurrent callers share this same in-flight promise,
  // then dispose whatever previously occupied the slot once the new model is
  // ready, so at most one model per role is ever resident.
  const promise = loadTensorflowModel(source, delegates);
  roleSlots.set(role, { key, promise });

  if (existing) {
    Promise.all([promise, existing.promise])
      .then(([, oldModel]) =>
        // Wait for the old model's in-flight run (if any -- e.g. a multi-
        // second SAM encoder call from a bootstrap the user navigated away
        // from before it finished) to actually complete before touching it.
        // Disposing mid-inference is a native use-after-free, not a
        // catchable JS error.
        waitForModelIdle(oldModel).then(() => oldModel.dispose()),
      )
      .catch(() => {
        // Either load failed -- nothing valid to dispose in that case.
      });
  }

  promise.catch(() => {
    // Failed load: don't leave a broken slot behind for the next request.
    if (roleSlots.get(role)?.promise === promise) {
      roleSlots.delete(role);
    }
  });

  return promise;
}

/**
 * Like useCachedTensorflowModel, but scoped to a named "role" that may only
 * ever have ONE model resident at a time. Switching to a different (asset,
 * delegates) for the same role disposes the previous model once the new one
 * finishes loading -- use this for large, swappable models (e.g. SAM encoder/
 * decoder variants) where holding onto stale instances risks OOM. Requesting
 * the same model again reuses the already-loaded instance.
 */
export function useTensorflowModelSlot(
  role: string,
  source: ModelSource,
  delegates: TensorflowModelDelegate[],
): TensorflowPlugin {
  const [state, setState] = useState<TensorflowPlugin>({
    model: undefined,
    state: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    setState({ model: undefined, state: "loading" });
    loadIntoRoleSlot(role, source, delegates)
      .then((model) => {
        if (!cancelled) setState({ model, state: "loaded" });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ model: undefined, state: "error", error });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, source, JSON.stringify(delegates)]);

  return state;
}

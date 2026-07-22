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

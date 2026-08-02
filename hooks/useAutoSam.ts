import { useMMKVBoolean } from "react-native-mmkv";
import { useCallback } from "react";

const KEY = "sam.autoRun";

/**
 * Whether SAM should load and segment automatically as soon as a photo is taken.
 *
 * OFF is not merely "don't show the mask" -- it must also NOT LOAD the models.
 * The encoder and decoder are tens to hundreds of MB and take multiple seconds
 * to initialise, and on the camera screen that load visibly starved the detector
 * of CPU during its own startup. A user who only wants a detection box should
 * not pay for a segmentation stack they never asked for.
 *
 * Defaults to ON so existing behaviour is unchanged for anyone who never opens
 * settings. `useMMKVBoolean` returns undefined until a value has been written,
 * hence the `?? true` rather than a plain read.
 */
export function useAutoSam(): [boolean, (value: boolean) => void] {
  const [stored, setStored] = useMMKVBoolean(KEY);
  const set = useCallback((value: boolean) => setStored(value), [setStored]);
  return [stored ?? true, set];
}

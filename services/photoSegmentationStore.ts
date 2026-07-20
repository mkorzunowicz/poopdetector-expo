import * as FileSystem from "expo-file-system/legacy";

import type { Detection } from "@/ai/detectors/types";
import type { SamPoint } from "@/ai/mobileSamPhoto";

export interface SavedPhotoSegmentation {
  photoPath: string;
  assetId?: string;
  updatedAt: number;
  imageWidth: number;
  imageHeight: number;
  score: number;
  points: SamPoint[];
  polygon: Array<{ x: number; y: number }>;
  detections: Detection[];
}

type SegmentationStore = Record<string, SavedPhotoSegmentation>;

const STORE_PATH = `${FileSystem.documentDirectory ?? ""}poopdetector-segmentations.json`;
const STORE_TIMEOUT_MS = 600;

function logPhotoStore(message: string, data?: Record<string, unknown>): void {
  if (data) {
    console.log(`[PhotoSegmentationStore] ${message}`, data);
    return;
  }
  console.log(`[PhotoSegmentationStore] ${message}`);
}

function logPhotoStoreError(
  message: string,
  error: unknown,
  data?: Record<string, unknown>,
): void {
  if (data) {
    console.error(`[PhotoSegmentationStore] ${message}`, { ...data, error });
    return;
  }
  console.error(`[PhotoSegmentationStore] ${message}`, error);
}

function normalizeKey(photoPath: string): string {
  return photoPath.startsWith("file://")
    ? photoPath.slice("file://".length)
    : photoPath;
}

function createTimeoutError(operation: string): Error {
  return new Error(
    `[PhotoSegmentationStore] ${operation} timed out after ${STORE_TIMEOUT_MS}ms`,
  );
}

async function withTimeout<T>(
  operation: string,
  promise: Promise<T>,
): Promise<T> {
  return await Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(createTimeoutError(operation)), STORE_TIMEOUT_MS);
    }),
  ]);
}

async function readStore(): Promise<SegmentationStore> {
  if (!FileSystem.documentDirectory) {
    return {};
  }

  const startTime = Date.now();
  try {
    logPhotoStore("readStore begin", { storePath: STORE_PATH });
    const info = await withTimeout(
      "getInfoAsync",
      FileSystem.getInfoAsync(STORE_PATH),
    );
    if (!info.exists) {
      logPhotoStore("readStore no file", { elapsedMs: Date.now() - startTime });
      return {};
    }

    const content = await withTimeout(
      "readAsStringAsync",
      FileSystem.readAsStringAsync(STORE_PATH),
    );
    if (!content) {
      logPhotoStore("readStore empty file", {
        elapsedMs: Date.now() - startTime,
      });
      return {};
    }
    const parsed = JSON.parse(content) as SegmentationStore;
    logPhotoStore("readStore complete", {
      elapsedMs: Date.now() - startTime,
      entryCount: Object.keys(parsed).length,
    });
    return parsed;
  } catch (error) {
    logPhotoStoreError("readStore failed", error, {
      elapsedMs: Date.now() - startTime,
    });
    return {};
  }
}

async function writeStore(store: SegmentationStore): Promise<void> {
  if (!FileSystem.documentDirectory) {
    return;
  }

  const startTime = Date.now();
  try {
    logPhotoStore("writeStore begin", {
      entryCount: Object.keys(store).length,
      storePath: STORE_PATH,
    });
    await withTimeout(
      "writeAsStringAsync",
      FileSystem.writeAsStringAsync(STORE_PATH, JSON.stringify(store)),
    );
    logPhotoStore("writeStore complete", {
      elapsedMs: Date.now() - startTime,
      entryCount: Object.keys(store).length,
    });
  } catch (error) {
    logPhotoStoreError("writeStore failed", error, {
      elapsedMs: Date.now() - startTime,
      entryCount: Object.keys(store).length,
    });
  }
}

export async function getPhotoSegmentation(
  photoPath: string,
): Promise<SavedPhotoSegmentation | null> {
  const startTime = Date.now();
  logPhotoStore("getPhotoSegmentation begin", { photoPath });
  const store = await readStore();
  const segmentation = store[normalizeKey(photoPath)] ?? null;
  logPhotoStore("getPhotoSegmentation complete", {
    photoPath,
    found: segmentation != null,
    elapsedMs: Date.now() - startTime,
  });
  return segmentation;
}

export async function savePhotoSegmentation(
  segmentation: SavedPhotoSegmentation,
): Promise<void> {
  const startTime = Date.now();
  logPhotoStore("savePhotoSegmentation begin", {
    photoPath: segmentation.photoPath,
    pointCount: segmentation.points.length,
    polygonPoints: segmentation.polygon.length,
  });
  const store = await readStore();
  const key = normalizeKey(segmentation.photoPath);
  store[key] = {
    ...segmentation,
    photoPath: key,
    updatedAt: Date.now(),
  };
  await writeStore(store);
  logPhotoStore("savePhotoSegmentation complete", {
    photoPath: key,
    elapsedMs: Date.now() - startTime,
  });
}

export async function attachPhotoSegmentationAssetId(
  photoPath: string,
  assetId: string,
): Promise<void> {
  const startTime = Date.now();
  logPhotoStore("attachPhotoSegmentationAssetId begin", { photoPath, assetId });
  const store = await readStore();
  const key = normalizeKey(photoPath);
  const current = store[key];
  if (!current) {
    logPhotoStore("attachPhotoSegmentationAssetId skipped", {
      photoPath: key,
      elapsedMs: Date.now() - startTime,
    });
    return;
  }
  store[key] = {
    ...current,
    assetId,
    updatedAt: Date.now(),
  };
  await writeStore(store);
  logPhotoStore("attachPhotoSegmentationAssetId complete", {
    photoPath: key,
    elapsedMs: Date.now() - startTime,
  });
}

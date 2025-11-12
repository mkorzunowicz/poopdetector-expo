
// detectors/types.ts
import { Tensor, TensorflowModel } from 'react-native-fast-tflite'
import type { Frame } from 'react-native-vision-camera'

export type DetectFn = (frame: Frame, mirrored: boolean) => Detection[]   // worklet fn (return value varies)

export interface UseDetectorResult<T = unknown> {
    /** worklet‑safe detector function (or null until ready) */
    detect: DetectFn | null
    /** user‑space data (class names, colours, etc.) */
    meta: T | null
    /** true once the TFLite model is loaded */
    ready: boolean
}
// ai/detection.ts
export interface Detection {
    x1: number; y1: number;   // 0-1
    x2: number; y2: number;   // 0-1
    score: number;
    classId: number;
    label?: string;           // added later
    color?: string;           // added later
}


export function tensorToString(tensor: Tensor): string {
    'worklet'
    return `\n  - ${tensor.dataType} ${tensor.name}[${tensor.shape}]`
}
export function modelToString(model: TensorflowModel): string {
    'worklet'
    return (
        `TFLite Model (${model.delegate}):\n` +
        `- Inputs: ${model.inputs.map(tensorToString).join('')}\n` +
        `- Outputs: ${model.outputs.map(tensorToString).join('')}`
    )
}
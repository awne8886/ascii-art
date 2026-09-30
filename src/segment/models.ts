/** The background-removal models, fetched from Hugging Face on first use and cached by the browser. */

export type ModelId = 'ai-fast' | 'ai-hq';

export interface ModelSpec {
  label: string;
  repo: string;
  /** Pinned revision, so a model update upstream can't change behaviour under us. */
  revision: string;
  /** Square input size the model expects. */
  size: number;
  /** Model file and download size for each backend (a model without `wasm` needs WebGPU). */
  wasm?: { file: string; mb: number };
  webgpu?: { file: string; mb: number };
  /** For GPUs without half-precision shaders. */
  webgpuFp32?: { file: string; mb: number };
  /** How to turn the raw output into 0–1: U²-Net outputs probabilities (min–max them like rembg), BiRefNet logits. */
  output: 'minmax' | 'sigmoid';
  license: string;
}

export const MODELS: Record<ModelId, ModelSpec> = {
  'ai-fast': {
    label: 'U²-Net small',
    repo: 'BritishWerewolf/U-2-Netp',
    revision: '7112208dbac3a3642496c8d54e2f0f9bb3dc1dc8',
    size: 320,
    wasm: { file: 'onnx/model.onnx', mb: 4.6 },
    output: 'minmax',
    license: 'Apache-2.0',
  },
  'ai-hq': {
    label: 'BiRefNet lite',
    repo: 'onnx-community/BiRefNet_lite-ONNX',
    revision: 'de15b22ba131738a16dff04aab8bdf8dc32e3ac1',
    size: 1024,
    // At 1024 px its activations don't fit in WebAssembly's 4 GB, so it's GPU only.
    webgpu: { file: 'onnx/model_fp16.onnx', mb: 115 },
    webgpuFp32: { file: 'onnx/model.onnx', mb: 224 },
    output: 'sigmoid',
    license: 'MIT',
  },
};

export function modelUrl(spec: ModelSpec, file: string): string {
  return `https://huggingface.co/${spec.repo}/resolve/${spec.revision}/${file}`;
}

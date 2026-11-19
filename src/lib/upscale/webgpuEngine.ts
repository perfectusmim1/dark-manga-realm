/// <reference types="@webgpu/types" />
import type { Anime4KBuiltPipeline } from './anime4kHelpers';
import type { Anime4KRunOptions } from './webglEngine';

interface CachedPipelineState {
  key: string;
  inputTexture: GPUTexture;
  pipeline: Anime4KBuiltPipeline;
  renderBindGroup: GPUBindGroup;
}

const CROP_RENDER_WGSL = `
struct Uniforms {
  vMin : f32,
  vMax : f32,
};

@group(0) @binding(0) var uSampler : sampler;
@group(0) @binding(1) var uTex : texture_2d<f32>;
@group(0) @binding(2) var<uniform> uParams : Uniforms;

struct VertexOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vert_main(@builtin(vertex_index) idx : u32) -> VertexOut {
  const positions = array<vec2<f32>, 6>(
    vec2<f32>( 1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(-1.0,  1.0)
  );
  const uvs = array<vec2<f32>, 6>(
    vec2<f32>(1.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 0.0),
    vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 0.0)
  );
  var out : VertexOut;
  out.pos = vec4<f32>(positions[idx], 0.0, 1.0);
  out.uv = uvs[idx];
  return out;
}

@fragment
fn frag_main(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
  let croppedUv = vec2<f32>(uv.x, mix(uParams.vMin, uParams.vMax, uv.y));
  let sampleColor = textureSampleBaseClampToEdge(uTex, uSampler, croppedUv);
  return vec4<f32>(sampleColor.rgb, 1.0);
}
`;

export class WebGPUAnime4KEngine {
  private device: GPUDevice | null = null;
  private renderPipeline: GPURenderPipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private sampler: GPUSampler | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private renderTargetTex: GPUTexture | null = null;
  private renderTargetW = 0;
  private renderTargetH = 0;
  private readbackBuffer: GPUBuffer | null = null;
  private readbackCapacity = 0;
  private cached: CachedPipelineState | null = null;

  private async ensureDevice(): Promise<GPUDevice> {
    if (this.device) {
      return this.device;
    }

    if (typeof navigator === 'undefined' || !navigator.gpu) {
      throw new Error('WebGPU bu tarayıcıda desteklenmiyor');
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('WebGPU adaptörü alınamadı');
    }
    const device = await adapter.requestDevice();
    this.device = device;

    void device.lost.then(() => {
      if (this.device === device) {
        this.destroyPipelineCache();
        this.destroyOutputTargets();
        this.renderPipeline = null;
        this.bindGroupLayout = null;
        this.sampler = null;
        this.uniformBuffer = null;
        this.device = null;
      }
    });

    const shaderModule = device.createShaderModule({
      label: 'ToonParrot Anime4K Crop Render Shader',
      code: CROP_RENDER_WGSL,
    });

    this.bindGroupLayout = device.createBindGroupLayout({
      label: 'Anime4K Render BindGroupLayout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    this.renderPipeline = device.createRenderPipeline({
      label: 'Anime4K Crop Render Pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      vertex: { module: shaderModule, entryPoint: 'vert_main' },
      fragment: {
        module: shaderModule,
        entryPoint: 'frag_main',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.uniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    return device;
  }

  private destroyOutputTargets(): void {
    try {
      this.renderTargetTex?.destroy();
    } catch {
      // ignore
    }
    try {
      this.readbackBuffer?.destroy();
    } catch {
      // ignore
    }
    this.renderTargetTex = null;
    this.renderTargetW = 0;
    this.renderTargetH = 0;
    this.readbackBuffer = null;
    this.readbackCapacity = 0;
  }

  private destroyPipelineCache(): void {
    if (!this.cached) return;
    const { inputTexture, pipeline } = this.cached;
    try {
      pipeline.destroy();
    } catch {
      // ignore pipeline cleanup errors
    }
    try {
      inputTexture.destroy();
    } catch {
      // ignore texture cleanup errors
    }
    this.cached = null;
  }

  private async ensurePipeline(
    device: GPUDevice,
    mode: 'fast' | 'quality',
    srcW: number,
    srcH: number,
  ): Promise<CachedPipelineState> {
    const key = `${mode}:${srcW}:${srcH}`;
    if (this.cached && this.cached.key === key) {
      return this.cached;
    }

    this.destroyPipelineCache();

    const inputTexture = device.createTexture({
      label: 'Anime4K Input Texture',
      size: [srcW, srcH, 1],
      format: 'rgba16float',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    let pipeline: Anime4KBuiltPipeline;
    if (mode === 'fast') {
      const { buildCNNx2M } = await import('./anime4kCnnM');
      pipeline = buildCNNx2M(device, inputTexture);
    } else {
      const { buildCNNx2UL } = await import('./anime4kCnnUL');
      pipeline = buildCNNx2UL(device, inputTexture);
    }

    const renderBindGroup = device.createBindGroup({
      layout: this.bindGroupLayout!,
      entries: [
        { binding: 0, resource: this.sampler! },
        { binding: 1, resource: pipeline.getOutputTexture().createView() },
        { binding: 2, resource: { buffer: this.uniformBuffer! } },
      ],
    });

    this.cached = { key, inputTexture, pipeline, renderBindGroup };
    return this.cached;
  }

  private ensureOutputTarget(device: GPUDevice, outWidth: number, outHeight: number): {
    targetTex: GPUTexture;
    readbackBuf: GPUBuffer;
    bytesPerRow: number;
  } {
    if (!this.renderTargetTex || this.renderTargetW !== outWidth || this.renderTargetH !== outHeight) {
      try {
        this.renderTargetTex?.destroy();
      } catch {
        // ignore
      }
      this.renderTargetTex = device.createTexture({
        label: 'Anime4K Output Target',
        size: [outWidth, outHeight, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      this.renderTargetW = outWidth;
      this.renderTargetH = outHeight;
    }

    const bytesPerRow = Math.ceil((outWidth * 4) / 256) * 256;
    const neededBytes = bytesPerRow * outHeight;
    if (!this.readbackBuffer || this.readbackCapacity < neededBytes) {
      try {
        this.readbackBuffer?.destroy();
      } catch {
        // ignore
      }
      this.readbackBuffer = device.createBuffer({
        size: neededBytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      this.readbackCapacity = neededBytes;
    }

    return {
      targetTex: this.renderTargetTex,
      readbackBuf: this.readbackBuffer,
      bytesPerRow,
    };
  }

  async upscale(opts: Anime4KRunOptions): Promise<ImageBitmap> {
    const { bitmap, mode, outWidth, outHeight, cropTop, cropBottom } = opts;
    const srcW = bitmap.width;
    const srcH = bitmap.height;

    const device = await this.ensureDevice();
    const state = await this.ensurePipeline(device, mode, srcW, srcH);
    const { targetTex, readbackBuf, bytesPerRow } = this.ensureOutputTarget(device, outWidth, outHeight);

    const vMin = Math.max(0, Math.min(1, cropTop / srcH));
    const vMax = Math.max(vMin, Math.min(1, 1 - cropBottom / srcH));
    device.queue.writeBuffer(this.uniformBuffer!, 0, new Float32Array([vMin, vMax]));

    device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: state.inputTexture },
      [srcW, srcH],
    );

    const encoder = device.createCommandEncoder();
    state.pipeline.pass(encoder);

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: targetTex.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(this.renderPipeline!);
    pass.setBindGroup(0, state.renderBindGroup);
    pass.draw(6);
    pass.end();

    encoder.copyTextureToBuffer(
      { texture: targetTex },
      { buffer: readbackBuf, bytesPerRow },
      { width: outWidth, height: outHeight, depthOrArrayLayers: 1 },
    );

    device.queue.submit([encoder.finish()]);

    await readbackBuf.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(readbackBuf.getMappedRange(0, bytesPerRow * outHeight));
    const rowBytes = outWidth * 4;
    const pixels = new Uint8ClampedArray(rowBytes * outHeight);
    if (bytesPerRow === rowBytes) {
      pixels.set(mapped);
    } else {
      for (let y = 0; y < outHeight; y += 1) {
        const srcOffset = y * bytesPerRow;
        pixels.set(mapped.subarray(srcOffset, srcOffset + rowBytes), y * rowBytes);
      }
    }
    readbackBuf.unmap();

    return createImageBitmap(new ImageData(pixels, outWidth, outHeight));
  }

  dispose(): void {
    this.destroyPipelineCache();
    this.destroyOutputTargets();
    try {
      this.uniformBuffer?.destroy();
    } catch {
      // ignore buffer cleanup errors
    }
    try {
      this.device?.destroy();
    } catch {
      // ignore device cleanup errors
    }
    this.uniformBuffer = null;
    this.sampler = null;
    this.bindGroupLayout = null;
    this.renderPipeline = null;
    this.device = null;
  }
}

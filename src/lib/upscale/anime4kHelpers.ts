/// <reference types="@webgpu/types" />
// Extracted MIT shaders & pass helpers from Anime4KWebBoost/Anime4K-WebGPU (bloc97/Anime4K)

export interface Anime4KSubPass {
  pass(encoder: GPUCommandEncoder): void;
  getOutputTexture(): GPUTexture;
  destroy(): void;
}

export interface Anime4KBuiltPipeline {
  pass(encoder: GPUCommandEncoder): void;
  getOutputTexture(): GPUTexture;
  destroy(): void;
}

export const DEPTH_TO_SPACE_WGSL = "@group(0) @binding(0) var tex_0: texture_2d<f32>;\n@group(0) @binding(1) var tex_1: texture_2d<f32>;\n@group(0) @binding(2) var tex_2: texture_2d<f32>;\n@group(0) @binding(3) var tex_out: texture_storage_2d<rgba16float, write>;\n\nfn colorAt(texture: texture_2d<f32>, x: u32, y: u32) -> vec4<f32> {\n    return textureLoad(texture, vec2u(x, y), 0);\n}\n\n@compute\n@workgroup_size(8, 8)\nfn computeMain(@builtin(global_invocation_id) pixel: vec3u) {\n    let dim_out: vec2u = textureDimensions(tex_out);\n    if (pixel.x >= dim_out.x || pixel.y >= dim_out.y) {\n        return;\n    }\n\n    let loc: vec2u = pixel.xy / vec2u(2, 2);\n    let sub_loc: vec2u = pixel.xy % vec2u(2, 2);\n    let channel: u32 = sub_loc.y * 2 + sub_loc.x;\n    let c0: f32 = colorAt(tex_0, loc.x, loc.y)[channel];\n    let c1: f32 = colorAt(tex_1, loc.x, loc.y)[channel];\n    let c2: f32 = colorAt(tex_2, loc.x, loc.y)[channel];\n    let c3: f32 = c2; // unclear why\n\n    textureStore(tex_out, pixel.xy, vec4f(c0, c1, c2, c3));\n}\n";

export const OVERLAY_VERT_WGSL = "struct VertexOutput {\n  @builtin(position) Position : vec4<f32>,\n  @location(0) fragUV : vec2<f32>,\n}\n\n@vertex\nfn vert_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {\n  const pos = array(\n    vec2( 1.0,  1.0),\n    vec2( 1.0, -1.0),\n    vec2(-1.0, -1.0),\n    vec2( 1.0,  1.0),\n    vec2(-1.0, -1.0),\n    vec2(-1.0,  1.0),\n  );\n\n  const uv = array(\n    vec2(1.0, 0.0),\n    vec2(1.0, 1.0),\n    vec2(0.0, 1.0),\n    vec2(1.0, 0.0),\n    vec2(0.0, 1.0),\n    vec2(0.0, 0.0),\n  );\n\n  var output : VertexOutput;\n  output.Position = vec4(pos[VertexIndex], 0.0, 1.0);\n  output.fragUV = uv[VertexIndex];\n  return output;\n}\n";

export const OVERLAY_FRAG_WGSL = "@group(0) @binding(0) var mySampler: sampler;\n@group(0) @binding(1) var tex_diff: texture_2d<f32>;\n@group(0) @binding(2) var tex_origin: texture_2d<f32>;\n\n@fragment\nfn main(@location(0) fragUV: vec2<f32>) -> @location(0) vec4<f32> {\n    let color_bilinear: vec4f = textureSample(tex_origin, mySampler, fragUV);\n    let color_addon: vec4f = textureSample(tex_diff, mySampler, fragUV);\n    return clamp(color_bilinear + color_addon, vec4<f32>(0., 0., 0., 0.), vec4<f32>(1., 1., 1., 1.));\n}\n";

export class Conv2dPass implements Anime4KSubPass {
  private outputTexture: GPUTexture;
  private bindGroup: GPUBindGroup;
  private pipeline: GPUComputePipeline;

  constructor(
    device: GPUDevice,
    inputTextures: GPUTexture[],
    shaderWGSL: string,
    label: string,
  ) {
    this.outputTexture = device.createTexture({
      label: `${label}: tex`,
      size: [inputTextures[0].width, inputTextures[0].height, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    const module = device.createShaderModule({ label: `${label}: mod`, code: shaderWGSL });
    const layoutEntries: GPUBindGroupLayoutEntry[] = [];
    const groupEntries: GPUBindGroupEntry[] = [];
    for (let i = 0; i < inputTextures.length; i += 1) {
      layoutEntries.push({ binding: i, visibility: GPUShaderStage.COMPUTE, texture: {} });
      groupEntries.push({ binding: i, resource: inputTextures[i].createView() });
    }
    layoutEntries.push({
      binding: inputTextures.length,
      visibility: GPUShaderStage.COMPUTE,
      storageTexture: { access: 'write-only', format: 'rgba16float' },
    });
    groupEntries.push({ binding: inputTextures.length, resource: this.outputTexture.createView() });

    const layout = device.createBindGroupLayout({ label: `${label}: bgl`, entries: layoutEntries });
    this.bindGroup = device.createBindGroup({ label: `${label}: bg`, layout, entries: groupEntries });
    this.pipeline = device.createComputePipeline({
      label: `${label}: pipe`,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'computeMain' },
    });
  }

  pass(encoder: GPUCommandEncoder): void {
    const compute = encoder.beginComputePass();
    compute.setPipeline(this.pipeline);
    compute.setBindGroup(0, this.bindGroup);
    compute.dispatchWorkgroups(
      Math.ceil(this.outputTexture.width / 8),
      Math.ceil(this.outputTexture.height / 8),
    );
    compute.end();
  }

  getOutputTexture(): GPUTexture {
    return this.outputTexture;
  }

  destroy(): void {
    try {
      this.outputTexture.destroy();
    } catch {
      // ignore texture cleanup errors
    }
  }
}

export class DepthToSpacePass implements Anime4KSubPass {
  private outputTexture: GPUTexture;
  private bindGroup: GPUBindGroup;
  private pipeline: GPUComputePipeline;

  constructor(device: GPUDevice, inputTextures: GPUTexture[], label = 'depthToSpace') {
    this.outputTexture = device.createTexture({
      label: `${label}: tex`,
      size: [inputTextures[0].width * 2, inputTextures[0].height * 2, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    const module = device.createShaderModule({ label: `${label}: mod`, code: DEPTH_TO_SPACE_WGSL });
    const layout = device.createBindGroupLayout({
      label: `${label}: bgl`,
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: {} },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: {} },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: {} },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba16float' },
        },
      ],
    });
    this.bindGroup = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: inputTextures[0].createView() },
        { binding: 1, resource: inputTextures[1].createView() },
        { binding: 2, resource: inputTextures[2].createView() },
        { binding: 3, resource: this.outputTexture.createView() },
      ],
    });
    this.pipeline = device.createComputePipeline({
      label: `${label}: pipe`,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'computeMain' },
    });
  }

  pass(encoder: GPUCommandEncoder): void {
    const compute = encoder.beginComputePass();
    compute.setPipeline(this.pipeline);
    compute.setBindGroup(0, this.bindGroup);
    compute.dispatchWorkgroups(
      Math.ceil(this.outputTexture.width / 8),
      Math.ceil(this.outputTexture.height / 8),
    );
    compute.end();
  }

  getOutputTexture(): GPUTexture {
    return this.outputTexture;
  }

  destroy(): void {
    try {
      this.outputTexture.destroy();
    } catch {
      // ignore texture cleanup errors
    }
  }
}

export class OverlayPass implements Anime4KSubPass {
  private outputTexture: GPUTexture;
  private bindGroup: GPUBindGroup;
  private pipeline: GPURenderPipeline;

  constructor(
    device: GPUDevice,
    inputTextures: GPUTexture[],
    outputSize: [number, number],
    label = 'overlay',
  ) {
    this.outputTexture = device.createTexture({
      label: `${label}: tex`,
      size: [outputSize[0], outputSize[1], 1],
      format: 'rgba16float',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.STORAGE_BINDING,
    });

    const vertModule = device.createShaderModule({ label: `${label}: v`, code: OVERLAY_VERT_WGSL });
    const fragModule = device.createShaderModule({ label: `${label}: f`, code: OVERLAY_FRAG_WGSL });

    const layoutEntries: GPUBindGroupLayoutEntry[] = [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    ];
    for (let i = 1; i <= inputTextures.length; i += 1) {
      layoutEntries.push({ binding: i, visibility: GPUShaderStage.FRAGMENT, texture: {} });
    }

    const layout = device.createBindGroupLayout({ label: `${label}: bgl`, entries: layoutEntries });
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    const groupEntries: GPUBindGroupEntry[] = [{ binding: 0, resource: sampler }];
    for (let i = 1; i <= inputTextures.length; i += 1) {
      groupEntries.push({ binding: i, resource: inputTextures[i - 1].createView() });
    }

    this.bindGroup = device.createBindGroup({ label: `${label}: bg`, layout, entries: groupEntries });
    this.pipeline = device.createRenderPipeline({
      label: `${label}: pipe`,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module: vertModule, entryPoint: 'vert_main' },
      fragment: {
        module: fragModule,
        entryPoint: 'main',
        targets: [{ format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  pass(encoder: GPUCommandEncoder): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.outputTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(6);
    pass.end();
  }

  getOutputTexture(): GPUTexture {
    return this.outputTexture;
  }

  destroy(): void {
    try {
      this.outputTexture.destroy();
    } catch {
      // ignore texture cleanup errors
    }
  }
}

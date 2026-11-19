export interface Anime4KRunOptions {
  bitmap: ImageBitmap;
  mode: 'fast' | 'quality';
  outWidth: number;
  outHeight: number;
  cropTop: number;
  cropBottom: number;
}

const QUAD_VERT = `
precision highp float;
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos;
  gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

// Son gecis: WebGL default framebuffer y=+1'i ekran ustune koydugu icin dikey UV terslenir ve kirpilir.
const DRAW_VERT = `
precision highp float;
attribute vec2 a_pos;
uniform vec2 u_vRange;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x, mix(u_vRange.x, u_vRange.y, 1.0 - a_pos.y));
  gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

const SCALE_FRAG = `
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_srcSize;
varying vec2 v_uv;

vec4 catmullRom(vec2 uv) {
  vec2 px = 1.0 / u_srcSize;
  vec2 coord = uv * u_srcSize - 0.5;
  vec2 i = floor(coord);
  vec2 f = coord - i;
  vec2 tl = (i + 0.5) * px;
  vec2 tr = tl + vec2(px.x, 0.0);
  vec2 bl = tl + vec2(0.0, px.y);
  vec2 br = tl + px;
  vec4 c0 = mix(texture2D(u_tex, tl), texture2D(u_tex, tr), f.x);
  vec4 c1 = mix(texture2D(u_tex, bl), texture2D(u_tex, br), f.x);
  return mix(c0, c1, f.y);
}

void main() {
  gl_FragColor = catmullRom(v_uv);
}
`;

const LUM_FRAG = `
precision highp float;
uniform sampler2D u_tex;
varying vec2 v_uv;
void main() {
  vec4 rgb = texture2D(u_tex, v_uv);
  float lum = (rgb.r + rgb.r + rgb.g + rgb.g + rgb.g + rgb.b) / 6.0;
  gl_FragColor = vec4(lum, lum, lum, 1.0);
}
`;

const PUSH_FRAG = `
precision highp float;
uniform sampler2D u_tex;
uniform sampler2D u_lumTex;
uniform vec2 u_pt;
uniform float u_strength;
varying vec2 v_uv;

vec4 getRGBL(vec2 pos) {
  return vec4(texture2D(u_tex, pos).rgb, texture2D(u_lumTex, pos).r);
}

float min3v(vec4 a, vec4 b, vec4 c) {
  return min(min(a.a, b.a), c.a);
}

float max3v(vec4 a, vec4 b, vec4 c) {
  return max(max(a.a, b.a), c.a);
}

vec4 getLargest(vec4 cc, vec4 lightestColor, vec4 a, vec4 b, vec4 c) {
  vec4 nextColor = cc * (1.0 - u_strength) + ((a + b + c) / 3.0) * u_strength;
  return nextColor.a > lightestColor.a ? nextColor : lightestColor;
}

void main() {
  vec2 d = u_pt;
  vec4 cc = getRGBL(v_uv);
  vec4 t  = getRGBL(v_uv + vec2(0.0, -d.y));
  vec4 tl = getRGBL(v_uv + vec2(-d.x, -d.y));
  vec4 tr = getRGBL(v_uv + vec2(d.x, -d.y));
  vec4 l  = getRGBL(v_uv + vec2(-d.x, 0.0));
  vec4 r  = getRGBL(v_uv + vec2(d.x, 0.0));
  vec4 b  = getRGBL(v_uv + vec2(0.0, d.y));
  vec4 bl = getRGBL(v_uv + vec2(-d.x, d.y));
  vec4 br = getRGBL(v_uv + vec2(d.x, d.y));

  vec4 lightestColor = cc;

  float maxDark = max3v(br, b, bl);
  float minLight = min3v(tl, t, tr);
  if (minLight > cc.a && minLight > maxDark) {
    lightestColor = getLargest(cc, lightestColor, tl, t, tr);
  } else {
    maxDark = max3v(tl, t, tr);
    minLight = min3v(br, b, bl);
    if (minLight > cc.a && minLight > maxDark) {
      lightestColor = getLargest(cc, lightestColor, br, b, bl);
    }
  }

  maxDark = max3v(cc, l, b);
  minLight = min3v(r, t, tr);
  if (minLight > maxDark) {
    lightestColor = getLargest(cc, lightestColor, r, t, tr);
  } else {
    maxDark = max3v(cc, r, t);
    minLight = min3v(bl, l, b);
    if (minLight > maxDark) {
      lightestColor = getLargest(cc, lightestColor, bl, l, b);
    }
  }

  maxDark = max3v(l, tl, bl);
  minLight = min3v(r, br, tr);
  if (minLight > cc.a && minLight > maxDark) {
    lightestColor = getLargest(cc, lightestColor, r, br, tr);
  } else {
    maxDark = max3v(r, br, tr);
    minLight = min3v(l, tl, bl);
    if (minLight > cc.a && minLight > maxDark) {
      lightestColor = getLargest(cc, lightestColor, l, tl, bl);
    }
  }

  maxDark = max3v(cc, l, t);
  minLight = min3v(r, br, b);
  if (minLight > maxDark) {
    lightestColor = getLargest(cc, lightestColor, r, br, b);
  } else {
    maxDark = max3v(cc, r, b);
    minLight = min3v(t, l, tl);
    if (minLight > maxDark) {
      lightestColor = getLargest(cc, lightestColor, t, l, tl);
    }
  }

  gl_FragColor = vec4(lightestColor.rgb, 1.0);
}
`;

const GRAD_FRAG = `
precision highp float;
uniform sampler2D u_lumTex;
uniform vec2 u_pt;
varying vec2 v_uv;

float lumAt(vec2 pos) {
  return texture2D(u_lumTex, pos).r;
}

void main() {
  vec2 d = u_pt;
  float t  = lumAt(v_uv + vec2(0.0, -d.y));
  float tl = lumAt(v_uv + vec2(-d.x, -d.y));
  float tr = lumAt(v_uv + vec2(d.x, -d.y));
  float l  = lumAt(v_uv + vec2(-d.x, 0.0));
  float r  = lumAt(v_uv + vec2(d.x, 0.0));
  float b  = lumAt(v_uv + vec2(0.0, d.y));
  float bl = lumAt(v_uv + vec2(-d.x, d.y));
  float br = lumAt(v_uv + vec2(d.x, d.y));

  float xgrad = (-tl + tr - l - l + r + r - bl + br);
  float ygrad = (-tl - t - t - tr + bl + b + b + br);
  float val = 1.0 - clamp(sqrt(xgrad * xgrad + ygrad * ygrad), 0.0, 1.0);
  gl_FragColor = vec4(val, val, val, 1.0);
}
`;

const FINAL_FRAG = `
precision highp float;
uniform sampler2D u_tex;
uniform sampler2D u_gradTex;
uniform vec2 u_pt;
uniform float u_strength;
varying vec2 v_uv;

vec4 getRGBG(vec2 pos) {
  return vec4(texture2D(u_tex, pos).rgb, texture2D(u_gradTex, pos).r);
}

float min3v(vec4 a, vec4 b, vec4 c) {
  return min(min(a.a, b.a), c.a);
}

float max3v(vec4 a, vec4 b, vec4 c) {
  return max(max(a.a, b.a), c.a);
}

vec4 getAverage(vec4 cc, vec4 a, vec4 b, vec4 c) {
  vec4 mixed = cc * (1.0 - u_strength) + ((a + b + c) / 3.0) * u_strength;
  return vec4(mixed.rgb, 1.0);
}

void main() {
  vec2 d = u_pt;
  vec4 cc = getRGBG(v_uv);
  vec4 t  = getRGBG(v_uv + vec2(0.0, -d.y));
  vec4 tl = getRGBG(v_uv + vec2(-d.x, -d.y));
  vec4 tr = getRGBG(v_uv + vec2(d.x, -d.y));
  vec4 l  = getRGBG(v_uv + vec2(-d.x, 0.0));
  vec4 r  = getRGBG(v_uv + vec2(d.x, 0.0));
  vec4 b  = getRGBG(v_uv + vec2(0.0, d.y));
  vec4 bl = getRGBG(v_uv + vec2(-d.x, d.y));
  vec4 br = getRGBG(v_uv + vec2(d.x, d.y));

  float maxDark = max3v(br, b, bl);
  float minLight = min3v(tl, t, tr);
  if (minLight > cc.a && minLight > maxDark) {
    gl_FragColor = getAverage(cc, tl, t, tr);
    return;
  } else {
    maxDark = max3v(tl, t, tr);
    minLight = min3v(br, b, bl);
    if (minLight > cc.a && minLight > maxDark) {
      gl_FragColor = getAverage(cc, br, b, bl);
      return;
    }
  }

  maxDark = max3v(cc, l, b);
  minLight = min3v(r, t, tr);
  if (minLight > maxDark) {
    gl_FragColor = getAverage(cc, r, t, tr);
    return;
  } else {
    maxDark = max3v(cc, r, t);
    minLight = min3v(bl, l, b);
    if (minLight > maxDark) {
      gl_FragColor = getAverage(cc, bl, l, b);
      return;
    }
  }

  maxDark = max3v(l, tl, bl);
  minLight = min3v(r, br, tr);
  if (minLight > cc.a && minLight > maxDark) {
    gl_FragColor = getAverage(cc, r, br, tr);
    return;
  } else {
    maxDark = max3v(r, br, tr);
    minLight = min3v(l, tl, bl);
    if (minLight > cc.a && minLight > maxDark) {
      gl_FragColor = getAverage(cc, l, tl, bl);
      return;
    }
  }

  maxDark = max3v(cc, l, t);
  minLight = min3v(r, br, b);
  if (minLight > maxDark) {
    gl_FragColor = getAverage(cc, r, br, b);
    return;
  } else {
    maxDark = max3v(cc, r, b);
    minLight = min3v(t, l, tl);
    if (minLight > maxDark) {
      gl_FragColor = getAverage(cc, t, l, tl);
      return;
    }
  }

  gl_FragColor = vec4(cc.rgb, 1.0);
}
`;

const DRAW_FRAG = `
precision highp float;
uniform sampler2D u_tex;
varying vec2 v_uv;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  gl_FragColor = vec4(c.rgb, 1.0);
}
`;

interface ProgramBundle {
  program: WebGLProgram;
  aPos: number;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

const QUAD_VERTS = new Float32Array([
  0, 0,
  1, 0,
  0, 1,
  0, 1,
  1, 0,
  1, 1,
]);

export class WebGLAnime4KEngine {
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private fbo: WebGLFramebuffer | null = null;
  private quadBuf: WebGLBuffer | null = null;
  private inputTex: WebGLTexture | null = null;
  private workTexA: WebGLTexture | null = null;
  private workTexB: WebGLTexture | null = null;
  private workTexC: WebGLTexture | null = null;
  private allocInternalW = 0;
  private allocInternalH = 0;

  private scaleProg: ProgramBundle | null = null;
  private lumProg: ProgramBundle | null = null;
  private pushProg: ProgramBundle | null = null;
  private gradProg: ProgramBundle | null = null;
  private finalProg: ProgramBundle | null = null;
  private drawProg: ProgramBundle | null = null;

  private compileProgram(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    vertSrc: string,
    fragSrc: string,
    uniformNames: string[],
  ): ProgramBundle {
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type);
      if (!sh) throw new Error('WebGL shader oluşturulamadı');
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh) || 'unknown';
        gl.deleteShader(sh);
        throw new Error(`WebGL shader hatası: ${log}`);
      }
      return sh;
    };

    const vs = compile(gl.VERTEX_SHADER, vertSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
    const prog = gl.createProgram();
    if (!prog) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      throw new Error('WebGL program oluşturulamadı');
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) || 'unknown';
      gl.deleteProgram(prog);
      throw new Error(`WebGL link hatası: ${log}`);
    }

    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of uniformNames) {
      uniforms[name] = gl.getUniformLocation(prog, name);
    }

    return {
      program: prog,
      aPos: gl.getAttribLocation(prog, 'a_pos'),
      uniforms,
    };
  }

  private ensureContext(): WebGLRenderingContext | WebGL2RenderingContext {
    if (this.gl && !this.gl.isContextLost()) {
      return this.gl;
    }

    this.dispose();

    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(2, 2)
        : document.createElement('canvas');
    const attrs: WebGLContextAttributes = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
    };
    const gl =
      (canvas.getContext('webgl2', attrs) as WebGL2RenderingContext | null) ||
      (canvas.getContext('webgl', attrs) as WebGLRenderingContext | null);
    if (!gl) {
      throw new Error('WebGL bağlamı başlatılamadı');
    }

    this.canvas = canvas;
    this.gl = gl;
    this.fbo = gl.createFramebuffer();
    this.quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTS, gl.STATIC_DRAW);

    this.inputTex = this.createLinearTex(gl);
    this.scaleProg = this.compileProgram(gl, QUAD_VERT, SCALE_FRAG, ['u_tex', 'u_srcSize']);
    this.lumProg = this.compileProgram(gl, QUAD_VERT, LUM_FRAG, ['u_tex']);
    this.pushProg = this.compileProgram(gl, QUAD_VERT, PUSH_FRAG, ['u_tex', 'u_lumTex', 'u_pt', 'u_strength']);
    this.gradProg = this.compileProgram(gl, QUAD_VERT, GRAD_FRAG, ['u_lumTex', 'u_pt']);
    this.finalProg = this.compileProgram(gl, QUAD_VERT, FINAL_FRAG, ['u_tex', 'u_gradTex', 'u_pt', 'u_strength']);
    this.drawProg = this.compileProgram(gl, DRAW_VERT, DRAW_FRAG, ['u_tex', 'u_vRange']);

    return gl;
  }

  private createLinearTex(gl: WebGLRenderingContext | WebGL2RenderingContext): WebGLTexture {
    const tex = gl.createTexture();
    if (!tex) throw new Error('WebGL texture oluşturulamadı');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  private ensureWorkTextures(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    w: number,
    h: number,
  ): void {
    if (this.allocInternalW === w && this.allocInternalH === h && this.workTexA && this.workTexB && this.workTexC) {
      return;
    }

    const alloc = (existing: WebGLTexture | null): WebGLTexture => {
      const tex = existing ?? this.createLinearTex(gl);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      return tex;
    };

    this.workTexA = alloc(this.workTexA);
    this.workTexB = alloc(this.workTexB);
    this.workTexC = alloc(this.workTexC);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.allocInternalW = w;
    this.allocInternalH = h;
  }

  private drawQuad(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    bundle: ProgramBundle,
    targetFbo: WebGLFramebuffer | null,
    targetTex: WebGLTexture | null,
    w: number,
    h: number,
  ): void {
    if (targetFbo && targetTex) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, targetTex, 0);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(bundle.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(bundle.aPos);
    gl.vertexAttribPointer(bundle.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  async upscale(opts: Anime4KRunOptions): Promise<ImageBitmap> {
    const { bitmap, mode, outWidth, outHeight, cropTop, cropBottom } = opts;
    const gl = this.ensureContext();
    const srcW = bitmap.width;
    const srcH = bitmap.height;
    const maxTex = (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) || 4096;
    const internalW = Math.min(srcW * 2, maxTex);
    const internalH = Math.min(srcH * 2, maxTex);

    this.ensureWorkTextures(gl, internalW, internalH);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.inputTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);

    // 1. 2x baslangic interpolasyonu -> workTexA
    const scaleProg = this.scaleProg!;
    gl.useProgram(scaleProg.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.inputTex);
    gl.uniform1i(scaleProg.uniforms.u_tex, 0);
    gl.uniform2f(scaleProg.uniforms.u_srcSize, srcW, srcH);
    this.drawQuad(gl, scaleProg, this.fbo, this.workTexA, internalW, internalH);

    const ptX = 1 / internalW;
    const ptY = 1 / internalH;
    const iterations = mode === 'quality' ? 2 : 1;
    const pushStrength = mode === 'quality' ? 0.68 : 0.56;
    const refineStrength = mode === 'quality' ? 0.55 : 0.42;

    const lumProg = this.lumProg!;
    const pushProg = this.pushProg!;
    const gradProg = this.gradProg!;
    const finalProg = this.finalProg!;

    for (let iter = 0; iter < iterations; iter += 1) {
      // 2. Parlaklik haritasi (workTexA -> workTexB)
      gl.useProgram(lumProg.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.workTexA);
      gl.uniform1i(lumProg.uniforms.u_tex, 0);
      this.drawQuad(gl, lumProg, this.fbo, this.workTexB, internalW, internalH);

      // 3. Kenar itme / inceltme (workTexA + workTexB -> workTexC)
      gl.useProgram(pushProg.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.workTexA);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.workTexB);
      gl.uniform1i(pushProg.uniforms.u_tex, 0);
      gl.uniform1i(pushProg.uniforms.u_lumTex, 1);
      gl.uniform2f(pushProg.uniforms.u_pt, ptX, ptY);
      gl.uniform1f(pushProg.uniforms.u_strength, pushStrength);
      this.drawQuad(gl, pushProg, this.fbo, this.workTexC, internalW, internalH);

      // 4. Guncellenmis parlaklik (workTexC -> workTexB)
      gl.useProgram(lumProg.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.workTexC);
      gl.uniform1i(lumProg.uniforms.u_tex, 0);
      this.drawQuad(gl, lumProg, this.fbo, this.workTexB, internalW, internalH);

      // 5. Gradyan hesabi (workTexB -> workTexA)
      gl.useProgram(gradProg.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.workTexB);
      gl.uniform1i(gradProg.uniforms.u_lumTex, 0);
      gl.uniform2f(gradProg.uniforms.u_pt, ptX, ptY);
      this.drawQuad(gl, gradProg, this.fbo, this.workTexA, internalW, internalH);

      // 6. Gradyan yonlu keskinlestirme (workTexC + workTexA -> workTexB, sonra workTexA ile takas)
      gl.useProgram(finalProg.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.workTexC);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.workTexA);
      gl.uniform1i(finalProg.uniforms.u_tex, 0);
      gl.uniform1i(finalProg.uniforms.u_gradTex, 1);
      gl.uniform2f(finalProg.uniforms.u_pt, ptX, ptY);
      gl.uniform1f(finalProg.uniforms.u_strength, refineStrength);
      this.drawQuad(gl, finalProg, this.fbo, this.workTexB, internalW, internalH);

      const tmp = this.workTexA;
      this.workTexA = this.workTexB;
      this.workTexB = tmp;
    }

    // 7. Kirpilmis hedef boyuta cikis
    const canvas = this.canvas!;
    canvas.width = outWidth;
    canvas.height = outHeight;

    const vMin = Math.max(0, Math.min(1, cropTop / srcH));
    const vMax = Math.max(vMin, Math.min(1, 1 - cropBottom / srcH));

    const drawProg = this.drawProg!;
    gl.useProgram(drawProg.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.workTexA);
    gl.uniform1i(drawProg.uniforms.u_tex, 0);
    gl.uniform2f(drawProg.uniforms.u_vRange, vMin, vMax);
    this.drawQuad(gl, drawProg, null, null, outWidth, outHeight);

    gl.flush();

    if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
      return canvas.transferToImageBitmap();
    }
    return createImageBitmap(canvas as HTMLCanvasElement);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      try {
        [this.inputTex, this.workTexA, this.workTexB, this.workTexC].forEach((tex) => {
          if (tex) gl.deleteTexture(tex);
        });
        if (this.fbo) gl.deleteFramebuffer(this.fbo);
        if (this.quadBuf) gl.deleteBuffer(this.quadBuf);
        [this.scaleProg, this.lumProg, this.pushProg, this.gradProg, this.finalProg, this.drawProg].forEach(
          (bundle) => {
            if (bundle) gl.deleteProgram(bundle.program);
          },
        );
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      } catch {
        // ignore cleanup errors
      }
    }
    this.gl = null;
    this.canvas = null;
    this.fbo = null;
    this.quadBuf = null;
    this.inputTex = null;
    this.workTexA = null;
    this.workTexB = null;
    this.workTexC = null;
    this.allocInternalW = 0;
    this.allocInternalH = 0;
    this.scaleProg = null;
    this.lumProg = null;
    this.pushProg = null;
    this.gradProg = null;
    this.finalProg = null;
    this.drawProg = null;
  }
}

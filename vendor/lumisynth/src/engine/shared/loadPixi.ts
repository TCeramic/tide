// src/engine/shared/loadPixi.ts
// The single place a visualizer pulls Pixi in, so the shader precision default is raised before
// the first program is compiled.
//
// Pixi injects `precision mediump float;` into every fragment shader that does not declare its
// own (`GlProgram.defaultOptions.preferredFragmentPrecision`). On Windows and on Intel/Mesa that
// costs nothing - their drivers report mediump as 127/127/23, i.e. it already *is* fp32. The
// NVIDIA Linux driver is the one that takes the qualifier literally: Chromium reaches it through
// ANGLE on a native `OpenGL ES 3.2` context, and there mediump is real fp16 (getShaderPrecision-
// Format reports 15/15/10, max finite value 65504).
//
// That difference is not cosmetic. Pixi's own NoiseFilter - the grain pass in tempera's and
// sonnet's post-process chains - computes `fract(sin(dot(gl_FragCoord.xy * uSeed, vec2(12.9898,
// 78.233))) * 43758.5453)`. The dot product grows linearly with the pixel coordinate, so past
// roughly `65504 / uSeed` it overflows fp16 to Inf, `sin(Inf)` is NaN, and every pixel beyond
// that line is written as black. Because the overflow condition is linear in x and y, the
// boundary is a straight line across the frame: the black triangle reported on Linux + NVIDIA,
// growing with textureResolution because `gl_FragCoord` grows with it, and varying per scene
// because `uSeed` is derived from the scene seed. Capping the post-process resolution only moves
// the seed threshold - at pass resolution 1.0 a seed of 0.95 still overflows on a 1280x720 frame.
//
// highp is fp32 on every device that can run this app: GLSL ES 3.00 requires fragment highp, and
// Pixi 8 is WebGL2/WebGPU only. `ensurePrecision` still downgrades to mediump if a device somehow
// reports no highp support, which is exactly today's behaviour, so nothing can get worse. Shaders
// that declare their own precision line are left alone.
//
// It is also where Pixi's filter stack gets patched for a use-after-destroy (8.21). `FilterSystem.push`
// calls `_findFilterResolution`, which starts at the slot it has just pushed - a slot whose
// `inputTexture` is still last frame's, already handed back to the TexturePool. Since 8.21 the pool
// prunes idle screen-sized textures whenever a renderer registers a new screen size (every
// `renderer.resize`, every renderer created or destroyed), destroying that texture. The next push of a
// nested filter (lumiere's bloom inside the kernel's post-process chain) then reads
// `inputTexture.source._resolution` off a null source and the whole frame throws. Dragging a sidebar
// while previewing lumiere is enough: the preview steps its resolution and resizes the renderer.
//
// The same pruning also trips a dev warning ("[BindGroup] a 'textureSource' was destroyed while still
// bound to a shader"). Every filter pass shares `FilterSystem._globalFilterBindGroup`, whose slots 1-3
// (input source, its sampler, back texture) keep pointing at the last pass's pool textures after they
// are returned. Changing the output aspect resizes the renderer, the pool destroys those idle textures
// and the bind group reports them. Once a filtered pipeline has issued its draws, the slots are pointed
// at `Texture.EMPTY`, which is never destroyed; every pass sets its own resources before it draws, so
// nothing rendered changes.
type PixiModule = typeof import('pixi.js');

interface FilterStackInternals {
    _filterStack: Array<{ inputTexture: import('pixi.js').Texture | null }>;
    _filterStackIndex: number;
    _findFilterResolution: (rootResolution: number) => number;
    _applyFiltersToTexture: (filterData: unknown, clear: boolean) => void;
    _globalFilterBindGroup: import('pixi.js').BindGroup;
}

let filterStackPatched = false;

/** Keeps the filter stack and its shared bind group from holding pool textures the pool may destroy. */
const patchFilterStack = (pixi: PixiModule) => {
    if (filterStackPatched) return;
    filterStackPatched = true;
    const proto = pixi.FilterSystem.prototype as unknown as FilterStackInternals;
    const find = proto._findFilterResolution;
    proto._findFilterResolution = function (this: FilterStackInternals, rootResolution: number) {
        for (let index = 0; index < this._filterStackIndex; index += 1) {
            const data = this._filterStack[index];
            if (data?.inputTexture && !data.inputTexture.source) data.inputTexture = null;
        }
        return find.call(this, rootResolution);
    };
    const apply = proto._applyFiltersToTexture;
    proto._applyFiltersToTexture = function (this: FilterStackInternals, filterData: unknown, clear: boolean) {
        apply.call(this, filterData, clear);
        const empty = pixi.Texture.EMPTY.source;
        this._globalFilterBindGroup.setResource(empty, 1);
        this._globalFilterBindGroup.setResource(empty.style, 2);
        this._globalFilterBindGroup.setResource(empty, 3);
    };
};

/**
 * Must be awaited before any renderer, filter or shader is constructed: `GlProgram.from` caches
 * compiled sources, so a program built before the flip would keep its mediump variant.
 */
export const loadPixi = async (): Promise<PixiModule> => {
    const pixi = await import('pixi.js');
    pixi.GlProgram.defaultOptions.preferredFragmentPrecision = 'highp';
    patchFilterStack(pixi);
    return pixi;
};

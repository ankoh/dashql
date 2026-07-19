import * as React from 'react';

import { EmbeddingRendererWebGPU } from './renderer/webgpu_renderer/renderer.js';
import { EmbeddingRendererWebGL2 } from './renderer/webgl2_renderer/renderer.js';
import { isWebGPUAvailable, requestWebGPUDevice } from './renderer/webgpu_renderer/utils.js';
import type { EmbeddingRenderer } from './renderer/renderer_interface.js';
import type { Point, ViewportState } from './renderer/utils.js';
import { Viewport } from './renderer/viewport_utils.js';

import * as styles from './embedding_scatter.module.css';

/// The projected point cloud that drives the scatter plot. `x`/`y` are the 2D
/// coordinates (typically UMAP output), `category` is an optional per-point
/// color index in `[0, categoryCount)`.
export interface EmbeddingPoints {
    x: Float32Array;
    y: Float32Array;
    category: Uint8Array | null;
    categoryCount: number;
    categoryColors?: string[] | null;
}

interface Props {
    points: EmbeddingPoints;
    colorScheme?: 'light' | 'dark';
    pointSize?: number;
}

/// Median of a Float32Array without mutating the input.
function median(values: Float32Array): number {
    if (values.length === 0) return 0;
    const sorted = Float32Array.from(values).sort();
    const mid = sorted.length >> 1;
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/// Standard deviation of a Float32Array.
function stdev(values: Float32Array): number {
    if (values.length === 0) return 0;
    let mean = 0;
    for (let i = 0; i < values.length; ++i) mean += values[i];
    mean /= values.length;
    let variance = 0;
    for (let i = 0; i < values.length; ++i) {
        const d = values[i] - mean;
        variance += d * d;
    }
    variance /= values.length;
    return Math.sqrt(variance);
}

/// Compute a viewport that frames the whole point cloud, mirroring embedding-atlas's
/// EmbeddingView: center on the medians, scale so ~3 stdevs fit the [-1, 1] range.
function defaultViewport(points: EmbeddingPoints): ViewportState {
    const xCenter = median(points.x);
    const yCenter = median(points.y);
    const xStd = stdev(points.x);
    const yStd = stdev(points.y);
    const scaler = 1.0 / (Math.max(xStd, yStd, 1e-3) * 3);
    return { x: xCenter, y: yCenter, scale: scaler * 0.95 };
}

/// A WebGPU/WebGL2 scatter plot for 2D-projected embeddings. Owns the canvas,
/// acquires a rendering device (WebGPU, falling back to WebGL2), instantiates the
/// vendored embedding-atlas renderer, and wires up pan/zoom. This component is
/// intentionally decoupled from projection: it just draws the `x`/`y` it is given.
export function EmbeddingScatter(props: Props): React.ReactElement {
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
    const rendererRef = React.useRef<EmbeddingRenderer | null>(null);
    const viewportRef = React.useRef<ViewportState>({ x: 0, y: 0, scale: 1 });
    const defaultViewportRef = React.useRef<ViewportState>({ x: 0, y: 0, scale: 1 });
    const frameRef = React.useRef<number | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    const points = props.points;
    const colorScheme = props.colorScheme ?? 'light';
    const pointSize = props.pointSize ?? 2;

    // Schedule a render on the next animation frame (coalesces bursts of prop /
    // interaction changes into a single draw).
    const scheduleRender = React.useCallback(() => {
        if (frameRef.current != null) return;
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            const renderer = rendererRef.current;
            const canvas = canvasRef.current;
            if (!renderer || !canvas) return;
            canvas.width = renderer.props.width;
            canvas.height = renderer.props.height;
            renderer.render();
        });
    }, []);

    // Push the current points + viewport into the renderer and request a draw.
    const syncRenderer = React.useCallback(() => {
        const renderer = rendererRef.current;
        if (!renderer) return;
        const vp = viewportRef.current;
        const needsRender = renderer.setProps({
            x: points.x as Float32Array<ArrayBuffer>,
            y: points.y as Float32Array<ArrayBuffer>,
            category: points.category as Uint8Array<ArrayBuffer> | null,
            categoryCount: Math.max(1, points.categoryCount),
            categoryColors: points.categoryColors ?? null,
            colorScheme,
            pointSize,
            viewportX: vp.x,
            viewportY: vp.y,
            viewportScale: vp.scale,
        });
        if (needsRender) scheduleRender();
    }, [points, colorScheme, pointSize, scheduleRender]);

    // Device + renderer lifecycle. Re-runs only on mount/unmount; data changes
    // are pushed through syncRenderer without rebuilding the GPU pipeline.
    React.useEffect(() => {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        if (!container || !canvas) return;

        let disposed = false;

        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const rect = container.getBoundingClientRect();
        const initialWidth = Math.max(1, Math.round(rect.width * pixelRatio));
        const initialHeight = Math.max(1, Math.round(rect.height * pixelRatio));

        const setupWebGL2 = (): boolean => {
            const context = canvas.getContext('webgl2', { antialias: false });
            if (context == null) {
                setError('Could not acquire a WebGL2 context');
                return false;
            }
            context.getExtension('EXT_color_buffer_float');
            context.getExtension('EXT_float_blend');
            context.getExtension('OES_texture_float_linear');
            rendererRef.current = new EmbeddingRendererWebGL2(context, initialWidth, initialHeight);
            return true;
        };

        const setupWebGPU = async (): Promise<void> => {
            const device = await requestWebGPUDevice();
            if (disposed) {
                device?.destroy();
                return;
            }
            if (device == null) {
                setupWebGL2();
                syncRenderer();
                return;
            }
            const context = canvas.getContext('webgpu');
            if (context == null) {
                setupWebGL2();
                syncRenderer();
                return;
            }
            device.addEventListener('uncapturederror', event => {
                // eslint-disable-next-line no-console
                console.error('WebGPU uncaptured error:', (event as GPUUncapturedErrorEvent).error);
            });
            const format = navigator.gpu.getPreferredCanvasFormat();
            context.configure({ device, format, alphaMode: 'premultiplied' });
            rendererRef.current = new EmbeddingRendererWebGPU(context, device, format, initialWidth, initialHeight);
            syncRenderer();
        };

        // Try WebGPU first; fall back to WebGL2 both when WebGPU is unavailable and
        // when device/context acquisition fails inside setupWebGPU.
        if (isWebGPUAvailable()) {
            setupWebGPU().catch((e: unknown) => {
                if (disposed) return;
                if (!setupWebGL2()) {
                    setError(e instanceof Error ? e.message : String(e));
                    return;
                }
                syncRenderer();
            });
        } else {
            setupWebGL2();
            syncRenderer();
        }

        return () => {
            disposed = true;
            if (frameRef.current != null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
            rendererRef.current?.destroy();
            rendererRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Reset the viewport to frame the cloud whenever the point set identity changes,
    // then sync it into the renderer.
    React.useEffect(() => {
        const vp = defaultViewport(points);
        defaultViewportRef.current = vp;
        viewportRef.current = vp;
        syncRenderer();
    }, [points, syncRenderer]);

    // Re-sync when purely visual props change (color scheme, point size).
    React.useEffect(() => {
        syncRenderer();
    }, [colorScheme, pointSize, syncRenderer]);

    // Container resize → resize the framebuffer.
    React.useEffect(() => {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        if (!container || !canvas) return;
        const observer = new ResizeObserver(entries => {
            const renderer = rendererRef.current;
            if (!renderer) return;
            const entry = entries[0];
            const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
            const width = Math.max(1, Math.round(entry.contentRect.width * pixelRatio));
            const height = Math.max(1, Math.round(entry.contentRect.height * pixelRatio));
            canvas.style.width = `${entry.contentRect.width}px`;
            canvas.style.height = `${entry.contentRect.height}px`;
            renderer.setProps({ width, height });
            scheduleRender();
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, [scheduleRender]);

    // Map a pointer event to canvas-local pixel coordinates.
    const localPoint = React.useCallback((clientX: number, clientY: number): Point => {
        const rect = canvasRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
        return { x: clientX - rect.left, y: clientY - rect.top };
    }, []);

    // Zoom about the cursor (wheel), mirroring EmbeddingViewImpl.onZoom.
    const onWheel = React.useCallback(
        (e: React.WheelEvent) => {
            e.preventDefault();
            const pos = localPoint(e.clientX, e.clientY);
            const { x, y, scale } = viewportRef.current;
            const scaler = Math.exp(-e.deltaY / 200);
            const baseScale = defaultViewportRef.current.scale || 1;
            const newScale = Math.min(baseScale * 1e2, Math.max(baseScale * 1e-2, scale * scaler));
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;
            const sz = Math.max(rect.width, rect.height);
            const px = ((pos.x - rect.width / 2) / sz) * 2;
            const py = ((rect.height / 2 - pos.y) / sz) * 2;
            viewportRef.current = {
                x: x + px / scale - px / newScale,
                y: y + py / scale - py / newScale,
                scale: newScale,
            };
            syncRenderer();
        },
        [localPoint, syncRenderer],
    );

    // Drag to pan. Uses the renderer's Viewport to convert pixel deltas to data units.
    const onPointerDown = React.useCallback(
        (e: React.PointerEvent) => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            canvas.setPointerCapture(e.pointerId);
            const rect = canvas.getBoundingClientRect();
            const start = viewportRef.current;
            const vp = new Viewport(start, rect.width, rect.height);
            const c0 = vp.coordinateAtPixel(0, 0);
            const c1 = vp.coordinateAtPixel(1, 1);
            const sx = c0.x - c1.x;
            const sy = c0.y - c1.y;
            const startClientX = e.clientX;
            const startClientY = e.clientY;

            const onMove = (ev: PointerEvent) => {
                viewportRef.current = {
                    x: start.x + (ev.clientX - startClientX) * sx,
                    y: start.y + (ev.clientY - startClientY) * sy,
                    scale: start.scale,
                };
                syncRenderer();
            };
            const onUp = (ev: PointerEvent) => {
                canvas.releasePointerCapture(ev.pointerId);
                canvas.removeEventListener('pointermove', onMove);
                canvas.removeEventListener('pointerup', onUp);
            };
            canvas.addEventListener('pointermove', onMove);
            canvas.addEventListener('pointerup', onUp);
        },
        [syncRenderer],
    );

    return (
        <div ref={containerRef} className={styles.root}>
            {error && <div className={styles.error}>{error}</div>}
            <canvas
                ref={canvasRef}
                className={styles.canvas}
                onWheel={onWheel}
                onPointerDown={onPointerDown}
            />
        </div>
    );
}

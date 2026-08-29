import * as THREE from 'three';

const LINES_PER_PATH = 100;
const SAMPLES_PER_LINE = 200;
const BAND_WIDTH = 0.42;

function fract(value: number): number {
    return value - Math.floor(value);
}

function hash(value: number): number {
    return fract(Math.sin(value * 127.1) * 43758.5453);
}

type Point = { x: number; y: number };

function mixPoint(start: Point, end: Point, amount: number): Point {
    return {
        x: start.x + (end.x - start.x) * amount,
        y: start.y + (end.y - start.y) * amount,
    };
}

function cubicBezier(start: Point, control1: Point, control2: Point, end: Point, amount: number): Point {
    const inverse = 1 - amount;
    const inverseSquared = inverse * inverse;
    const amountSquared = amount * amount;

    return {
        x:
            inverseSquared * inverse * start.x +
            3 * inverseSquared * amount * control1.x +
            3 * inverse * amountSquared * control2.x +
            amountSquared * amount * end.x,
        y:
            inverseSquared * inverse * start.y +
            3 * inverseSquared * amount * control1.y +
            3 * inverse * amountSquared * control2.y +
            amountSquared * amount * end.y,
    };
}

function qPathPoint(progress: number, aspect: number): Point {
    const start = { x: -aspect * 1.04, y: 0 };
    const turnStart = { x: -0.65, y: 0 };
    const turnEnd = { x: -0.18, y: -0.45 };
    const end = { x: 0.06, y: -1.15 };

    if (progress < 0.28) {
        return mixPoint(start, turnStart, progress / 0.28);
    }
    if (progress < 0.72) {
        return cubicBezier(
            turnStart,
            { x: -0.38, y: 0 },
            { x: -0.28, y: -0.1994 },
            turnEnd,
            (progress - 0.28) / 0.44,
        );
    }
    return mixPoint(turnEnd, end, (progress - 0.72) / 0.28);
}

function pathPoint(path: number, progress: number, aspect = 1): Point {
    if (path === 0) {
        return qPathPoint(progress, aspect);
    }

    const mirrored = qPathPoint(progress, aspect);
    return { x: -mirrored.x, y: -mirrored.y };
}

function offsetPathPoint(path: number, progress: number, lane: number, aspect = 1): Point {
    const sampleDistance = 0.0005;
    const point = pathPoint(path, progress, aspect);
    const before = pathPoint(path, Math.max(0, progress - sampleDistance), aspect);
    const after = pathPoint(path, Math.min(1, progress + sampleDistance), aspect);
    const deltaX = after.x - before.x;
    const deltaY = after.y - before.y;
    const length = Math.hypot(deltaX, deltaY) || 1;

    return {
        x: point.x - (deltaY / length) * lane,
        y: point.y + (deltaX / length) * lane,
    };
}

const vertexShader = /* glsl */ `
    precision highp float;

    uniform float uAspect;
    uniform float uPixelRatio;
    uniform float uSpeed;
    uniform float uTime;
    uniform float uWidthScale;

    attribute float aLane;
    attribute float aDistance;
    attribute float aPathLength;
    attribute float aPath;
    attribute float aPhase;
    attribute float aProgress;
    attribute float aSeed;
    attribute float aSide;
    attribute float aWidth;

    varying float vLineAlpha;
    varying float vDistance;
    varying float vPathLength;
    varying float vPhase;
    varying float vProgress;
    varying float vSeed;
    varying float vAcross;

    vec2 cubicBezier(vec2 start, vec2 control1, vec2 control2, vec2 end, float t) {
        float inverse = 1.0 - t;
        return inverse * inverse * inverse * start
            + 3.0 * inverse * inverse * t * control1
            + 3.0 * inverse * t * t * control2
            + t * t * t * end;
    }

    vec2 qPath(float progress) {
        vec2 incomingStart = vec2(-uAspect * 1.04, 0.0);
        vec2 cornerStart = vec2(-0.65, 0.0);
        vec2 cornerEnd = vec2(-0.18, -0.45);
        vec2 outgoingEnd = vec2(0.06, -1.15);

        if (progress < 0.28) {
            return mix(incomingStart, cornerStart, progress / 0.28);
        }

        if (progress < 0.72) {
            return cubicBezier(
                cornerStart,
                vec2(-0.38, 0.0),
                vec2(-0.28, -0.1994),
                cornerEnd,
                (progress - 0.28) / 0.44
            );
        }

        return mix(cornerEnd, outgoingEnd, (progress - 0.72) / 0.28);
    }

    vec2 pathPoint(float path, float progress) {
        return path < 0.5 ? qPath(progress) : -qPath(progress);
    }

    void main() {
        vec2 point = pathPoint(aPath, aProgress);
        float sampleDistance = 0.002;
        vec2 before = pathPoint(aPath, max(0.0, aProgress - sampleDistance));
        vec2 after = pathPoint(aPath, min(1.0, aProgress + sampleDistance));
        vec2 tangent = normalize(after - before);
        vec2 normal = vec2(-tangent.y, tangent.x);

        float advectedTime = uTime * uSpeed;
        float flowCoordinate = aProgress * 8.0 - advectedTime * 10.0;
        float sharedWave = sin(flowCoordinate + aPath * 1.9) * 0.006;
        float breathing = 0.96 + 0.04 * sin(flowCoordinate * 0.34);

        point += normal * (aLane * breathing + sharedWave);
        point += normal * aSide * aWidth * uWidthScale * uPixelRatio;

        gl_Position = vec4(point.x / uAspect, point.y, 0.0, 1.0);
        vDistance = aDistance;
        vLineAlpha = 0.72 + aSeed * 0.28;
        vPathLength = aPathLength;
        vPhase = aPhase;
        vProgress = aProgress;
        vSeed = aSeed;
        vAcross = aSide;
    }
`;

const fragmentShader = /* glsl */ `
    precision highp float;

    uniform float uSpeed;
    uniform float uTime;
    uniform float uOpacity;

    varying float vAcross;
    varying float vDistance;
    varying float vLineAlpha;
    varying float vPathLength;
    varying float vPhase;
    varying float vProgress;
    varying float vSeed;

    void main() {
        float lineSpeed = mix(0.92, 1.08, vSeed);
        float head = mod(uTime * uSpeed * lineSpeed + vPhase * vPathLength, vPathLength);
        float behindHead = mod(head - vDistance + vPathLength, vPathLength);

        float strokeLength = mix(0.72, 0.94, vSeed);
        float normalizedAge = clamp(behindHead / strokeLength, 0.0, 1.0);
        float softEnd = 1.0 - smoothstep(0.78, 1.0, normalizedAge);
        float historyFade = pow(1.0 - normalizedAge, 0.72) * softEnd;
        float headGlow = 1.0 - smoothstep(0.0, 0.045, behindHead);
        float edgeFade = 1.0 - smoothstep(0.10, 1.0, abs(vAcross));
        float pathEntrance = smoothstep(0.0, 0.035, vProgress);
        float pathExit = 1.0 - smoothstep(0.965, 1.0, vProgress);
        float lifecycle = 0.84 + 0.16 * sin(uTime * 0.22 + vSeed * 18.0);

        float alpha = (historyFade * 0.48 + headGlow * 0.52) * edgeFade;
        alpha *= pathEntrance * pathExit * lifecycle * vLineAlpha * uOpacity;

        if (alpha < 0.012) {
            discard;
        }

        gl_FragColor = vec4(vec3(1.0), alpha);
    }
`;

export class ParticleFlow {
    private readonly clock = new THREE.Clock();
    private readonly geometry: THREE.BufferGeometry;
    private readonly glowMaterial: THREE.ShaderMaterial;
    private readonly material: THREE.ShaderMaterial;
    private readonly renderer: THREE.WebGLRenderer;
    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.Camera();
    private readonly resizeObserver: ResizeObserver;
    private animationFrame = 0;
    private disposed = false;
    private elapsedTime = 0;
    private isRunning = false;

    constructor(private readonly container: HTMLElement) {
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.domElement.setAttribute('aria-hidden', 'true');
        this.container.append(this.renderer.domElement);

        this.geometry = this.createGeometry();
        this.glowMaterial = this.createMaterial(2.4, 0.06);
        this.material = this.createMaterial(1, 0.1);
        const glow = new THREE.Mesh(this.geometry, this.glowMaterial);
        const filaments = new THREE.Mesh(this.geometry, this.material);
        glow.renderOrder = 0;
        filaments.renderOrder = 1;
        this.scene.add(glow, filaments);

        this.resizeObserver = new ResizeObserver(this.resize);
        this.resizeObserver.observe(this.container);
        this.resize();
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    start(): void {
        if (this.isRunning) {
            return;
        }

        this.isRunning = true;
        this.clock.start();
        this.render();
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        this.isRunning = false;
        cancelAnimationFrame(this.animationFrame);
        this.resizeObserver.disconnect();
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        this.geometry.dispose();
        this.glowMaterial.dispose();
        this.material.dispose();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }

    private createGeometry(): THREE.BufferGeometry {
        const verticesPerLine = SAMPLES_PER_LINE * 2;
        const lineCount = LINES_PER_PATH * 2;
        const vertexCount = verticesPerLine * lineCount;
        const positions = new Float32Array(vertexCount * 3);
        const distances = new Float32Array(vertexCount);
        const lanes = new Float32Array(vertexCount);
        const pathLengths = new Float32Array(vertexCount);
        const paths = new Float32Array(vertexCount);
        const phases = new Float32Array(vertexCount);
        const progress = new Float32Array(vertexCount);
        const seeds = new Float32Array(vertexCount);
        const sides = new Float32Array(vertexCount);
        const widths = new Float32Array(vertexCount);
        const indices: number[] = [];

        let vertex = 0;

        for (let path = 0; path < 2; path += 1) {
            for (let line = 0; line < LINES_PER_PATH; line += 1) {
                const lanePosition = (line + 0.5) / LINES_PER_PATH - 0.5;
                const lane = lanePosition * BAND_WIDTH;
                const phase = fract((line + path * 0.5) * 0.61803398875);
                const seed = hash(line + path * LINES_PER_PATH + 1);
                const width = 0.00052 + (line % 4) * 0.00008;
                const lineStart = vertex;
                const samplePoints: Point[] = [];
                const sampleDistances: number[] = [0];

                for (let sample = 0; sample < SAMPLES_PER_LINE; sample += 1) {
                    const pathProgress = sample / (SAMPLES_PER_LINE - 1);
                    const point = offsetPathPoint(path, pathProgress, lane);
                    samplePoints.push(point);

                    if (sample > 0) {
                        const previous = samplePoints[sample - 1];
                        sampleDistances.push(
                            sampleDistances[sample - 1] + Math.hypot(point.x - previous.x, point.y - previous.y),
                        );
                    }
                }

                const pathLength = sampleDistances[sampleDistances.length - 1];

                for (let sample = 0; sample < SAMPLES_PER_LINE; sample += 1) {
                    const pathProgress = sample / (SAMPLES_PER_LINE - 1);

                    for (const side of [-1, 1]) {
                        distances[vertex] = sampleDistances[sample];
                        paths[vertex] = path;
                        pathLengths[vertex] = pathLength;
                        lanes[vertex] = lane;
                        phases[vertex] = phase;
                        progress[vertex] = pathProgress;
                        seeds[vertex] = seed;
                        sides[vertex] = side;
                        widths[vertex] = width;
                        vertex += 1;
                    }
                }

                for (let sample = 0; sample < SAMPLES_PER_LINE - 1; sample += 1) {
                    const current = lineStart + sample * 2;
                    const next = current + 2;
                    indices.push(current, current + 1, next, current + 1, next + 1, next);
                }
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setIndex(indices);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aDistance', new THREE.BufferAttribute(distances, 1));
        geometry.setAttribute('aLane', new THREE.BufferAttribute(lanes, 1));
        geometry.setAttribute('aPathLength', new THREE.BufferAttribute(pathLengths, 1));
        geometry.setAttribute('aPath', new THREE.BufferAttribute(paths, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1));
        geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
        geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
        geometry.setAttribute('aWidth', new THREE.BufferAttribute(widths, 1));
        return geometry;
    }

    private createMaterial(widthScale: number, opacity: number): THREE.ShaderMaterial {
        return new THREE.ShaderMaterial({
            transparent: true,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uAspect: { value: 1 },
                uOpacity: { value: opacity },
                uPixelRatio: { value: 1 },
                uSpeed: { value: 0.1 },
                uTime: { value: 0 },
                uWidthScale: { value: widthScale },
            },
            vertexShader,
            fragmentShader,
        });
    }

    private readonly render = (): void => {
        if (!this.isRunning) {
            return;
        }

        this.elapsedTime += Math.min(this.clock.getDelta(), 0.05);
        this.material.uniforms.uTime.value = this.elapsedTime;
        this.glowMaterial.uniforms.uTime.value = this.elapsedTime;
        this.renderer.render(this.scene, this.camera);

        if (!document.hidden) {
            this.animationFrame = requestAnimationFrame(this.render);
        }
    };

    private readonly resize = (): void => {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        if (width === 0 || height === 0) {
            return;
        }

        const pixelRatio = Math.min(window.devicePixelRatio, 2);
        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(width, height, false);
        const aspect = width / height;
        this.updateDistanceAttributes(aspect);
        for (const material of [this.material, this.glowMaterial]) {
            material.uniforms.uAspect.value = aspect;
            material.uniforms.uPixelRatio.value = pixelRatio;
        }
    };

    private updateDistanceAttributes(aspect: number): void {
        const distances = this.geometry.getAttribute('aDistance') as THREE.BufferAttribute;
        const lanes = this.geometry.getAttribute('aLane') as THREE.BufferAttribute;
        const pathLengths = this.geometry.getAttribute('aPathLength') as THREE.BufferAttribute;
        const verticesPerLine = SAMPLES_PER_LINE * 2;

        for (let path = 0; path < 2; path += 1) {
            for (let line = 0; line < LINES_PER_PATH; line += 1) {
                const lineStart = (path * LINES_PER_PATH + line) * verticesPerLine;
                const lane = lanes.getX(lineStart);
                const sampleDistances: number[] = [0];
                let previous = offsetPathPoint(path, 0, lane, aspect);

                for (let sample = 1; sample < SAMPLES_PER_LINE; sample += 1) {
                    const progress = sample / (SAMPLES_PER_LINE - 1);
                    const current = offsetPathPoint(path, progress, lane, aspect);
                    sampleDistances.push(
                        sampleDistances[sampleDistances.length - 1] +
                        Math.hypot(current.x - previous.x, current.y - previous.y),
                    );
                    previous = current;
                }

                const pathLength = sampleDistances[sampleDistances.length - 1];
                for (let sample = 0; sample < SAMPLES_PER_LINE; sample += 1) {
                    const sampleStart = lineStart + sample * 2;
                    for (let side = 0; side < 2; side += 1) {
                        distances.setX(sampleStart + side, sampleDistances[sample]);
                        pathLengths.setX(sampleStart + side, pathLength);
                    }
                }
            }
        }

        distances.needsUpdate = true;
        pathLengths.needsUpdate = true;
    }

    private readonly handleVisibilityChange = (): void => {
        cancelAnimationFrame(this.animationFrame);
        if (document.hidden) {
            this.clock.stop();
            return;
        }

        if (this.isRunning) {
            this.clock.start();
            this.render();
        }
    };

}

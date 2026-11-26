// Perf marks: named time spans at the seams of DashQL on the timeline of the browser, see "Perf marks" in
// docs/design/dashql_runtime.md.
//
// A span is a `performance.measure` named `dashql:<track>:<step>`, e.g. `dashql:planner:plan`. Its detail puts it on
// the track of its first segment in the DashQL group of the performance panel of Chrome, and a lab test reads them with
// `performance.getEntriesByType('measure')`. They are off by default: a span then costs a check of a flag. The core
// module records its own spans (the planner, the analysis) through the recorder that `setEnabled` installs.

/// The prefix of the names of the spans on the timeline
export const PREFIX = 'dashql:';

/// What a module of the core records its spans with: the clock of this timeline and the function that puts a span on
/// it. The clock comes with the recorder, a module that another frame instantiated measures on the clock of this one.
export interface PerfRecorder {
    now(): number;
    record(name: string, detail: string, start: number, end: number): void;
}

/// Installs the recorder in a module of the core, null stops its recording
type RecorderInstall = (recorder: PerfRecorder | null) => void;

/// The recorder of this timeline
const RECORDER: PerfRecorder = { now: () => performance.now(), record };

/// Are the spans recorded?
let recording = false;
/// The modules that record spans of their own
const modules = new Set<RecorderInstall>();

/// Are the spans recorded?
export function enabled(): boolean {
    return recording;
}

/// Record the spans or stop, also those of the modules of the core
export function setEnabled(enable: boolean): void {
    recording = enable;
    for (const install of modules) install(enable ? RECORDER : null);
}

/// Let a module of the core record its spans while the spans are recorded. Returns the release.
export function attachModule(install: RecorderInstall): () => void {
    modules.add(install);
    install(recording ? RECORDER : null);
    return () => {
        modules.delete(install);
        install(null);
    };
}

/// The start of a span, null while nothing is recorded
export function start(): number | null {
    return recording ? performance.now() : null;
}

/// The detail of a span, e.g. the name of a script, or a function that builds it only while the spans are recorded
export type Detail = string | (() => string);

/// End a span that started with `start`. The detail shows with the span.
export function end(name: string, started: number | null, detail?: Detail): void {
    if (started == null || !recording) return;
    const ended = performance.now();
    record(name, typeof detail === 'function' ? detail() : detail ?? '', started, ended);
}

/// Run a function as a span. A function that returns a promise ends the span when it settles.
export function measure<T>(name: string, fn: () => T, detail?: Detail): T {
    const started = start();
    if (started == null) return fn();
    let result: T;
    try {
        result = fn();
    } catch (e) {
        end(name, started, detail);
        throw e;
    }
    if (result instanceof Promise) {
        return result.finally(() => end(name, started, detail)) as T;
    }
    end(name, started, detail);
    return result;
}

/// Put a span on the timeline, on the track of the first segment of its name
function record(name: string, detail: string, startTime: number, endTime: number): void {
    const separator = name.indexOf(':');
    const track = separator < 0 ? name : name.substring(0, separator);
    try {
        performance.measure(PREFIX + name, {
            start: startTime,
            end: Math.max(startTime, endTime),
            detail: {
                // The extension of the performance panel of Chrome, other browsers ignore it
                devtools: {
                    dataType: 'track-entry',
                    track,
                    trackGroup: 'DashQL',
                    color: TRACK_COLORS[track] ?? 'primary',
                    tooltipText: detail.length > 0 ? `${name} ${detail}` : name,
                    properties: detail.length > 0 ? [['detail', detail]] : undefined,
                },
                text: detail,
            },
        });
    } catch {
        // A timeline without user timing loses the span
    }
}

/// The colors of the tracks, the palette of the extension of the performance panel
const TRACK_COLORS: Record<string, string> = {
    store: 'primary',
    runtime: 'primary-dark',
    planner: 'tertiary',
    run: 'tertiary-dark',
    core: 'tertiary-light',
    query: 'secondary',
    results: 'secondary-dark',
    compute: 'secondary-light',
    render: 'primary-light',
    dataflow: 'primary-light',
};

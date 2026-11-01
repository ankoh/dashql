/// The keys of a Vega-Lite spec that hold the views it composes
const VIEW_LIST_KEYS = ['layer', 'concat', 'hconcat', 'vconcat'];

function isObject(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

/// Give every view with a mark an encoding, an empty one if it has none.
///
/// This works around a bug of Vega-Lite (seen in 6.5.0): `getPointOverlay` decides whether line, area and trail
/// marks get a point overlay and reads `encoding.shape` without checking for an encoding. When neither the mark
/// nor the config sets `point`, compiling a view without an encoding throws
/// "Cannot read properties of undefined (reading 'shape')". Bars and the other marks never reach that code.
///
/// The chart builder creates such views: a new chart is `{ mark: 'bar' }` without fields, switching its mark gives
/// `{ mark: 'line' }`, and a new layer is `{ mark: 'line' }` too. Hand-written specs of scripts can be the same.
/// A view in a layer, a concat, a facet or a repeat fails alike, unless the parent has an encoding that the
/// layers inherit. The empty encoding is added only to the spec that is compiled, every place that compiles
/// Vega-Lite calls this, so the authored spec in the script keeps its keys.
///
/// Returns the spec itself when no view lacks an encoding.
export function withViewEncodings<T>(spec: T): T {
    if (!isObject(spec)) return spec;
    let out: Record<string, unknown> | null = null;
    const set = (key: string, value: unknown) => {
        out ??= { ...spec };
        out[key] = value;
    };
    if ('mark' in spec && !isObject(spec.encoding)) set('encoding', {});
    for (const key of VIEW_LIST_KEYS) {
        const views = spec[key];
        if (!Array.isArray(views)) continue;
        const next = views.map(withViewEncodings);
        if (next.some((view, i) => view !== views[i])) set(key, next);
    }
    // The view of a facet or a repeat
    if (isObject(spec.spec)) {
        const view = withViewEncodings(spec.spec);
        if (view !== spec.spec) set('spec', view);
    }
    return (out ?? spec) as T;
}

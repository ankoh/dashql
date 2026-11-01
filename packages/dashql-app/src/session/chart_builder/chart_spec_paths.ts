/// Edits of a Vega-Lite spec for the chart builder.
///
/// The spec itself is the model of the builder. Every edit replaces the objects on the path to one key and keeps
/// all other keys, so properties that the builder does not show (axis, scale, transform, params, ...) survive.

export type ChartSpec = Record<string, unknown>;
export type ChannelDef = Record<string, unknown>;

/// The marks of the builder, the first ones are shown as buttons
export const PRIMARY_MARKS = ['bar', 'line', 'area', 'point'] as const;
export const SECONDARY_MARKS = ['circle', 'square', 'tick', 'rect', 'rule', 'text', 'arc', 'boxplot'] as const;

/// The encoding channels of the builder, in the order of the rows
export const CHANNELS = ['x', 'y', 'color', 'size', 'shape', 'opacity', 'text', 'tooltip', 'detail', 'theta', 'x2', 'y2', 'row', 'column'] as const;
export type Channel = typeof CHANNELS[number];
/// The channels that a new chart shows, also while they are empty
export const DEFAULT_CHANNELS: readonly Channel[] = ['x', 'y', 'color'];

export const FIELD_TYPES = ['quantitative', 'nominal', 'ordinal', 'temporal'] as const;
export type FieldType = typeof FIELD_TYPES[number];
export const FIELD_TYPE_SHORT: Record<FieldType, string> = { quantitative: 'Q', nominal: 'N', ordinal: 'O', temporal: 'T' };

export const AGGREGATES = ['count', 'sum', 'mean', 'median', 'min', 'max', 'distinct'] as const;
export const TIME_UNITS = ['year', 'quarter', 'month', 'yearmonth', 'yearmonthdate', 'date', 'day', 'hours', 'minutes'] as const;
export const SORTS = ['ascending', 'descending'] as const;

/// The keys of a channel that the builder edits. Clearing a field removes these and keeps the others.
const OWNED_CHANNEL_KEYS = ['field', 'type', 'aggregate', 'bin', 'timeUnit', 'sort', 'title', 'stack'];

/// The keys that compose views. The builder edits single views and layers of single views.
const COMPOSITION_KEYS = ['layer', 'concat', 'hconcat', 'vconcat', 'repeat', 'spec', 'facet'];
/// The keys of a single view that move into the first layer when a second layer is added
const LAYER_KEYS = ['mark', 'encoding'];

function isObject(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isSingleView(spec: ChartSpec): boolean {
    return COMPOSITION_KEYS.every(key => !(key in spec));
}

/// The layers of a layered spec, null for a single view
export function getLayers(spec: ChartSpec): ChartSpec[] | null {
    return Array.isArray(spec.layer) ? spec.layer as ChartSpec[] : null;
}

/// Can the builder edit the spec? A layer of single views is edited one layer at a time. Other compositions, nested
/// layers and an encoding that the layers share are edited as JSON.
export function isBuilderEditable(spec: ChartSpec): boolean {
    if (isSingleView(spec)) return true;
    const layers = getLayers(spec);
    if (layers == null || layers.length === 0 || 'encoding' in spec || 'mark' in spec) return false;
    if (COMPOSITION_KEYS.some(key => key !== 'layer' && key in spec)) return false;
    return layers.every(layer => isObject(layer) && isSingleView(layer));
}

/// The number of views that the builder edits, a single view is one layer
export function layerCount(spec: ChartSpec): number {
    return getLayers(spec)?.length ?? 1;
}

/// The view of a layer, the spec itself for a single view
export function getLayer(spec: ChartSpec, index: number): ChartSpec {
    return getLayers(spec)?.[index] ?? spec;
}

/// Replace the view of a layer, the spec itself for a single view
export function setLayer(spec: ChartSpec, index: number, view: ChartSpec): ChartSpec {
    const layers = getLayers(spec);
    if (layers == null) return view;
    return { ...spec, layer: layers.map((layer, i) => i === index ? view : layer) };
}

/// Add a layer. A single view moves its mark and encoding into the first layer, the other keys stay on top, e.g. the
/// title, the size, the data and the transforms that the layers share.
export function addLayer(spec: ChartSpec, view: ChartSpec): ChartSpec {
    const layers = getLayers(spec);
    if (layers != null) return { ...spec, layer: [...layers, view] };
    const top: ChartSpec = {};
    const first: ChartSpec = {};
    for (const [key, value] of Object.entries(spec)) {
        if (LAYER_KEYS.includes(key)) first[key] = value;
        else top[key] = value;
    }
    return { ...top, layer: [first, view] };
}

/// The view of a new line layer that shares x with the given layer. A dropped column goes on y and aggregates a measure
/// like the y of the given layer, e.g. a line of the mean revenue over the bars of the summed revenue per region.
export function newLayerView(from: ChartSpec, column?: { field: string; type: FieldType }): ChartSpec {
    const encoding: Record<string, unknown> = {};
    const x = getChannel(from, 'x');
    if (x != null) encoding.x = x;
    if (column != null) {
        const y = getChannel(from, 'y');
        const aggregate = isObject(y) && typeof y.aggregate === 'string' && y.aggregate !== 'count' ? y.aggregate : undefined;
        encoding.y = column.type === 'quantitative' && aggregate != null
            ? { field: column.field, type: column.type, aggregate }
            : { field: column.field, type: column.type };
    }
    return Object.keys(encoding).length === 0 ? { mark: 'line' } : { mark: 'line', encoding };
}

/// Add a layer that shows a dropped column, see `newLayerView`. The layers that have no color yet get the label of
/// their y as a color datum: each gets a color of the palette, and the legend tells them apart.
export function addColumnLayer(spec: ChartSpec, from: number, column: { field: string; type: FieldType }): ChartSpec {
    let next = addLayer(spec, newLayerView(getLayer(spec, from), column));
    const fromIndex = getLayers(spec) == null ? 0 : from;
    for (const index of [fromIndex, layerCount(next) - 1]) {
        const view = getLayer(next, index);
        const label = channelSummary(getChannel(view, 'y'));
        if (label != null && getChannel(view, 'color') == null) {
            next = setLayer(next, index, patchChannel(view, 'color', { datum: label }));
        }
    }
    return next;
}

/// Remove a layer. The last layer becomes a single view again unless its keys clash with the keys on top.
export function removeLayer(spec: ChartSpec, index: number): ChartSpec {
    const layers = getLayers(spec);
    if (layers == null || layers.length <= 1) return spec;
    const rest = layers.filter((_, i) => i !== index);
    const top = { ...spec };
    delete top.layer;
    if (rest.length === 1 && Object.keys(rest[0]).every(key => !(key in top))) {
        return { ...top, ...rest[0] };
    }
    return { ...top, layer: rest };
}

/// The type of the mark, a string or the type of a mark object
export function getMarkType(spec: ChartSpec): string | null {
    const mark = spec.mark;
    if (typeof mark === 'string') return mark;
    if (isObject(mark) && typeof mark.type === 'string') return mark.type;
    return null;
}

/// Set the type of the mark. A mark object keeps its other properties.
export function setMarkType(spec: ChartSpec, type: string): ChartSpec {
    const mark = spec.mark;
    if (isObject(mark)) return { ...spec, mark: { ...mark, type } };
    return { ...spec, mark: type };
}

function getEncoding(spec: ChartSpec): Record<string, unknown> {
    return isObject(spec.encoding) ? spec.encoding : {};
}

/// The definition of a channel, null if the channel is not encoded
export function getChannel(spec: ChartSpec, channel: string): unknown {
    return getEncoding(spec)[channel] ?? null;
}

/// The channels that the spec encodes
export function encodedChannels(spec: ChartSpec): string[] {
    return Object.keys(getEncoding(spec));
}

/// Is a channel definition something that the builder cannot edit, e.g. a value, a datum, a condition or a list?
export function isCustomChannel(def: unknown): boolean {
    if (def == null) return false;
    if (!isObject(def)) return true;
    return 'value' in def || 'datum' in def || 'condition' in def || 'repeat' in def;
}

/// Is a channel a count of the rows, it has no field then
export function isCountChannel(def: unknown): boolean {
    return isObject(def) && def.aggregate === 'count' && def.field == null;
}

/// Set the encoding of the spec, an empty encoding is removed
function withEncoding(spec: ChartSpec, encoding: Record<string, unknown>): ChartSpec {
    const next = { ...spec };
    if (Object.keys(encoding).length === 0) {
        delete next.encoding;
    } else {
        next.encoding = encoding;
    }
    return next;
}

/// Set or remove properties of a channel. An undefined value removes the key, a channel without keys is removed.
export function patchChannel(spec: ChartSpec, channel: string, patch: Record<string, unknown>): ChartSpec {
    const encoding = { ...getEncoding(spec) };
    const current = encoding[channel];
    const def: ChannelDef = isObject(current) ? { ...current } : {};
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) {
            delete def[key];
        } else {
            def[key] = value;
        }
    }
    if (Object.keys(def).length === 0) {
        delete encoding[channel];
    } else {
        encoding[channel] = def;
    }
    return withEncoding(spec, encoding);
}

/// Encode a channel with a field. Properties that do not fit the new type are removed, the others are kept.
export function setChannelField(spec: ChartSpec, channel: string, field: string, type: FieldType): ChartSpec {
    const current = getChannel(spec, channel);
    const def = isObject(current) && !isCustomChannel(current) ? current : {};
    const aggregate = def.aggregate === 'count' ? undefined : def.aggregate;
    return patchChannel(replaceChannel(spec, channel, def), channel, {
        field,
        type,
        aggregate,
        bin: type === 'quantitative' ? def.bin : undefined,
        timeUnit: type === 'temporal' ? def.timeUnit : undefined,
    });
}

/// Encode a channel with the count of the rows
export function setChannelCount(spec: ChartSpec, channel: string): ChartSpec {
    const current = getChannel(spec, channel);
    const def = isObject(current) && !isCustomChannel(current) ? current : {};
    return patchChannel(replaceChannel(spec, channel, def), channel, {
        field: undefined,
        aggregate: 'count',
        type: 'quantitative',
        bin: undefined,
        timeUnit: undefined,
    });
}

/// Set the type of the field of a channel, removing the properties that do not fit the type
export function setChannelType(spec: ChartSpec, channel: string, type: FieldType): ChartSpec {
    const def = getChannel(spec, channel);
    return patchChannel(spec, channel, {
        type,
        bin: type === 'quantitative' && isObject(def) ? def.bin : undefined,
        timeUnit: type === 'temporal' && isObject(def) ? def.timeUnit : undefined,
    });
}

/// Remove the field of a channel. The keys that the builder does not own stay, e.g. an axis or a scale.
export function clearChannelField(spec: ChartSpec, channel: string): ChartSpec {
    const def = getChannel(spec, channel);
    if (!isObject(def)) return removeChannel(spec, channel);
    const patch: Record<string, undefined> = {};
    for (const key of OWNED_CHANNEL_KEYS) patch[key] = undefined;
    return patchChannel(spec, channel, patch);
}

/// Remove a channel with all its properties
export function removeChannel(spec: ChartSpec, channel: string): ChartSpec {
    const encoding = { ...getEncoding(spec) };
    delete encoding[channel];
    return withEncoding(spec, encoding);
}

function replaceChannel(spec: ChartSpec, channel: string, def: ChannelDef): ChartSpec {
    return withEncoding(spec, { ...getEncoding(spec), [channel]: def });
}

/// Set or remove a top-level property, e.g. the title or the width
export function setTopLevel(spec: ChartSpec, key: string, value: unknown): ChartSpec {
    const next = { ...spec };
    if (value === undefined) {
        delete next[key];
    } else {
        next[key] = value;
    }
    return next;
}

/// The fields that the spec encodes, also in nested channels of a list
export function encodedFields(spec: ChartSpec): string[] {
    const fields = new Set<string>();
    const visit = (def: unknown) => {
        if (Array.isArray(def)) {
            def.forEach(visit);
        } else if (isObject(def) && typeof def.field === 'string') {
            fields.add(def.field);
        }
    };
    for (const view of [spec, ...(getLayers(spec) ?? [])]) {
        for (const def of Object.values(getEncoding(view))) visit(def);
    }
    return [...fields];
}

/// A short label of a channel, e.g. `sum(revenue)` or `month(created)`
export function channelSummary(def: unknown): string | null {
    if (!isObject(def)) return null;
    if (isCountChannel(def)) return 'count()';
    if (typeof def.field !== 'string') return null;
    const wrap = typeof def.aggregate === 'string' ? def.aggregate
        : typeof def.timeUnit === 'string' ? def.timeUnit
        : def.bin === true || isObject(def.bin) ? 'bin'
        : null;
    return wrap == null ? def.field : `${wrap}(${def.field})`;
}

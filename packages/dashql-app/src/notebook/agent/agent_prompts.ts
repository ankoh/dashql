/// Pure prompt builders for the agent loop. No I/O — these just assemble strings that the
/// driver passes to `AIClient.generate`. Kept free of React / WASM so they are trivially
/// unit-testable.

export type AgentIntent = 'sql' | 'visualize';

/// Input shared by the SQL / visualize prompt builders.
export interface GenerationPromptInput {
    /// The assembled context block (focused script SQL + referenced-table schema, …).
    context: string;
    /// The user's natural-language instruction.
    userPrompt: string;
    /// The candidate produced by the previous attempt (present only on repair attempts).
    previousCandidate?: string | null;
    /// Error messages from the previous attempt's verification (present only on repair).
    errors?: string[];
}

/// Build the classification prompt. The model must answer with exactly one word.
export function buildClassifyPrompt(userPrompt: string): string {
    return [
        'You are an intent classifier for a SQL notebook with charting.',
        'Decide whether the user wants to (a) write or modify a SQL query, or',
        '(b) visualize / chart data.',
        'Answer with exactly one lowercase word: "sql" or "visualize". No other text.',
        '',
        `User request: ${userPrompt}`,
    ].join('\n');
}

/// Parse a classification completion into an intent. Defaults to 'sql' when ambiguous —
/// SQL is the safer fallback (it modifies in-place / creates a query entry rather than
/// fabricating a chart from an unclear request).
export function parseIntent(completion: string): AgentIntent {
    const text = completion.toLowerCase();
    const hasVisualize = /\bvisuali[sz]e\b|\bchart\b|\bplot\b|\bgraph\b/.test(text);
    const hasSql = /\bsql\b|\bquery\b/.test(text);
    if (hasVisualize && !hasSql) return 'visualize';
    return 'sql';
}

function repairBlock(input: GenerationPromptInput): string[] {
    const errors = input.errors ?? [];
    if (errors.length === 0) return [];
    const lines = [
        '',
        'Your previous answer did not pass verification. Fix it.',
    ];
    if (input.previousCandidate) {
        lines.push('Previous answer:', input.previousCandidate);
    }
    lines.push('Errors to fix:');
    for (const e of errors) {
        lines.push(`- ${e}`);
    }
    return lines;
}

/// Build the SQL generation / repair prompt.
export function buildSqlPrompt(input: GenerationPromptInput): string {
    const lines = [
        'You are a SQL assistant for the DashQL notebook.',
        'The dialect is PostgreSQL-like (standard SELECT / CTE / window functions).',
        'Return ONLY the SQL statement. No markdown code fences, no prose, no explanation.',
        '',
        '--- Context ---',
        input.context,
        '--- End context ---',
        '',
        `Instruction: ${input.userPrompt}`,
        ...repairBlock(input),
    ];
    return lines.join('\n');
}

/// Build the visualization generation / repair prompt. The model emits a constrained
/// Vega-Lite spec which we transcode into a DashQL VISUALIZE statement.
///
/// The prompt is deliberately explicit about (a) the exact machine-readable surface we can
/// transcode — anything outside it is silently dropped or fails transcoding — and (b) editorial
/// guidance on how to pick a good chart, since the model otherwise defaults to bland bar charts
/// with un-aggregated data. Keep the hard constraints (JSON-only, no `data` member, real columns
/// only) verbatim: `extractJsonObject` and the WASM transcoder depend on them.
export function buildVisualizePrompt(input: GenerationPromptInput): string {
    const prompt = `You are an expert data-visualization assistant for the DashQL notebook.
Your job is to turn a natural-language request into ONE effective chart, expressed as a
restricted Vega-Lite specification that DashQL transcodes into a VISUALIZE statement.

OUTPUT FORMAT (strict):
- Return ONLY a single JSON object. No markdown code fences, no prose, no explanation,
  no leading or trailing text. The first character of your reply must be "{".

SCOPE — a SINGLE view only:
- The only top-level keys that are honored are: "mark", "encoding", "title", "width",
  "height". Everything else at the top level is IGNORED — do NOT use "layer", "facet",
  "repeat", "concat", "hconcat", "vconcat", "transform", "params", "selection", "config",
  "resolve", "projection" or "datasets". Express the request as one mark + one encoding.
- Do NOT include a "data" field — the data source is supplied separately by DashQL.

MARK — "mark" is either a string or an object {"type": <mark>, …}. Mark types:
  bar, line, area, point, circle, square, rect, arc, rule, tick, text, trail,
  boxplot, geoshape, image.
  As an object it may also carry: "point"/"line" (boolean or a nested mark object, e.g.
  a line with visible points), "filled", "fill", "stroke", "color", "opacity",
  "fillOpacity", "strokeOpacity", "strokeWidth", "strokeDash", "size", "shape", "angle",
  "radius", "cornerRadius", "orient", "interpolate", "tension", "thickness", "tooltip".

ENCODING — "encoding" maps channels to field definitions. Available channels:
  - Position:   x, y, x2, y2, xOffset, yOffset
  - Polar/arc:  theta, theta2, radius, radius2, angle
  - Mark style: color, fill, stroke, opacity, fillOpacity, strokeOpacity, strokeWidth,
                strokeDash, size, shape
  - Labels:     text, tooltip, detail, order, key, href
  - Faceting:   row, column, facet   (small multiples — still one mark/encoding)
  - Geographic: latitude, longitude, latitude2, longitude2

FIELD DEFINITION — each channel maps to an object with any of:
  - "field": a column name that EXISTS in the context schema below.
  - "type": nominal | ordinal | quantitative | temporal | geojson.
  - "aggregate": sum | mean | average | count | min | max | median | stdev | variance …
  - "bin": true, or an object like {"maxbins": 20, "step": 5}.
  - "timeUnit" (temporal): year | quarter | month | week | day | date | hours | minutes …
  - "sort": "ascending" | "descending" | "-x" | "-y" | a field name.
  - "stack": "zero" | "normalize" | "center" | true | false (position channels).
  - "title", "format", "formatType", "bandPosition", "impute", "condition".
  - "value" / "datum": a constant encoding instead of a field.
  - "scale": object with any of type (linear, log, pow, sqrt, symlog, time, utc, ordinal,
    band, point, quantile, quantize, threshold, sequential), domain, domainMin, domainMax,
    domainMid, range, rangeMin, rangeMax, scheme, interpolate, nice, zero, clamp, padding,
    paddingInner, paddingOuter, reverse, round, exponent, bins.
  - "axis": object with any of orient, format, formatType, grid, ticks, tickCount, tickSize,
    labelAngle, labelFontSize, labelOverlap, direction, offset, values, zindex, title, domain.
  - "legend": object with any of type, orient, format, formatType, direction, title, values,
    padding, offset, zindex.

HARD RULES:
- Do NOT invent, rename, or guess column names. Use ONLY columns that appear in the
  context schema. If a requested column is absent, choose the closest matching real column.
- Choose "type" from the column's data type: numeric measures are quantitative, dates/
  timestamps are temporal, free-text categories are nominal, discrete ranks/buckets are ordinal.
- Prefer the standard Vega-Lite property names above; unrecognized properties are dropped.

CHART-DESIGN GUIDANCE (pick the most informative chart, not just the first that fits):
- Trend over time → line (or area) with the temporal column on x and a quantitative measure
  on y; add a "timeUnit" when the request implies a granularity (per month, per day, …).
- Comparison across categories → bar with the category on x (or y for many/long labels) and
  an aggregated measure on the other axis; sort bars by the measure ("-y" or "-x") unless the
  category has a natural order.
- Part-to-whole → arc (pie/donut) with theta as the aggregated measure and color as the category;
  prefer a bar chart when there are more than ~6 categories.
- Distribution of one measure → bar with "bin": true on x and {"aggregate": "count"} on y.
- Relationship between two measures → point (scatter); add color/size for a third dimension.
- Use "color" to encode a secondary category (grouped/stacked bars, multi-series lines).
- Add "tooltip" for the fields a reader would want to inspect, and give the chart a concise
  "title" that states what it shows.
- Keep it to a single, readable chart — do not overload it with unnecessary channels.

--- Context (focused script + available columns) ---
${input.context}
--- End context ---

Instruction: ${input.userPrompt}`;

    const repair = repairBlock(input);
    return repair.length > 0 ? `${prompt}\n${repair.join('\n')}` : prompt;
}

/// Defensively isolate the SQL body from a completion: strip markdown fences and any
/// leading/trailing prose the model adds despite instructions.
export function extractSql(completion: string): string {
    const fenced = extractFenced(completion);
    return (fenced ?? completion).trim();
}

/// Defensively isolate the first JSON object from a completion: strip fences, then slice
/// from the first `{` to its matching `}` (brace-balanced, string-aware).
export function extractJsonObject(completion: string): string {
    const fenced = extractFenced(completion);
    const text = (fenced ?? completion).trim();
    const start = text.indexOf('{');
    if (start < 0) return text;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; ++i) {
        const ch = text[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
        } else if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return text.slice(start, i + 1);
            }
        }
    }
    // Unbalanced — return from the first brace and let JSON.parse report the error.
    return text.slice(start);
}

/// Extract the content of the first fenced code block (``` … ```), if any.
function extractFenced(completion: string): string | null {
    const match = /```(?:[a-zA-Z]*)?\n?([\s\S]*?)```/.exec(completion);
    return match ? match[1] : null;
}

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
export function buildVisualizePrompt(input: GenerationPromptInput): string {
    const lines = [
        'You are a data-visualization assistant for the DashQL notebook.',
        'Return ONLY a single JSON object for a restricted Vega-Lite specification.',
        'No markdown code fences, no prose, no explanation.',
        '',
        'Use only this restricted surface:',
        '- "mark": one of bar, line, area, point, circle, square, rect, arc, rule, tick, text.',
        '  (a string, or an object {"type": <mark>}).',
        '- "encoding": an object whose keys are channels:',
        '  x, y, x2, y2, color, fill, stroke, size, shape, opacity, theta, angle,',
        '  tooltip, detail, order, row, column.',
        '  Each channel is an object with: "field" (a column name), "type"',
        '  (nominal | ordinal | quantitative | temporal), and optionally',
        '  "aggregate" (sum | mean | count | min | max | median), "bin" (true or an',
        '  object), "timeUnit" (year | month | day | …), "sort", "scale", "axis", "legend".',
        '- Optional top-level "title" (string), "width" (number), "height" (number).',
        'Do NOT include a "data" field — the data source is supplied separately.',
        'Do NOT invent column names; use only columns present in the context schema.',
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

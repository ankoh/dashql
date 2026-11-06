// Line coverage of the app sources from the V8 block coverage of Chromium.
//
// The coverage bundle (`:coverage_pages`) is unminified and has source maps. The driver records the precise coverage
// of the page and its same-origin test frames over the whole run. Every mapping segment of a source map is one probe
// of an original line: it gets the count of the innermost V8 range around its generated offset. A line is hit if one
// of its probes ran. Chunks that were never loaded count as not run, so untested modules show up as uncovered.

import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUES = new Map([...BASE64].map((char, index) => [char, index]));

/// Decode the `mappings` of a source map into [generatedLine, generatedColumn, sourceIndex, originalLine] segments
export function decodeMappings(mappings) {
    const segments = [];
    let sourceIndex = 0;
    let originalLine = 0;
    let line = 0;
    for (const lineMappings of mappings.split(';')) {
        let column = 0;
        for (const segment of lineMappings.split(',')) {
            if (segment.length === 0) continue;
            const fields = [];
            let value = 0;
            let shift = 0;
            for (const char of segment) {
                const digit = BASE64_VALUES.get(char);
                if (digit === undefined) throw new Error(`Invalid VLQ character: ${char}`);
                value += (digit & 31) << shift;
                if (digit & 32) {
                    shift += 5;
                } else {
                    fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
                    value = 0;
                    shift = 0;
                }
            }
            column += fields[0];
            if (fields.length >= 4) {
                sourceIndex += fields[1];
                originalLine += fields[2];
                segments.push([line, column, sourceIndex, originalLine]);
            }
        }
        line += 1;
    }
    return segments;
}

/// The app source of a source map entry, or null for dependencies, generated code and tests
export function appSourcePath(source) {
    const normalized = posix.normalize(source.replaceAll('\\', '/'));
    if (normalized.includes('node_modules/') || normalized.includes('/dependencies/')) return null;
    const match = /(?:^|\/)(src\/.*)$/.exec(normalized);
    if (!match) return null;
    const file = match[1];
    if (/\.test\.(ts|tsx)$/.test(file) || file.startsWith('src/tests/')) return null;
    if (!/\.(ts|tsx|js)$/.test(file)) return null;
    return file;
}

/// The counts at the given ascending offsets, from V8 ranges that nest
export function countsAtOffsets(ranges, offsets) {
    const sorted = [...ranges].sort((l, r) => l.startOffset - r.startOffset || r.endOffset - l.endOffset);
    const counts = new Array(offsets.length);
    const stack = [];
    let next = 0;
    for (let i = 0; i < offsets.length; ++i) {
        const offset = offsets[i];
        while (next < sorted.length && sorted[next].startOffset <= offset) {
            const range = sorted[next++];
            while (stack.length > 0 && stack[stack.length - 1].endOffset <= range.startOffset) stack.pop();
            stack.push(range);
        }
        while (stack.length > 0 && stack[stack.length - 1].endOffset <= offset) stack.pop();
        counts[i] = stack.length > 0 ? stack[stack.length - 1].count : 0;
    }
    return counts;
}

function listSourceMaps(root) {
    const maps = [];
    const visit = dir => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) visit(path);
            else if (entry.name.endsWith('.js.map')) maps.push(path);
        }
    };
    visit(root);
    return maps.sort();
}

function lineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; ++i) {
        if (text.charCodeAt(i) === 10) starts.push(i + 1);
    }
    return starts;
}

/// The first index of the ascending offsets that is >= the offset
function lowerBound(offsets, offset) {
    let lo = 0;
    let hi = offsets.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid] < offset) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/// Map the V8 coverage of the scripts of a bundle to the lines of the app sources.
/// Returns the line coverage, a map from the app source path to a map from line number (1-based) to the hit flag,
/// and the gaps, the outermost functions and blocks that never ran.
export function mapCoverage(root, scriptCoverages) {
    const functionsByPath = new Map();
    for (const script of scriptCoverages) {
        if (!script.url) continue;
        let pathname;
        try {
            pathname = decodeURIComponent(new URL(script.url).pathname).slice(1);
        } catch {
            continue;
        }
        if (!functionsByPath.has(pathname)) functionsByPath.set(pathname, []);
        functionsByPath.get(pathname).push(script.functions);
    }

    const lines = new Map();
    const chunks = [];
    for (const mapFile of listSourceMaps(root)) {
        const scriptFile = mapFile.slice(0, -'.map'.length);
        const scriptPath = relative(root, scriptFile).split(sep).join('/');
        const sourceMap = JSON.parse(readFileSync(mapFile, 'utf8'));
        const sourceRoot = sourceMap.sourceRoot ?? '';
        const sources = sourceMap.sources.map(source =>
            appSourcePath(posix.join(posix.dirname(scriptPath), sourceRoot, source)),
        );
        if (sources.every(source => source === null)) continue;

        const segments = decodeMappings(sourceMap.mappings).filter(segment => sources[segment[2]] !== null);
        const starts = lineStarts(readFileSync(scriptFile, 'utf8'));
        const offsets = segments.map(([line, column]) => (starts[line] ?? 0) + column);
        const hits = new Array(segments.length).fill(false);
        const instances = functionsByPath.get(scriptPath) ?? [];
        for (const functions of instances) {
            const counts = countsAtOffsets(functions.flatMap(fn => fn.ranges), offsets);
            for (let i = 0; i < counts.length; ++i) if (counts[i] > 0) hits[i] = true;
        }
        for (let i = 0; i < segments.length; ++i) {
            const source = sources[segments[i][2]];
            const line = segments[i][3] + 1;
            if (!lines.has(source)) lines.set(source, new Map());
            const sourceLines = lines.get(source);
            sourceLines.set(line, (sourceLines.get(line) ?? false) || hits[i]);
        }
        chunks.push({ sources, segments, offsets, hits, instances });
    }

    const gaps = chunks.flatMap(chunk => findGaps(chunk, lines));
    return { lines, gaps };
}

/// The outermost V8 ranges of a chunk that ran in no instance and hold no probe that ran
function findGaps({ sources, segments, offsets, hits, instances }, lines) {
    // The ranges of all instances, a range ran if it ran in one of them
    const ranges = new Map();
    const functions = [];
    for (const instance of instances) {
        for (const fn of instance) {
            for (const [index, range] of fn.ranges.entries()) {
                const key = `${range.startOffset}:${range.endOffset}`;
                const known = ranges.get(key);
                if (known) {
                    known.ran ||= range.count > 0;
                } else {
                    ranges.set(key, { start: range.startOffset, end: range.endOffset, ran: range.count > 0 });
                    if (index === 0) functions.push({ start: range.startOffset, end: range.endOffset, name: fn.functionName });
                }
            }
        }
    }
    const hitPrefix = [0];
    for (const hit of hits) hitPrefix.push(hitPrefix[hitPrefix.length - 1] + (hit ? 1 : 0));

    const candidates = [...ranges.values()]
        .filter(range => !range.ran)
        .sort((l, r) => l.start - r.start || r.end - l.end);
    const gaps = [];
    let outerEnd = -1;
    for (const range of candidates) {
        if (range.end <= outerEnd) continue;
        const first = lowerBound(offsets, range.start);
        const last = lowerBound(offsets, range.end);
        if (first === last || hitPrefix[last] - hitPrefix[first] > 0) continue;
        outerEnd = range.end;

        // The uncovered lines of the source with the most probes in the range
        const lineSets = new Map();
        for (let i = first; i < last; ++i) {
            const source = sources[segments[i][2]];
            const line = segments[i][3] + 1;
            if (lines.get(source).get(line)) continue;
            if (!lineSets.has(source)) lineSets.set(source, new Set());
            lineSets.get(source).add(line);
        }
        const [source, uncovered] = [...lineSets].sort((l, r) => r[1].size - l[1].size)[0] ?? [];
        if (!source) continue;
        const enclosing = functions
            .filter(fn => fn.start <= range.start && range.end <= fn.end && fn.name)
            .sort((l, r) => l.end - l.start - (r.end - r.start))[0];
        gaps.push({
            source,
            startLine: Math.min(...uncovered),
            endLine: Math.max(...uncovered),
            uncoveredLines: uncovered.size,
            functionName: enclosing?.name ?? '',
        });
    }
    return gaps;
}

/// Render the line coverage as LCOV, with paths relative to the repository
export function toLcov(lines, prefix) {
    const records = [];
    for (const source of [...lines.keys()].sort()) {
        const sourceLines = [...lines.get(source)].sort((l, r) => l[0] - r[0]);
        const hit = sourceLines.filter(([, isHit]) => isHit).length;
        records.push(
            [
                `SF:${prefix}${source}`,
                ...sourceLines.map(([line, isHit]) => `DA:${line},${isHit ? 1 : 0}`),
                `LH:${hit}`,
                `LF:${sourceLines.length}`,
                'end_of_record',
            ].join('\n'),
        );
    }
    return `${records.join('\n')}\n`;
}

/// A plain-text summary that points at the next gaps: the largest functions and blocks that never ran in loaded chunks,
/// split into logic (.ts) and components (.tsx), the files where no line ran, and the line coverage of all files.
/// A file where no line ran may well be loaded: a module of function declarations has no line that runs on import.
export function toSummary({ lines, gaps }) {
    const rows = [...lines].map(([source, sourceLines]) => {
        const found = sourceLines.size;
        const hit = [...sourceLines.values()].filter(Boolean).length;
        return { source, found, hit };
    });
    rows.sort((l, r) => r.found - r.hit - (l.found - l.hit) || l.source.localeCompare(r.source));
    const found = rows.reduce((sum, row) => sum + row.found, 0);
    const hit = rows.reduce((sum, row) => sum + row.hit, 0);
    const percent = (h, f) => (f === 0 ? '100.0' : ((100 * h) / f).toFixed(1));
    const notRun = rows.filter(row => row.hit === 0);
    const sortedGaps = [...gaps]
        .sort((l, r) => r.uncoveredLines - l.uncoveredLines || l.source.localeCompare(r.source) || l.startLine - r.startLine);
    const gapTable = (title, selected) => [
        `${title} (${selected.length})`,
        'uncovered\tlocation\tfunction',
        ...selected.map(gap => `${gap.uncoveredLines}\t${gap.source}:${gap.startLine}-${gap.endLine}\t${gap.functionName || '-'}`),
        '',
    ];
    return [
        `Overall: ${percent(hit, found)}% (${hit} / ${found} lines) in ${rows.length} files`,
        '',
        ...gapTable('Gaps in logic: functions and blocks of .ts files that never ran', sortedGaps.filter(gap => !gap.source.endsWith('.tsx'))),
        ...gapTable('Gaps in components: functions and blocks of .tsx files that never ran', sortedGaps.filter(gap => gap.source.endsWith('.tsx'))),
        `Files where no line ran (${notRun.length})`,
        'lines\tfile',
        ...notRun.map(row => `${row.found}\t${row.source}`),
        '',
        'Line coverage per file',
        'uncovered\thit/found\tcoverage\tfile',
        ...rows.map(row => `${row.found - row.hit}\t${row.hit}/${row.found}\t${percent(row.hit, row.found)}%\t${row.source}`),
    ].join('\n');
}

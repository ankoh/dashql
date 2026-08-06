import { describe, it, expect } from 'vitest';

import { buildVisualizePrompt, diagnoseVegaLiteSpec, SUPPORTED_VEGA_MARKS } from './agent_prompts.js';

const CTX = 'Source query (feeds the chart):\nselect v as x, random() as y\n\nCurrent chart (Vega-Lite spec):\n{ "mark": "point" }';

describe('buildVisualizePrompt — edit vs generate framing', () => {
    it('frames a fresh chart as a generate task', () => {
        const prompt = buildVisualizePrompt({ context: CTX, userPrompt: 'use line chart', editingChart: false });
        expect(prompt).toContain('turn a natural-language request into ONE effective chart');
        // Generate keeps the chart-design guidance and its own worked example.
        expect(prompt).toContain('CHART-DESIGN GUIDANCE');
        expect(prompt).toContain('EXAMPLE — generating a chart');
        expect(prompt).not.toContain('You are EDITING');
    });

    it('frames an existing chart as an edit task that preserves the encoding', () => {
        const prompt = buildVisualizePrompt({ context: CTX, userPrompt: 'use line chart', editingChart: true });
        expect(prompt).toContain('You are EDITING the existing chart');
        expect(prompt).toContain('PRESERVE every other field verbatim');
        // The edit example demonstrates carrying encoding across a mark change.
        expect(prompt).toContain('EXAMPLE — editing a chart');
        expect(prompt).toContain('the encoding is carried over unchanged');
        // Chart-design guidance is generate-only noise for an edit, so it is dropped.
        expect(prompt).not.toContain('CHART-DESIGN GUIDANCE');
        // The edit-specific hard rule is present.
        expect(prompt).toContain('return the full spec with the "encoding" block preserved');
    });

    it('defaults to the generate framing when editingChart is omitted', () => {
        const prompt = buildVisualizePrompt({ context: CTX, userPrompt: 'a chart please' });
        expect(prompt).not.toContain('You are EDITING');
        expect(prompt).toContain('turn a natural-language request into ONE effective chart');
    });

    it('places the hard rules and the instruction at the end, nearest the model turn', () => {
        const prompt = buildVisualizePrompt({ context: CTX, userPrompt: 'use line chart', editingChart: true });
        const rulesAt = prompt.indexOf('HARD RULES:');
        const ctxAt = prompt.indexOf('--- Context');
        const instrAt = prompt.lastIndexOf('Instruction: use line chart');
        // Hard rules come after the context block, and the instruction is last of all.
        expect(ctxAt).toBeGreaterThan(0);
        expect(rulesAt).toBeGreaterThan(ctxAt);
        expect(instrAt).toBeGreaterThan(rulesAt);
    });

    it('appends the repair block after the base prompt on a repair attempt', () => {
        const prompt = buildVisualizePrompt({
            context: CTX,
            userPrompt: 'use line chart',
            editingChart: true,
            previousCandidate: '{ "mark": { "type": "line" } }',
            errors: ['The statement did not resolve into a visualization.'],
        });
        expect(prompt).toContain('did not pass verification');
        expect(prompt).toContain('The statement did not resolve into a visualization.');
        // The repair block trails the instruction.
        expect(prompt.indexOf('did not pass verification')).toBeGreaterThan(prompt.indexOf('Instruction:'));
    });
});

describe('diagnoseVegaLiteSpec — actionable hints for bad specs', () => {
    it('turns the "pie" mark into the arc + theta + color guidance', () => {
        const spec = '{"mark":"pie","encoding":{"x":{"field":"x","type":"nominal"},"y":{"field":"y","type":"nominal"}}}';
        const hints = diagnoseVegaLiteSpec(spec);
        expect(hints).toHaveLength(1);
        expect(hints[0]).toContain('no "pie" mark');
        expect(hints[0]).toContain('arc');
        expect(hints[0]).toContain('theta');
        expect(hints[0]).toContain('color');
    });

    it('recognizes an unsupported mark carried on a mark object', () => {
        const hints = diagnoseVegaLiteSpec('{"mark":{"type":"donut"}}');
        expect(hints).toHaveLength(1);
        expect(hints[0]).toContain('arc');
        expect(hints[0]).toContain('innerRadius');
    });

    it('is case-insensitive about the mark value', () => {
        expect(diagnoseVegaLiteSpec('{"mark":"PIE"}')[0]).toContain('arc');
    });

    it('falls back to the full supported-mark list for an unknown mark with no specific hint', () => {
        const hints = diagnoseVegaLiteSpec('{"mark":"sunburst"}');
        expect(hints).toHaveLength(1);
        expect(hints[0]).toContain('"sunburst" is not a supported mark');
        for (const mark of SUPPORTED_VEGA_MARKS) {
            expect(hints[0]).toContain(mark);
        }
    });

    it('maps other common non-marks (scatter, histogram, bubble, column) to real marks', () => {
        expect(diagnoseVegaLiteSpec('{"mark":"scatter"}')[0]).toContain('point');
        expect(diagnoseVegaLiteSpec('{"mark":"histogram"}')[0]).toContain('bar');
        expect(diagnoseVegaLiteSpec('{"mark":"bubble"}')[0]).toContain('size');
        expect(diagnoseVegaLiteSpec('{"mark":"column"}')[0]).toContain('bar');
    });

    it('returns no hints for a supported mark', () => {
        expect(diagnoseVegaLiteSpec('{"mark":"arc","encoding":{"theta":{"field":"y"}}}')).toEqual([]);
        expect(diagnoseVegaLiteSpec('{"mark":{"type":"bar"}}')).toEqual([]);
    });

    it('returns no hints when there is no mark or the JSON is malformed', () => {
        expect(diagnoseVegaLiteSpec('{"encoding":{}}')).toEqual([]);
        expect(diagnoseVegaLiteSpec('not json')).toEqual([]);
        expect(diagnoseVegaLiteSpec('')).toEqual([]);
    });
});

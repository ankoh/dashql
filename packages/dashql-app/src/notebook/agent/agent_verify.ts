import * as core from '../../core/index.js';

/// The result of verifying a candidate script against the parser + analyzer.
export interface VerifyResult {
    /// Did the script parse and analyze without errors?
    ok: boolean;
    /// Scanner + parser error messages (syntax level).
    parserErrors: string[];
    /// Analyzer error messages (semantic level).
    analyzerErrors: string[];
    /// The number of VisualizationSpecs the analyzer produced (proves a VISUALIZE
    /// statement transcoded into something the analyzer could resolve).
    visualizationSpecs: number;
}

/// All collected error messages, parser first then analyzer.
export function allVerifyErrors(result: VerifyResult): string[] {
    return [...result.parserErrors, ...result.analyzerErrors];
}

/// Verify a candidate script by parsing + analyzing it on an ephemeral scratch script.
///
/// The scratch script is created against the live connection `catalog`, so the analyzer
/// sees the real catalog tables and semantic checks (unresolved columns, etc.) are
/// meaningful. This is the agent loop's safety net: the driver feeds the returned error
/// messages back into the next repair prompt.
///
/// WASM heap discipline: the scratch script and its flatbuffers are created and destroyed
/// entirely within this function. They must never escape into React state or the reducer —
/// they would be use-after-free once destroyed here. We deliberately do NOT load the scratch
/// script into the catalog or registry (it is throwaway and must not become referenceable).
export function verifyScript(instance: core.DashQL, catalog: core.DashQLCatalog, text: string): VerifyResult {
    const parserErrors: string[] = [];
    const analyzerErrors: string[] = [];
    let visualizationSpecs = 0;

    const script = instance.createScript(catalog);
    let parsed: core.FlatBufferPtr<core.buffers.parser.ParsedScript> | null = null;
    let analyzed: core.FlatBufferPtr<core.buffers.analyzer.AnalyzedScript> | null = null;
    try {
        script.replaceText(text);
        script.analyze();

        parsed = script.getParsed();
        analyzed = script.getAnalyzed();
        const parsedReader = parsed.read();
        const analyzedReader = analyzed.read();

        for (let i = 0; i < parsedReader.scannerErrorsLength(); ++i) {
            const message = parsedReader.scannerErrors(i)?.message();
            if (message) parserErrors.push(message);
        }
        for (let i = 0; i < parsedReader.parserErrorsLength(); ++i) {
            const message = parsedReader.parserErrors(i)?.message();
            if (message) parserErrors.push(message);
        }
        for (let i = 0; i < analyzedReader.errorsLength(); ++i) {
            const message = analyzedReader.errors(i)?.message();
            if (message) analyzerErrors.push(message);
        }
        visualizationSpecs = analyzedReader.visualizationSpecsLength();
    } catch (e: any) {
        // analyze() throws on a hard WASM failure; surface it as a parser error so the
        // driver still has something to feed back / report.
        parserErrors.push(e?.message ? String(e.message) : String(e));
    } finally {
        parsed?.destroy();
        analyzed?.destroy();
        script.destroy();
    }

    return {
        ok: parserErrors.length === 0 && analyzerErrors.length === 0,
        parserErrors,
        analyzerErrors,
        visualizationSpecs,
    };
}

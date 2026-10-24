/// The modules that render Vega-Lite charts, loaded on first use to keep them out of the startup bundle.
export interface VegaModules {
    /// Embed a Vega-Lite spec into an element
    embed: typeof import('vega-embed').default;
    /// The Vega runtime, e.g. to build changesets
    vega: typeof import('vega-embed').vega;
    /// The expression interpreter, it avoids the `Function()` eval of Vega that CSP forbids
    expressionInterpreter: typeof import('vega-interpreter').expressionInterpreter;
}

let loading: Promise<VegaModules> | null = null;

/// Load the Vega modules once
export function loadVega(): Promise<VegaModules> {
    loading ??= Promise.all([import('vega-embed'), import('vega-interpreter')])
        .then(([embed, interpreter]) => ({
            embed: embed.default,
            vega: embed.vega,
            expressionInterpreter: interpreter.expressionInterpreter,
        }))
        .catch(error => {
            loading = null;
            throw error;
        });
    return loading;
}

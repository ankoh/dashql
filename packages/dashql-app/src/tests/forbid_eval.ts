/// Run code with `Function` throwing like under a Content-Security-Policy without 'unsafe-eval'.
/// The test frame has no such policy, the Arrow builders of a fixture would fail under it.
export async function forbidEval<T>(run: () => T | Promise<T>): Promise<T> {
    const evaluate = globalThis.Function;
    globalThis.Function = new Proxy(evaluate, {
        apply: () => { throw new EvalError('unsafe-eval'); },
        construct: () => { throw new EvalError('unsafe-eval'); },
    });
    try {
        return await run();
    } finally {
        globalThis.Function = evaluate;
    }
}

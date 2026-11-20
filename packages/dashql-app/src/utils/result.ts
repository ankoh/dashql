export const RESULT_OK = Symbol();
export const RESULT_ERROR = Symbol();

/// A value or the error of its computation, by default whatever was thrown
export type Result<ValueType, ErrorType = unknown> =
    | { type: typeof RESULT_OK; value: ValueType }
    | { type: typeof RESULT_ERROR; error: ErrorType };


export async function awaitAndSet<V>(v: Promise<V>, setResult: (result: Result<V>) => void) {
    try {
        const res = await v;
        setResult({
            type: RESULT_OK,
            value: res,
        })
    } catch (e) {
        setResult({
            type: RESULT_ERROR,
            error: e
        });
    }
}

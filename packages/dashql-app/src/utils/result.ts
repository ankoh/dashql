export const RESULT_OK = Symbol();
export const RESULT_ERROR = Symbol();

export type Result<ValueType> =
    | { type: typeof RESULT_OK; value: ValueType }
    | { type: typeof RESULT_ERROR; error: any };


export async function awaitAndSet<V>(v: Promise<V>, setResult: (result: Result<V>) => void) {
    try {
        const res = await v;
        setResult({
            type: RESULT_OK,
            value: res,
        })
    } catch (e: any) {
        setResult({
            type: RESULT_ERROR,
            error: e
        });
    }
}

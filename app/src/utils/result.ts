export type Result<T, E> = ResultOk<T> | ResultErr<E>;

interface ResultOk<T> {
    ok: true;
    value: T;
}

interface ResultErr<E> {
    ok: false;
    value: E;
}

export function Ok<T, E>(v: T): Result<T, E> {
    return {
        ok: true,
        value: v,
    };
}

export function Err<T, E>(v: E): Result<T, E> {
    return {
        ok: false,
        value: v,
    };
}

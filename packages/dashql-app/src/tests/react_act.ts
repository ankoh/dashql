import * as React from 'react';
import { flushSync } from 'react-dom';

function fallbackAct<T>(callback: () => T | Promise<T>): T | Promise<T> {
    let result!: T | Promise<T>;
    flushSync(() => {
        result = callback();
    });
    if (result && typeof (result as Promise<T>).then === 'function') {
        return Promise.resolve(result).then(resolved => {
            flushSync(() => {});
            return resolved;
        });
    }
    flushSync(() => {});
    return result;
}

export const act: typeof React.act = React.act ?? fallbackAct as typeof React.act;

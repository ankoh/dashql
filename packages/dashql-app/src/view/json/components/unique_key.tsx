import * as React from 'react';

let NEXT_ID = 1;

export function useUniqueKey() {
    const idRef = React.useRef<string | null>(null);
    if (idRef.current === null) {
        const id = NEXT_ID++;
        idRef.current = 'custom-id-' + id;
    }
    return idRef.current;
}

import * as React from 'react';
import type * as core from '@ankoh/dashql';

import { connectionParamsEqual, type ConnectionParams } from '@ankoh/dashql/platform/connections/connection_params';
import { useConnection, useDispatch } from '../runtime/runtime_hooks.js';

/// The params and the draft of a connection with the actions that edit the draft. Editing dispatches immediately, the
/// runtime debounces only the durable write of the app manifest.
export function useConnectionDraft(connectionId: string | null) {
    const connection = useConnection(connectionId);
    const dispatch = useDispatch(connectionId == null ? null : { connection: connectionId });
    const setDraft = React.useCallback((params: ConnectionParams) => {
        dispatch({ kind: 'setDraft', value: { params: params as unknown as core.JsonParams } });
    }, [dispatch]);
    const discard = React.useCallback(() => {
        dispatch({ kind: 'discardDraft' });
    }, [dispatch]);
    return { params: connection?.params ?? null, paramsDraft: connection?.paramsDraft ?? undefined, setDraft, discard };
}

/// The form of the settings of a connection over its draft. Forms write from user actions, never from hydration
/// effects (which could resurrect a draft).
export function useConnectionDraftForm<T>(
    connectionId: string | null,
    decode: (params: ConnectionParams | null) => T,
    encode: (form: T) => ConnectionParams,
): [T, React.Dispatch<React.SetStateAction<T>>] {
    const { params, paramsDraft, setDraft } = useConnectionDraft(connectionId);
    const source = paramsDraft ?? params;
    const [form, setForm] = React.useState(() => decode(source));
    const sourceRef = React.useRef(source);
    const formRef = React.useRef(form);
    const databaseIdRef = React.useRef(connectionId);
    const editedParamsRef = React.useRef<ConnectionParams | undefined>(undefined);
    if (databaseIdRef.current !== connectionId || sourceRef.current !== source) {
        const ownEdit = databaseIdRef.current === connectionId && paramsDraft != null
            && connectionParamsEqual(editedParamsRef.current, paramsDraft);
        databaseIdRef.current = connectionId;
        sourceRef.current = source;
        if (!ownEdit) {
            editedParamsRef.current = undefined;
            formRef.current = decode(source);
            setForm(formRef.current);
        }
    }
    const update = (value: React.SetStateAction<T>) => {
        const next = typeof value === 'function' ? (value as (prev: T) => T)(formRef.current) : value;
        formRef.current = next;
        setForm(next);
        const encoded = encode(next);
        editedParamsRef.current = encoded;
        setDraft(encoded);
    };
    return [formRef.current, update];
}

import * as React from 'react';
import { Resolvable, Resolver } from '../model';
import { Backend } from './backend';

export const BACKEND_RESOLVER_CONTEXT = React.createContext<Resolver<Backend> | null>(null);
export const BACKEND_CONTEXT = React.createContext<Resolvable<Backend, BackendInstantiationProgress> | null>(null);

export const useBackend = (): Resolvable<Backend, BackendInstantiationProgress> => React.useContext(BACKEND_CONTEXT)!;

export enum InstantiationStatus {
    WAITING,
    PREPARING,
    COMPILING,
    INSTANTIATING,
    CONFIGURING,
    READY,
    FAILED,
}

export interface BackendInstantiationProgress {
    db: [InstantiationStatus, any | null];
    parser: [InstantiationStatus, any | null];
    core: [InstantiationStatus, any | null];
}

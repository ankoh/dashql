import * as React from 'react';
import { Resolvable, Resolver } from '../model';
import { Backend } from './backend';

export const BACKEND_RESOLVER_CONTEXT = React.createContext<Resolver<Backend> | null>(null);
export const BACKEND_CONTEXT = React.createContext<Resolvable<Backend, BackendInstantiationProgress> | null>(null);

export const useBackend = (): Resolvable<Backend, BackendInstantiationProgress> => React.useContext(BACKEND_CONTEXT)!;
export const useBackendResolver = (): Resolver<Backend> => React.useContext(BACKEND_RESOLVER_CONTEXT)!;

export enum InstantiationStatus {
    WAITING,
    PREPARING,
    INSTANTIATING,
    CONFIGURING,
    READY,
    FAILED,
}

export type InstantiationError = any;

export interface BackendInstantiationProgress {
    db: [InstantiationStatus, InstantiationError | null];
    parser: [InstantiationStatus, InstantiationError | null];
    core: [InstantiationStatus, InstantiationError | null];
}
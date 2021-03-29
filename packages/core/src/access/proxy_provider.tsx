import * as duckdb from '@dashql/webdb/dist/webdb.module.js';
import * as React from 'react';
import * as proto from '@dashql/proto';

interface ProxyProviderProps {
    result: proto.duckdb.QueryResult;
    children: (rows: duckdb.RowProxy[], result: proto.duckdb.QueryResult) => React.ReactNode;
}

interface ProxyProviderState {
    result: proto.duckdb.QueryResult;
    rows: duckdb.RowProxy[];
}

export class ProxyProvider extends React.Component<ProxyProviderProps, ProxyProviderState> {
    constructor(props: ProxyProviderProps) {
        super(props);
        this.state = ProxyProvider.getDerivedStateFromProps(props);
    }

    public static getDerivedStateFromProps(nextProps: ProxyProviderProps, prevState?: ProxyProviderState) {
        if (prevState?.result == nextProps.result) {
            return prevState;
        }
        const chunks = new duckdb.StaticChunkIterator(nextProps.result);
        return {
            result: nextProps.result,
            rows: chunks.collectAllBlocking(),
        };
    }

    render() {
        return this.props.children(this.state.rows, this.state.result);
    }
}

export function withRowProxies(fn: (rows: duckdb.RowProxy[], result: proto.duckdb.QueryResult) => React.ReactNode) {
    return (result: proto.duckdb.QueryResult): React.ReactNode => (
        <ProxyProvider result={result}>
            {(rows: duckdb.RowProxy[], result: proto.duckdb.QueryResult) => fn(rows, result)}
        </ProxyProvider>
    );
}

interface ProxyPartitionsProviderProps {
    result: proto.duckdb.QueryResult;
    children: (rows: duckdb.RowProxy[][], result: proto.duckdb.QueryResult) => React.ReactNode;
}

interface ProxyPartitionsProviderState {
    result: proto.duckdb.QueryResult;
    partitions: duckdb.RowProxy[][];
}

export class ProxyPartitionsProvider extends React.Component<
    ProxyPartitionsProviderProps,
    ProxyPartitionsProviderState
> {
    constructor(props: ProxyPartitionsProviderProps) {
        super(props);
        this.state = ProxyPartitionsProvider.getDerivedStateFromProps(props);
    }

    public static getDerivedStateFromProps(
        nextProps: ProxyPartitionsProviderProps,
        prevState?: ProxyPartitionsProviderState,
    ) {
        if (prevState?.result == nextProps.result) {
            return prevState;
        }
        const chunks = new duckdb.StaticChunkIterator(nextProps.result);
        const partitions = chunks.collectPartitionsBlocking();
        return {
            result: nextProps.result,
            partitions: partitions,
        };
    }

    render() {
        return this.props.children(this.state.partitions, this.state.result);
    }
}

export function withRowProxyPartitions(
    fn: (partitions: duckdb.RowProxy[][], result: proto.duckdb.QueryResult) => React.ReactNode,
) {
    return (result: proto.duckdb.QueryResult): React.ReactNode => (
        <ProxyPartitionsProvider result={result}>
            {(partitions: duckdb.RowProxy[][], result: proto.duckdb.QueryResult) => fn(partitions, result)}
        </ProxyPartitionsProvider>
    );
}

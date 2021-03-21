import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as React from 'react';
import * as proto from '@dashql/proto';

interface ProxyProviderProps {
    result: proto.webdb.QueryResult;
    children: (rows: webdb.RowProxy[], result: proto.webdb.QueryResult) => React.ReactNode;
}

interface ProxyProviderState {
    result: proto.webdb.QueryResult;
    rows: webdb.RowProxy[];
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
        const chunks = new webdb.ChunkArrayIterator(nextProps.result);
        return {
            result: nextProps.result,
            rows: chunks.collectAllBlocking(),
        };
    }

    render() {
        return this.props.children(this.state.rows, this.state.result);
    }
}

export function withRowProxies(fn: (rows: webdb.RowProxy[], result: proto.webdb.QueryResult) => React.ReactNode) {
    return (result: proto.webdb.QueryResult): React.ReactNode => (
        <ProxyProvider result={result}>
            {(rows: webdb.RowProxy[], result: proto.webdb.QueryResult) => fn(rows, result)}
        </ProxyProvider>
    );
}

interface ProxyPartitionsProviderProps {
    result: proto.webdb.QueryResult;
    children: (rows: webdb.RowProxy[][], result: proto.webdb.QueryResult) => React.ReactNode;
}

interface ProxyPartitionsProviderState {
    result: proto.webdb.QueryResult;
    partitions: webdb.RowProxy[][];
}

export class ProxyPartitionsProvider extends React.Component<ProxyPartitionsProviderProps, ProxyPartitionsProviderState> {
    constructor(props: ProxyPartitionsProviderProps) {
        super(props);
        this.state = ProxyPartitionsProvider.getDerivedStateFromProps(props);
    }

    public static getDerivedStateFromProps(nextProps: ProxyPartitionsProviderProps, prevState?: ProxyPartitionsProviderState) {
        if (prevState?.result == nextProps.result) {
            return prevState;
        }
        const chunks = new webdb.ChunkArrayIterator(nextProps.result);
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
    fn: (partitions: webdb.RowProxy[][], result: proto.webdb.QueryResult) => React.ReactNode,
) {
    return (result: proto.webdb.QueryResult): React.ReactNode => (
        <ProxyPartitionsProvider result={result}>
            {(partitions: webdb.RowProxy[][], result: proto.webdb.QueryResult) => fn(partitions, result)}
        </ProxyPartitionsProvider>
    );
}
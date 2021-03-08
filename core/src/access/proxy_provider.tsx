import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as React from 'react';
import * as proto from '@dashql/proto';

interface ProxyProviderProps {
    result: proto.webdb.QueryResult;
    children: (result: proto.webdb.QueryResult, rows: webdb.RowProxy[]) => React.ReactNode;
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
        return this.props.children(this.state.result, this.state.rows);
    }
}

export function withRowProxies(fn: (result: proto.webdb.QueryResult, rows: webdb.RowProxy[]) => React.ReactNode) {
    return (result: proto.webdb.QueryResult): React.ReactNode => (
        <ProxyProvider result={result}>
            {(result: proto.webdb.QueryResult, rows: webdb.RowProxy[]) => fn(result, rows)}
        </ProxyProvider>
    );
}

interface ProxyPartitionsProviderProps {
    result: proto.webdb.QueryResult;
    children: (result: proto.webdb.QueryResult, rows: webdb.RowProxy[][]) => React.ReactNode;
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
        return {
            result: nextProps.result,
            partitions: chunks.collectPartitionsBlocking(),
        };
    }

    render() {
        return this.props.children(this.state.result, this.state.partitions);
    }
}

export function withRowProxyPartitions(
    fn: (result: proto.webdb.QueryResult, partitions: webdb.RowProxy[][]) => React.ReactNode,
) {
    return (result: proto.webdb.QueryResult): React.ReactNode => (
        <ProxyPartitionsProvider result={result}>
            {(result: proto.webdb.QueryResult, partitions: webdb.RowProxy[][]) => fn(result, partitions)}
        </ProxyPartitionsProvider>
    );
}
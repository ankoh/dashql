import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as React from 'react';
import * as proto from '@dashql/proto';

interface RowProviderProps {
    result: proto.webdb.QueryResult;
    children: (result: proto.webdb.QueryResult, rows: webdb.RowProxy[]) => React.ReactNode;
}

interface RowProviderState {
    result: proto.webdb.QueryResult;
    rows: webdb.RowProxy[];
}

class RowProvider extends React.Component<RowProviderProps, RowProviderState> {
    constructor(props: RowProviderProps) {
        super(props);
        this.state = RowProvider.getDerivedStateFromProps(props);
    }

    public static getDerivedStateFromProps(nextProps: RowProviderProps, prevState?: RowProviderState) {
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
        <RowProvider result={result}>
            {(result: proto.webdb.QueryResult, rows: webdb.RowProxy[]) => fn(result, rows)}
        </RowProvider>
    );
}

interface PartitionProviderProps {
    result: proto.webdb.QueryResult;
    children: (result: proto.webdb.QueryResult, rows: webdb.RowProxy[][]) => React.ReactNode;
}

interface PartitionProviderState {
    result: proto.webdb.QueryResult;
    partitions: webdb.RowProxy[][];
}

class PartitionProvider extends React.Component<PartitionProviderProps, PartitionProviderState> {
    constructor(props: PartitionProviderProps) {
        super(props);
        this.state = PartitionProvider.getDerivedStateFromProps(props);
    }

    public static getDerivedStateFromProps(nextProps: PartitionProviderProps, prevState?: PartitionProviderState) {
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
        <PartitionProvider result={result}>
            {(result: proto.webdb.QueryResult, partitions: webdb.RowProxy[][]) => fn(result, partitions)}
        </PartitionProvider>
    );
}
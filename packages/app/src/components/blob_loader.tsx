import * as React from 'react';

interface Props {
    loadingComponent: () => React.ReactElement;
    errorComponent: (error: string) => React.ReactElement;
    children: (buffer: ArrayBuffer) => React.ReactElement;
    blob: Blob;
}

enum BlobLoaderStatus {
    PENDING,
    IN_FLIGHT,
    FAILED,
    SUCCEEDED,
}

interface State {
    status: BlobLoaderStatus;
    error: any | null;
    buffer: ArrayBuffer | null;
}

class BlobLoader extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            status: BlobLoaderStatus.PENDING,
            error: false,
            buffer: null,
        };
    }

    async loadBlob(): Promise<void> {
        try {
            const buffer = await this.props.blob.arrayBuffer();
            this.setState({
                status: BlobLoaderStatus.SUCCEEDED,
                buffer,
            });
        } catch (e) {
            this.setState({
                status: BlobLoaderStatus.FAILED,
                error: e,
            });
        }
    }

    componentDidMount(): void {
        if (this.state.status != BlobLoaderStatus.PENDING) return;
        this.setState({
            status: BlobLoaderStatus.IN_FLIGHT,
        });
        this.loadBlob();
    }

    componentDidUpdate(prevProps: Props): void {
        if (this.props.blob == prevProps.blob) return;
        this.setState({
            status: BlobLoaderStatus.IN_FLIGHT,
        });
        this.loadBlob();
    }

    public render(): React.ReactElement {
        switch (this.state.status) {
            case BlobLoaderStatus.PENDING:
                return <div />;
            case BlobLoaderStatus.IN_FLIGHT:
                return this.props.loadingComponent();
            case BlobLoaderStatus.FAILED:
                return this.props.errorComponent(this.state.error);
            case BlobLoaderStatus.SUCCEEDED:
                return this.props.children(this.state.buffer!);
        }
    }
}

export default BlobLoader;

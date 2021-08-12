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

export const BlobLoader: React.FC<Props> = (props: Props) => {
    const [state, setState] = React.useState<State>({
        status: BlobLoaderStatus.PENDING,
        error: null,
        buffer: null,
    });

    const isMountedRef = React.useRef(true);
    React.useEffect(() => {
        return () => void (isMountedRef.current = false);
    }, []);

    React.useEffect(() => {
        if (state.status != BlobLoaderStatus.PENDING) return;
        setState({
            ...state,
            status: BlobLoaderStatus.IN_FLIGHT,
        });
        const loadBlob = async (): Promise<void> => {
            try {
                const buffer = await props.blob.arrayBuffer();
                if (!isMountedRef.current) return;
                setState({
                    status: BlobLoaderStatus.SUCCEEDED,
                    buffer,
                    error: null,
                });
            } catch (e) {
                console.error(e);
                if (!isMountedRef.current) return;
                setState({
                    status: BlobLoaderStatus.FAILED,
                    buffer: null,
                    error: e,
                });
            }
        };
        loadBlob();
    }, [state.status]);

    switch (state.status) {
        case BlobLoaderStatus.PENDING:
            return <div />;
        case BlobLoaderStatus.IN_FLIGHT:
            return props.loadingComponent();
        case BlobLoaderStatus.FAILED:
            return props.errorComponent(state.error);
        case BlobLoaderStatus.SUCCEEDED:
            return props.children(state.buffer!);
    }
};

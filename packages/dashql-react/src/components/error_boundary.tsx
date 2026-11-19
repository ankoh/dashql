import * as React from 'react';

interface Props {
    /// What to show instead of the children that failed to render
    fallback: (error: unknown) => React.ReactNode;
    onError?: (error: unknown, info: React.ErrorInfo) => void;
    children: React.ReactNode;
}

interface State {
    failure: { error: unknown } | null;
}

/// Show a fallback when the children fail to render. Without a boundary, React unmounts the whole page.
/// It catches errors of rendering and effects, not the ones of event handlers or promises.
/// Give it a new key to render the children again.
export class ErrorBoundary extends React.Component<Props, State> {
    state: State = { failure: null };

    static getDerivedStateFromError(error: unknown): State {
        return { failure: { error } };
    }

    componentDidCatch(error: unknown, info: React.ErrorInfo): void {
        this.props.onError?.(error, info);
    }

    render(): React.ReactNode {
        const { failure } = this.state;
        return failure != null ? this.props.fallback(failure.error) : this.props.children;
    }
}

import * as React from 'react';
import useResizeObserverRaw from '@react-hook/resize-observer';
const useResizeObserver = useResizeObserverRaw as unknown as typeof useResizeObserverRaw.default;

export interface ObservedSize {
    width: number;
    height: number;
}

export const OBSERVED_SIZE = React.createContext<ObservedSize | null>(null);
export const useObservedSize = () => React.useContext(OBSERVED_SIZE)!;

export const observeSize = (target: React.RefObject<HTMLElement | null>): ObservedSize | null => {
    const [size, setSize] = React.useState<ObservedSize | null>(null);
    React.useLayoutEffect(() => {
        setSize(target.current?.getBoundingClientRect() ?? null);
    }, [target.current]);
    useResizeObserver(target, (entry: ResizeObserverEntry) => {
        setSize(entry.contentRect);
    });
    return size;
};

interface ObserverProps {
    children: React.ReactElement;
    disableWidth?: boolean;
    disableHeight?: boolean;
}

export const SizeObserver: React.FC<ObserverProps> = (props: ObserverProps) => {
    const target = React.useRef(null);
    const size = observeSize(target);
    return (
        <div
            ref={target}
            style={{ width: props.disableWidth ? 'auto' : '100%', height: props.disableHeight ? 'auto' : '100%' }}
        >
            <OBSERVED_SIZE.Provider value={size}>{props.children}</OBSERVED_SIZE.Provider>
        </div>
    );
};

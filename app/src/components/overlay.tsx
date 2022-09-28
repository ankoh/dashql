import React from 'react';
import classNames from 'classnames';

import styles from './overlay.module.css';

type OverlayProviderProps = {
    className?: string;
    children?: React.ReactElement;
};
type OverlayState = {
    id: symbol;
    renderer: React.FC<OverlayContentProps>;
    onClose?: () => void;
};
type OverlayContainerProps = {
    id: symbol;
    className?: string;
    children?: React.ReactElement | React.ReactElement[];
};

type OverlayContentProps = {
    onClose?: () => void;
};
type OverlayStateSetter = (o: OverlayState | null) => void;

const overlaySetterCtx = React.createContext<OverlayStateSetter | null>(null);
const overlayCtx = React.createContext<OverlayState | null>(null);

export const OverlayProvider: React.FC<OverlayProviderProps> = (props: OverlayProviderProps) => {
    const [overlay, setOverlay] = React.useState<OverlayState>(null);
    return (
        <overlaySetterCtx.Provider value={setOverlay}>
            <overlayCtx.Provider value={overlay}>{props.children}</overlayCtx.Provider>
        </overlaySetterCtx.Provider>
    );
};
export const useOverlaySetter = (): OverlayStateSetter => React.useContext(overlaySetterCtx);
export const useOverlay = (): OverlayState => React.useContext(overlayCtx);

export const OverlayContainer: React.FC<OverlayContainerProps> = (props: OverlayContainerProps) => {
    const overlay = useOverlay();
    const setOverlay = useOverlaySetter();
    const renderedOverlay = React.useMemo(
        () =>
            setOverlay &&
            overlay &&
            overlay.id == props.id && (
                <div className={styles.overlay_container} onClick={() => setOverlay(null)}>
                    <overlay.renderer onClose={overlay.onClose} />
                </div>
            ),
        [setOverlay, overlay?.id],
    );
    if (!renderedOverlay && !props.children) return <div />;
    return (
        <div className={classNames(styles.overlay_root, props.className)}>
            {props.children}
            {renderedOverlay}
        </div>
    );
};

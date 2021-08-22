import React from 'react';
import classNames from 'classnames';

import styles from './page_overlay.module.css';

type Props = {
    className?: string;
    children: React.ReactChild;
};
type Overlay = {
    renderer: React.FC<OverlayProps>;
};

type OverlayProps = Record<string, string>;
type OverlaySetter = (o: Overlay | null) => void;

const overlaySetterCtx = React.createContext<OverlaySetter | null>(null);
const overlayCtx = React.createContext<Overlay | null>(null);

export const PageOverlayProvider: React.FC<Props> = (props: Props) => {
    const [overlay, setOverlay] = React.useState<Overlay>(null);
    return (
        <overlaySetterCtx.Provider value={setOverlay}>
            <overlayCtx.Provider value={overlay}>{props.children}</overlayCtx.Provider>
        </overlaySetterCtx.Provider>
    );
};
export const usePageOverlaySetter = (): OverlaySetter => React.useContext(overlaySetterCtx);
export const usePageOverlay = (): Overlay => React.useContext(overlayCtx);

export const PageOverlayRenderer: React.FC<Props> = (props: Props) => {
    const overlay = usePageOverlay();
    return (
        <div className={classNames(styles.overlay_root, props.className)}>
            {props.children}
            {overlay && (
                <div className={styles.overlay_container}>
                    <overlay.renderer />
                </div>
            )}
        </div>
    );
};

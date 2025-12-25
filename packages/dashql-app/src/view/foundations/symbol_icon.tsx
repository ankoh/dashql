import * as React from 'react';
import icons from '../../../static/svg/symbols.generated.svg';

import { Icon, IconProps } from '@primer/octicons-react';

function createIcon(sym: string): Icon {
    return (props: IconProps) => {
        let width: number = 16;
        let height: number = 16;
        if (typeof props.size == 'number') {
            width = props.size;
            height = props.size;
        } else {
            switch (props.size) {
                case 'small':
                    width = 16;
                    height = 16;
                    break;
                case 'medium':
                    width = 24;
                    height = 24;
                    break;
                case 'large':
                    width = 32;
                    height = 32;
                    break;
            }
        }
        return (
            <svg
                className={props.className}
                width={`${width}px`}
                height={`${height}px`}
            >
                <use xlinkHref={`${icons}#${sym}`} />
            </svg>
        );
    }
}

let SYMBOL_ICONS: Map<string, Icon> = new Map();

export function SymbolIcon(sym: string): Icon {
    const cached = SYMBOL_ICONS.get(sym);
    if (cached) {
        return cached;
    }
    const icon = createIcon(sym);
    SYMBOL_ICONS.set(sym, icon);
    return icon;
}

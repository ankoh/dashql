import * as React from 'react';
import * as styles from './toggle_switch.module.css';

import { classNames } from '../../utils/classnames.js';

interface ToggleSwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
    checked: boolean;
    size?: 'small' | 'medium';
}

export const ToggleSwitch = React.forwardRef<HTMLButtonElement, ToggleSwitchProps>((props: ToggleSwitchProps, ref) => {
    const { checked, className, disabled, size = 'medium', type, ...rest } = props;
    return (
        <button
            {...rest}
            ref={ref}
            type={type ?? 'button'}
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            className={classNames(styles.root, {
                [styles.checked]: checked,
                [styles.disabled]: disabled,
                [styles.small]: size === 'small',
                [styles.medium]: size === 'medium',
            }, className)}
        >
            <span className={styles.handle} />
        </button>
    );
});

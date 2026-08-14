import * as React from 'react';
import * as styles from './button_group.module.css';

import { classNames } from '../../utils/classnames.js';

interface ButtonGroupProps extends React.HTMLAttributes<HTMLDivElement> {
    className?: string;
    children?: React.ReactNode;
}

export const ButtonGroup = React.forwardRef<HTMLDivElement, ButtonGroupProps>((props: ButtonGroupProps, ref) => {
    const { className, children, ...rest } = props;
    return (
        <div
            {...rest}
            ref={ref}
            className={classNames(styles.root, className)}
            role={props.role ?? 'group'}
        >
            {React.Children.toArray(children).map((child, index) => (
                <div key={index} className={styles.item}>
                    {child}
                </div>
            ))}
        </div>
    );
});

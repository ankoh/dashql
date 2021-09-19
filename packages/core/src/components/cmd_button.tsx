import * as React from 'react';
import { Link } from 'react-router-dom';
import cn from 'classnames';
import styles_cmd from './cmd_bar.module.css';

type CommandProps = {
    className?: string;
    width: string;
    height: string;
    icon: string;
    disabled?: boolean;
    onClick?: () => void;
};

export const CommandButton: React.FC<CommandProps> = (props: CommandProps) => (
    <div
        className={cn(styles_cmd.cmdbar_cmd, props.className, {
            [styles_cmd.disabled]: props.disabled,
        })}
        onClick={props.onClick}
    >
        <svg width={props.width} height={props.height}>
            <use xlinkHref={`${props.icon}#sym`} />
        </svg>
    </div>
);

type LinkProps = {
    className?: string;
    width: string;
    height: string;
    icon: string;
    to: string;
};

export const LinkCommandButton: React.FC<LinkProps> = (props: LinkProps) => (
    <Link className={cn(styles_cmd.cmdbar_cmd, props.className)} to={props.to}>
        <svg width={props.width} height={props.height}>
            <use xlinkHref={`${props.icon}#sym`} />
        </svg>
    </Link>
);

import * as React from 'react';
import cn from 'classnames';
import { Script, getScriptName, getScriptNamespace, getScriptBeans } from '../model';

import logo from '../../static/svg/logo/logo.svg';

import styles from './program_header.module.css';

interface Props {
    className?: string;
    script: Script;
}

export const ProgramHeader: React.FC<Props> = (props: Props) => (
    <div className={cn(styles.container, props.className)}>
        <div className={styles.avatar}>
            <div className={styles.avatar_icon}>
                <svg width="24px" height="24px">
                    <use xlinkHref={`${logo}#sym`} />
                </svg>
            </div>
        </div>
        <div className={styles.title}>
            <span className={styles.title_namespace}>{getScriptNamespace(props.script)}</span>/
            <span className={styles.title_name}>{getScriptName(props.script)}</span>
        </div>
        <div className={styles.description}>{props.script.description}</div>
        <div className={styles.beans}>
            {getScriptBeans(props.script).map(b => (
                <div key={b} className={styles.bean}>
                    {b}
                </div>
            ))}
        </div>
    </div>
);

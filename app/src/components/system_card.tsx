import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import { proto } from '@dashql/core';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';
import { ActionStatusIndicator } from './status';
import { ChevronRightIcon, CloseIcon } from '../svg/icons';
import styles from './system_card.module.css';
import classNames from 'classNames';

interface Props {
    className?: string;
    children?: React.ReactNode;
    title: string;
    subtitle: string;
    onClose?: () => void;
}

export class SystemCard extends React.Component<Props> {
    public render() {
        return (
            <div className={classNames(styles.panel, this.props.className)}>
                <div className={styles.header}>
                    <div className={styles.header_title}>{this.props.title}</div>
                    <div className={styles.header_subtitle}>{this.props.subtitle}</div>
                    <div className={styles.close} onClick={this.props.onClose}>
                        <CloseIcon width="20px" height="20px" />
                    </div>
                </div>
                {this.props.children}
            </div>
        );
    }
}

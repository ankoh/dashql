import * as React from 'react';
import { connect } from 'react-redux';
import * as proto from '@tigon/proto';
import { Dispatch, setTQLHighlight } from '../../store';
import { withAppContext, IAppContext } from '../../app_context';

import styles from './section_entry.module.scss';

type Props = {
    appContext: IAppContext;
    dispatch: Dispatch;
} & {
    name?: proto.tql.String;
    entryLocation?: proto.tql.Location;
    nameLocation?: proto.tql.Location;
    description: string;
};

class SectionEntry extends React.Component<Props> {
    handleMouseOverEntry = (event: React.MouseEvent) => {
        event.stopPropagation();
        this.props.dispatch(setTQLHighlight(this.props.entryLocation ?? null));
    };

    handleMouseLeaveEntry = (event: React.MouseEvent) => {
        event.stopPropagation();
        this.props.dispatch(setTQLHighlight(null));
    };

    handleMouseOverName = (event: React.MouseEvent) => {
        event.stopPropagation();
        this.props.dispatch(setTQLHighlight(this.props.nameLocation ?? null));
    };

    handleMouseLeaveName = (event: React.MouseEvent) => {
        event.stopPropagation();
        this.props.dispatch(setTQLHighlight(null));
    };

    handleDelete = (event: React.MouseEvent) => {
        if (this.props.entryLocation) {
            this.props.appContext.controller.editor.replace(
                this.props.entryLocation,
                null,
            );
        }
    };

    render() {
        return (
            <div
                className={styles.entry}
                onMouseOver={this.handleMouseOverEntry}
                onMouseLeave={this.handleMouseLeaveEntry}
            >
                <span
                    onMouseOver={this.handleMouseOverName}
                    onMouseLeave={this.handleMouseLeaveName}
                >
                    {this.props.name?.getString() ?? '(Unnamed)'}
                </span>
                <span
                    className={styles.entry_delete}
                    onClick={this.handleDelete}
                >
                    ✕
                </span>
            </div>
        );
    }
}

export default connect()(withAppContext(SectionEntry));

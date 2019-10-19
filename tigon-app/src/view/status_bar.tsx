import './status_bar.scss';
import * as React from 'react';
import * as Model from '../model';
import { connect } from 'react-redux';
import { RectangleWaveSpinner } from './spinners';

interface IStatusBarProps {
    logWarnings: number;
}

interface IStatusBarState {
    spinnerActive: boolean;
    listVisible: boolean;
}

export class StatusBar extends React.Component<IStatusBarProps, IStatusBarState> {
    constructor(props: IStatusBarProps) {
        super(props);
        this.state = {
            listVisible: false,
            spinnerActive: true,
        };
    }

    /// Render a single list entry
    public renderListEntry(label: String, value: number, unit: String | null = null) {
        return (
            <div className="statusbar_list_entry">
                <span className="statusbar_list_entry_label">{label}</span>
                <span className="statusbar_list_entry_value">{value}</span>
                {
                    unit &&
                    <span className="statusbar_list_entry_unit">{unit}</span>
                }
            </div>
        );
    }

    /// Render list
    public renderList() {
        return (
            <div className="statusbar_list">
                {this.renderListEntry("tasks", 0)}
                {this.renderListEntry("tables", 0)}
                {this.renderListEntry("cached", 0, "B")}
                {this.renderListEntry("warnings", 0)}
            </div>
        );
    }

    /// Render spinner
    public renderSpinner() {
        return (
            <div className="statusbar_spinner" onClick={this.toggleList.bind(this)}>
                <RectangleWaveSpinner active={this.state.spinnerActive} />
            </div>
        );
    }

    /// Render the status bar
    public render() {
        return (
            <div className="statusbar">
                {this.state.listVisible && this.renderList()}
                {this.renderSpinner()}
            </div>
        );
    }

    protected toggleList() {
        this.setState((s) => ({ ...s, listVisible: !s.listVisible }));
    }
}

// Map state to props
function mapStateToProps(state: Model.RootState) {
    return {
        logWarnings: state.logWarnings,
    };
}
// Map llvm explorer dispatchs
function mapDispatchToProps(dispatch: Model.RootState) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(StatusBar);

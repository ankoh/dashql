import * as React from 'react';
import * as Model from '../model';
import { connect } from 'react-redux';

import 'xterm/dist/xterm.css';
import './terminal.css';

import { IAppContext, withAppContext } from '../app_context';

// The terminal props
interface ITerminalProps {
    appContext: IAppContext;
}

// A terminal
class Terminal extends React.Component<ITerminalProps> {
    protected termContainer: React.RefObject<HTMLDivElement>;
    protected input: string;

    // Constructor
    constructor(props: ITerminalProps) {
        super(props);

        this.termContainer = React.createRef();
        this.input = "";
    }

    // Render the terminal
    public render() {
        return (
            <div className="Terminal">
                <div ref={this.termContainer} className="Terminal-Container">
                </div>
            </div>
        );
    }

    // Component did mount to the dom
    public componentDidMount() {
        if (this.termContainer.current != null) {
            let ctrl = this.props.appContext.ctrl;
            ctrl.terminal.open(this.termContainer.current);
            ctrl.terminal.attach();
            ctrl.terminal.focus();
        }
    }

    // Component did update
    public componentDidUpdate() {
    }

    // Component will unmount from the dom
    public componentWillUnmount() {
        let ctrl = this.props.appContext.ctrl;
        ctrl.terminal.detach();
    }
}

function mapStateToProps(state: Model.RootState) {
    return {
    };
}
function mapDispatchToProps(dispatch: Model.Dispatch) {
    return {
    };
}

export default withAppContext(connect(mapStateToProps, mapDispatchToProps)(Terminal));


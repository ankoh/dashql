import * as React from 'react';
import * as Store from '../store';
import * as xterm from 'xterm';
import { connect } from 'react-redux';

import 'xterm/dist/xterm.css';
import './Terminal.css';

interface ITerminalProps {
}

class Terminal extends React.Component<ITerminalProps> {
    protected xtermContainer: React.RefObject<HTMLDivElement>;
    protected xtermTerminal: xterm.Terminal;

    constructor(props: ITerminalProps) {
        super(props);
        this.xtermContainer = React.createRef();
        this.xtermTerminal = new xterm.Terminal();
    }

    public render() {
        return (
            <div className="Terminal">
                <div ref={this.xtermContainer} className="Terminal-XTerm">
                </div>
            </div>
        );
    }

    public componentDidMount() {
        if (this.xtermContainer.current != null) {
            this.xtermTerminal.open(this.xtermContainer.current);
        }
    }

    public componentDidUpdate() {
    }

    public componentWillUnmount() {
        this.xtermTerminal.dispose();
    }
}

function mapStateToProps(state: Store.RootState) {
    return {
    };
}
function mapDispatchToProps(dispatch: Store.Dispatch) {
    return {
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(Terminal);


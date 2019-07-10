import * as React from 'react';
import * as Store from '../store';
import * as xterm from 'xterm';
import * as fit from 'xterm/lib/addons/fit/fit';
import { connect } from 'react-redux';

import 'xterm/dist/xterm.css';
import './Terminal.css';

xterm.Terminal.applyAddon(fit);

interface ITerminalProps {
}

// --------------------------------------------------------------
// WASM HACK BEGIN
// --------------------------------------------------------------

declare global {
    interface Window {
        Module: any;
    }
}

function loadScript(url: string, callback: any){
    let script = document.createElement("script")
    script.type = "text/javascript";
    script.onload = function(){
        callback();
    };
    script.src = url;
    document.getElementsByTagName("head")[0].appendChild(script);
}

// --------------------------------------------------------------
// WASM HACK END
// --------------------------------------------------------------

class Terminal extends React.Component<ITerminalProps> {
    protected termContainer: React.RefObject<HTMLDivElement>;
    protected term: xterm.Terminal;
    protected buffer: String;

    constructor(props: ITerminalProps) {
        super(props);

        this.termContainer = React.createRef();
        this.term = new xterm.Terminal();
        this.buffer = "";
    }

    public render() {
        return (
            <div className="Terminal">
                <div ref={this.termContainer} className="Terminal-Container">
                </div>
            </div>
        );
    }

    public componentDidMount() {
        if (this.termContainer.current != null) {
            this.term.open(this.termContainer.current);
            fit.fit(this.term);

            this.term.focus();
            this.term.on('key', (key, ev) => {
                if (key.charCodeAt(0) === 13) {
                    this.buffer += '\n';
                    this.term.write('\n');
                }
                this.buffer += key;
                this.term.write(key);

                if (key.charCodeAt(0) === 59) {
                    this.term.write('\n');
                    let run_query = window.Module.cwrap('run_query', 'void', ['string']);
                    run_query(this.buffer.toString());
                    this.buffer = '';
                }
            });


            this.term.setOption('theme', {
                background: 'rgb(0, 0, 0)',
                foreground: 'rgb(255, 255, 255)',
                cursor: 'rgb(255, 255, 255)'
            });

            let term = this.term;
            window.Module = {
                print: (function() {
                    return function(text: any) {
                        term.writeln(text);
                    };
                })(),
                printErr: function(text: any) {
                    if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ');
                    if (0) {
                        term.writeln(text);
                    }
                },				
                canvas: (function() {
                    return null;
                })()
            };

            loadScript("core/tigon.js", () => {
                console.log("script loaded");
            });
        }
    }

    public componentDidUpdate() {
    }

    public componentWillUnmount() {
        this.term.dispose();
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


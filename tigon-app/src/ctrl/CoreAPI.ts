// Mute typescript
declare global {
    var TigonCore: any;
}


export class CoreAPI {
    // The webassembly module
    protected coreModule: any;

    // Init the core api
    public init() {
        this.coreModule = TigonCore({
            print: (function() {
                return function(text: any) {
                    console.log("[wasm] print");
                    console.log(text);
                };
            })(),
            printErr: function(text: any) {
                if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ');
                if (0) {
                    console.log("[wasm] printErr");
                    console.log(text);
                }
            },
        });
    }

    // Run a query
    public runQuery(text: string) {
        this.coreModule.ccall('run_query', 'void', ['string'], [text]);
    }
};

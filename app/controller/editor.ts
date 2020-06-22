import * as Store from '../store';
import { CoreController } from './core';

export class EditorController {
    protected store: Store.ReduxStore;
    protected core: CoreController;

    constructor(store: Store.ReduxStore, core: CoreController) {
        this.store = store;
        this.core = core;
    }

    public async evaluate(input: string) {
        await this.core.waitUntilReady();

        const session = await this.core.createSession();

        const tql = await this.core.parseTQL(session, input);

        this.store.dispatch(Store.setTQLModule(tql));
    }
}

export default EditorController;

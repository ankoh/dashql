import { CoreController } from './core_ctrl';

declare global {
    var TigonWeb: any;
}

global.TigonWeb = require('../../public/lib/tigon_web');

describe("controller/core", () => {
    test("init succeeds", () => {
        let core = new CoreController();
        core.init();
    });
});

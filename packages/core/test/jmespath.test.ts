import { jmespath } from '../src';
import { JMESPath } from '../src/index_browser';

let jp: jmespath.JMESPathBindings;

beforeAll(async () => {
    jp = new JMESPath('/static/jmespath_wasm.wasm');
    await jp.init();
});

beforeEach(async () => {});

describe('JMESPath', () => {
    it('Example', () => {
        const result = jp.evaluate(
            `locations[?state == 'WA'].name | sort(@) | {WashingtonCities: join(', ', @)}`,
            `{
            "locations": [
                {"name": "Seattle", "state": "WA"},
                {"name": "New York", "state": "NY"},
                {"name": "Bellevue", "state": "WA"},
                {"name": "Olympia", "state": "WA"}
            ]
        }`,
        );
        expect(result).toEqual(`{"WashingtonCities":"Bellevue, Olympia, Seattle"}`);
    });
});

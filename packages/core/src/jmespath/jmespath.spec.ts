import * as jmespath from './jmespath_node';
import * as test from '../test';

describe('JMESPath', () => {
    let jp: jmespath.JMESPath | null = null;

    beforeAll(async () => {
        jp = test.JMESPATH;
    });

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

import * as jmespath from '../src/jmespath';

export function testJMESPath(jp: () => jmespath.JMESPathBindings): void {
    describe('JMESPath', () => {
        it('Example', () => {
            const result = jp().evaluate(
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
}

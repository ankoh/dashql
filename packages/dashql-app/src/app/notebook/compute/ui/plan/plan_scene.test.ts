import { truncatePlanLabel } from './plan_scene.js';

describe('truncatePlanLabel', () => {
    it('preserves labels that fit', () => {
        expect(truncatePlanLabel('orders', 6)).toEqual('orders');
    });

    it('uses the same character budget for the ellipsis', () => {
        expect(truncatePlanLabel('customer_orders', 8)).toEqual('custome…');
    });

    it('counts unicode code points instead of UTF-16 units', () => {
        expect(truncatePlanLabel('a😀bc', 3)).toEqual('a😀…');
    });

    it('renders no text when the budget is zero', () => {
        expect(truncatePlanLabel('orders', 0)).toEqual('');
    });
});

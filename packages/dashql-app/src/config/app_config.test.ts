describe('App config', () => {
    it('can be parsed', async () => {
        const response = await fetch('/static/config.json');
        expect(response.ok).toBe(true);
        await expect(response.json()).resolves.toBeTypeOf('object');
    });
});

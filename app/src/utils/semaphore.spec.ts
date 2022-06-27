import * as utils from './semaphore';
import Mutex = utils.Mutex;

describe('Semaphore', () => {
    it('simple ops', async () => {
        const mtx1 = new Mutex();
        const mtx2 = new Mutex();
        const mtx3 = new Mutex();
        const release1 = await mtx1.acquire();
        let release2 = await mtx2.acquire();

        let counter = 0;
        const promise1 = mtx3.useAsync(async () => {
            release1();
            await mtx2.use(() => {
                ++counter;
            });
        });
        const promise2 = mtx3.use(async () => {
            await mtx2.use(() => {
                ++counter;
            });
        });

        (await mtx1.acquire())();
        expect(counter).toEqual(0);
        release2();
        release2 = await mtx2.acquire();
        await promise1;
        expect(counter).toEqual(1);
        release2();
        await promise2;
        expect(counter).toEqual(2);
    });
});

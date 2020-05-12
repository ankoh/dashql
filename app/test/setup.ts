import * as crypto from 'crypto';

(global as any).crypto = {
    ...crypto,
    getRandomValues: (buffer: any) => {
        return crypto.randomBytes(buffer.length);
    },
};

const handler: ProxyHandler<object> = {
    get: (_target, key) => {
        if (key === '__esModule') {
            return true;
        }
        if (key === 'default') {
            return proxy;
        }
        if (typeof key === 'symbol') {
            return undefined;
        }
        return key;
    },
};
const proxy = new Proxy({}, handler);
export default proxy;

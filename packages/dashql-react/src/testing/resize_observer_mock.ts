/// A ResizeObserver whose callbacks the tests trigger: `triggerAll` reports every observed element, the browsers would
/// report sizes only after a layout
export class ResizeObserverMock {
    static instances: ResizeObserverMock[] = [];
    private callback: ResizeObserverCallback;
    private elements = new Set<Element>();

    constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        ResizeObserverMock.instances.push(this);
    }

    observe(element: Element) { this.elements.add(element); }
    disconnect() { }
    unobserve(element: Element) { this.elements.delete(element); }

    trigger() {
        this.callback(Array.from(this.elements, target => ({ target }) as ResizeObserverEntry), this as unknown as ResizeObserver);
    }

    static reset() { ResizeObserverMock.instances = []; }

    static triggerAll() { ResizeObserverMock.instances.forEach(instance => instance.trigger()); }
}

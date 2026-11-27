/// The source of a script that lets the memory of the engine fall back to a smaller maximum, the worker of the engine
/// runs it before the engine.
///
/// The engine asks for a shared WebAssembly.Memory of 256 MiB that may grow to 4 GiB. WebKit charges the maximum of a
/// shared memory against the address space of its process when the memory is constructed, not the pages in use. A
/// reload of the page asks for another 4 GiB while Safari of iOS still holds those of the last page, and the memory
/// fails with a RangeError "Out of memory". The constructor halves the maximum until a memory fits, the engine then
/// starts with less room to grow instead of not at all. A smaller maximum still matches the import of the module.
///
/// It is source text and not a function of this module, the coverage build would instrument a function with counters
/// that the worker doesn't have.
export const HYPERDB_MEMORY_FALLBACK_SOURCE = `(() => {
    const Memory = WebAssembly.Memory;
    function MemoryWithFallback(descriptor) {
        let maximum = descriptor.maximum;
        for (;;) {
            try {
                return new Memory(Object.assign({}, descriptor, { maximum }));
            } catch (error) {
                if (!(error instanceof RangeError) || maximum == null) throw error;
                const next = Math.floor(maximum / 2);
                if (next < descriptor.initial) throw error;
                maximum = next;
            }
        }
    }
    MemoryWithFallback.prototype = Memory.prototype;
    WebAssembly.Memory = MemoryWithFallback;
})();`;

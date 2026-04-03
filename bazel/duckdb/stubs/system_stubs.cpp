// Stub implementations for system functions not available in WASM

extern "C" {

// CPU affinity - not meaningful in WASM
int sched_getcpu() {
    return 0;
}

}

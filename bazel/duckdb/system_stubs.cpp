// Stub implementations for system functions not available in WASM

extern "C" {

// CPU affinity - not meaningful in WASM
int sched_getcpu() {
    return 0;
}

// Semaphore with timeout - not available in WASM
int sem_timedwait(void* sem, const void* abs_timeout) {
    return -1; // Always fail
}

}

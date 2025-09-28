import webpack from 'webpack';

interface MemoryMonitorOptions {
    interval: number;
    threshold: number;
    logMemory: boolean;
}

export class MemoryMonitorPlugin {
    private options: MemoryMonitorOptions;
    private intervalId: NodeJS.Timeout | null;

    constructor(options = {}) {
        this.options = {
            interval: 10000, // Check every 10 seconds
            threshold: 2 * 1024 * 1024 * 1024,  // Trigger GC at 2 GB
            logMemory: true,
            ...options
        };
        this.intervalId = null;
    }

    apply(compiler: webpack.Compiler) {
        compiler.hooks.watchRun.tap('MemoryMonitorPlugin', () => {
            if (!this.intervalId) {
                this.intervalId = setInterval(() => {
                    const memUsage = process.memoryUsage();
                    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
                    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
                    const heapThresholdMB = Math.round(this.options.threshold / 1024 / 1024);

                    if (this.options.logMemory) {
                        console.log(`[Memory Monitor] used=${heapUsedMB}MB total=${heapTotalMB}MB threshold=${heapThresholdMB}MB`);
                    }

                    // Force garbage collection if memory usage is high
                    if (memUsage.heapUsed > this.options.threshold && global.gc) {
                        console.log(`[Memory Monitor] Heap above threshold, forcing GC...`);
                        global.gc();

                        // Log memory after GC
                        const afterGC = process.memoryUsage();
                        const afterHeapMB = Math.round(afterGC.heapUsed / 1024 / 1024);
                        console.log(`[Memory Monitor] After GC: ${afterHeapMB}MB`);
                    }
                }, this.options.interval);
            }
        });

        compiler.hooks.watchClose.tap('MemoryMonitorPlugin', () => {
            if (this.intervalId) {
                clearInterval(this.intervalId);
                this.intervalId = null;
            }
        });
    }
}

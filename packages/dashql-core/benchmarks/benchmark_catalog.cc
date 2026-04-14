#include "benchmark/benchmark.h"
#include "dashql/catalog.h"

using namespace dashql;

// Schema descriptor benchmarks removed - functionality deprecated

int main(int argc, char** argv) {
    benchmark::Initialize(&argc, argv);
    benchmark::SetDefaultTimeUnit(benchmark::TimeUnit::kMillisecond);
    benchmark::RunSpecifiedBenchmarks();
}

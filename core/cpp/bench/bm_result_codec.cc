// Copyright (c) 2020 The DashQL Authors

#include "benchmark/benchmark.h"

namespace {

void BenchmarkTest(benchmark::State& state) {
    std::string x = "hello";
    for (auto _ : state)
        std::string copy(x);
}

}  // namespace

BENCHMARK(BenchmarkTest)->RangeMultiplier(2)->Range(1024, 1u << 14u);

BENCHMARK_MAIN();


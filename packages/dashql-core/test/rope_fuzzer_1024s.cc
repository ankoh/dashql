#include "dashql/testing/rope_fuzzer_common.h"

INSTANTIATE_TEST_SUITE_P(RopeFuzzerTest1024S, RopeFuzzerTestSuite,
                         ::testing::ValuesIn(generateTestSeries(1024, 1024, 16, 100)), RopeFuzzerTestPrinter());

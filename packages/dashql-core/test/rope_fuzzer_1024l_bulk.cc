#include "dashql/testing/rope_fuzzer_common.h"

INSTANTIATE_TEST_SUITE_P(RopeFuzzerTest1024LBulk, RopeFuzzerTestSuite,
                         ::testing::ValuesIn(generateTestSeries(1024, 128, 2048, 100, true)), RopeFuzzerTestPrinter());

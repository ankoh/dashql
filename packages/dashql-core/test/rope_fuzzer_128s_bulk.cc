#include "dashql/testing/rope_fuzzer_common.h"

INSTANTIATE_TEST_SUITE_P(RopeFuzzerTest128SBulk, RopeFuzzerTestSuite,
                         ::testing::ValuesIn(generateTestSeries(128, 1024, 16, 100, true)), RopeFuzzerTestPrinter());

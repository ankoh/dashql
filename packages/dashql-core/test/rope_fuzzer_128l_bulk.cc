#include "dashql/testing/rope_fuzzer_common.h"

INSTANTIATE_TEST_SUITE_P(RopeFuzzerTest128LBulk, RopeFuzzerTestSuite,
                         ::testing::ValuesIn(generateTestSeries(128, 128, 256, 100, true)), RopeFuzzerTestPrinter());

// Copyright (c) 2020 The DashQL Authors

#include "dashql/extract/csv_sniffer.h"

#include <sstream>

#include "dashql/common/blob_stream.h"
#include "dashql/extract/csv_sniffer.h"
#include "dashql/test/blob_stream_tests.h"
#include "gtest/gtest.h"

using namespace std;
using namespace dashql;
namespace sx = dashql::proto::syntax;

namespace {

class CSVSnifferProxy : public CSVSniffer {
   public:
    /// Constructor
    CSVSnifferProxy(const CSVParserOptions& user_options, CachingBlobStreamBuffer&& streambuf)
        : CSVSniffer(user_options, move(streambuf)) {}

    using CSVSniffer::DetectDialect;
    using CSVSniffer::DetectTypes;
};

struct DetectionTest {
    std::string test;
    std::string input;
    std::vector<CSVSniffer::Dialect> candidates;
    friend std::ostream& operator<<(std::ostream& out, const DetectionTest& param) {
        out << param.test;
        return out;
    }
};
class CSVDialectDetectionTestSuite : public ::testing::TestWithParam<DetectionTest> {};

TEST_P(CSVDialectDetectionTestSuite, CandidatesMatch) {
    auto& param = GetParam();
    auto blob_id = test::Blob::Register(test::Blob{param.input});
    CachingBlobStreamBuffer blob_streambuf(test::Blob::StreamUnderflow, blob_id);
    std::istream blob_stream{&blob_streambuf};

    CSVParserOptions presets;
    CSVSnifferProxy sniffer{presets, move(blob_streambuf)};
    auto rc = sniffer.DetectDialect();
    EXPECT_TRUE(rc.IsOk());

    auto& candidates = rc.value();
    EXPECT_EQ(candidates.size(), param.candidates.size());
    for (unsigned i = 0; i < param.candidates.size(); ++i) {
        auto& have = candidates[i];
        auto& want = param.candidates[i];
        EXPECT_EQ(have.delimiter, want.delimiter);
        EXPECT_EQ(have.escape, want.escape);
        EXPECT_EQ(have.quote, want.quote);
    }
}

// clang-format off
INSTANTIATE_TEST_SUITE_P(CSVSniffer, CSVDialectDetectionTestSuite, ::testing::Values(
    DetectionTest{"test1", "1,2,3\n4,5,6\n7,8,9", {{"\"", ",", "\\"}}})
);
// clang-format on

}  // namespace

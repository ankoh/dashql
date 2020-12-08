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

    using CSVSniffer::DetectTypes;
};

struct DetectionTest {
    std::string input;
    std::vector<CSVSniffer::Dialect> candidates;
    friend std::ostream& operator<<(std::ostream& out, const DetectionTest& param) {
        out << param.input;
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
    sniffer.DetectTypes();
}

INSTANTIATE_TEST_SUITE_P(CSVSniffer, CSVDialectDetectionTestSuite,
                         ::testing::Values(DetectionTest{"1,2,3\n4,5,6\n7,8,9", {{"", ",", ""}}}));

}  // namespace

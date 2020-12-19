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
    presets.delimiter = std::nullopt;
    presets.escape = std::nullopt;
    presets.quote = std::nullopt;
    CSVSnifferProxy sniffer{presets, move(blob_streambuf)};
    auto rc = sniffer.DetectDialect();
    EXPECT_TRUE(rc.IsOk());

    auto& candidates = rc.value();
    ASSERT_EQ(candidates.size(), param.candidates.size());
    for (unsigned i = 0; i < param.candidates.size(); ++i) {
        auto& have = candidates[i];
        auto& want = param.candidates[i];
        EXPECT_EQ(have.delimiter, want.delimiter) << "i=" << i;
        EXPECT_EQ(have.escape, want.escape) << "i=" << i;
        EXPECT_EQ(have.quote, want.quote) << "i=" << i;
    }
}

// clang-format off
INSTANTIATE_TEST_SUITE_P(CSVSniffer, CSVDialectDetectionTestSuite, ::testing::Values(
    // Separators
    DetectionTest{"1,2,3\n4,5,6\n7,8,9", {
        {"\"", ",", ""},
        {"\'", ",", "\\"},
        {"", ",", ""},
    }},
    DetectionTest{"1|2|3\n4|5|6\n7|8|9", {
        {"\"", "|", ""},
        {"\'", "|", "\\"},
        {"", "|", ""},
    }},
    DetectionTest{"1;2;3\n4;5;6\n7;8;9", {
        {"\"", ";", ""},
        {"\'", ";", "\\"},
        {"", ";", ""},
    }},
    DetectionTest{"1\t2\t3\n4\t5\t6\n7\t8\t9", {
        {"\"", "\t", ""},
        {"\'", "\t", "\\"},
        {"", "\t", ""},
    }},

    // Ambiguous quotes
    DetectionTest{R"CSV("1","2","3"
"4","5","6"
"7","8","9")CSV", {
        {"\"", ",", ""},
        {"\'", ",", "\\"},
        {"", ",", ""},
    }},
    DetectionTest{"'1','2','3'\n'4','5','6'\n'7','8','9'", {
        {"\"", ",", ""},
        {"\'", ",", "\\"},
        {"", ",", ""},
    }},

    // Identifying quotes
    DetectionTest{"'1,1','2','3'\n'4','5','6'\n'7','8','9'", {
        {"\'", ",", "\\"},
    }}
));
// clang-format on

}  // namespace

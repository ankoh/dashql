#include "dashql/extract/csv_sniffer.h"
#include <vector>

using namespace duckdb;

namespace dashql {

/// Constructor
CSVSniffer::CSVSniffer(const CSVParserOptions& user_options, CachingBlobStreamBuffer&& streambuf)
    : user_options(user_options), detected_options(user_options), blob_streambuf(move(streambuf)) {}

/// Test a dialect
CSVSniffer::DialectScore CSVSniffer::TryDialect(CSVParserOptions& options) {
    size_t sample_limit = 10 * 1024;

    auto get_score = [](const CSVParser& parser) {
        DialectScore score;
        auto& column_counts = parser.GetColumnCounts();
        for (idx_t row = 0; row < column_counts.size(); row++) {
            if (column_counts[row] == score.column_count) {
                score.consistent_rows++;
            } else {
                score.column_count = column_counts[row];
                score.consistent_rows = 1;
                score.first_consistent_row = row;
            }
        }
        return score;
    };

    // Parse the input with the given dialect
    options.mode = CSVParserMode::SNIFFING_DIALECT;
    blob_streambuf.Rewind();
    std::istream in{&blob_streambuf};
    if (options.IsSingleCharacterDialect()) {
        SimpleCSVParser parser{options, in};
        if (!parser.Parse(sample_limit)) return {};
        return get_score(parser);
    } else {
        ComplexCSVParser parser{options, in};
        if (!parser.Parse(sample_limit)) return {};
        return get_score(parser);
    }
}

/// Detect the dialect
void CSVSniffer::DetectDialect() {
    std::vector<std::string_view> delim_candidates{",", "|", ";", "\t"};
    std::vector<std::vector<std::string_view>> quote_candidates{{"\""}, {"\"", "'"}, {""}};
    std::vector<std::vector<std::string_view>> escape_candidates{{"\\"}, {""}};
}

/// Detect the data types
void CSVSniffer::DetectTypes() {}

/// Detect the parser options
const CSVParserOptions& CSVSniffer::Detect() {
    detected_options = user_options;
    blob_streambuf.Rewind();
    DetectDialect();
    DetectTypes();
    return detected_options;
}

}  // namespace dashql

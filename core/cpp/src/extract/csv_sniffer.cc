#include "dashql/extract/csv_sniffer.h"

using namespace duckdb;

namespace dashql {

/// Constructor
CSVSniffer::CSVSniffer(CachingBlobStreamBuffer&& streambuf) : blob_streambuf(move(streambuf)), detected_options() {}

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
void CSVSniffer::DetectDialect() {}

/// Detect the data types
void CSVSniffer::DetectTypes() {}

/// Detect the parser options
CSVParserOptions CSVSniffer::Detect() {
    detected_options = CSVParserOptions{};
    blob_streambuf.Rewind();
    DetectDialect();
    DetectTypes();
    return move(detected_options);
}

}  // namespace dashql

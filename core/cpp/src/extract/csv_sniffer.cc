#include "dashql/common/defer.h"
#include "dashql/extract/csv_sniffer.h"

#include <array>
#include <vector>

using namespace duckdb;

namespace dashql {

/// Constructor
CSVSniffer::CSVSniffer(const CSVParserOptions& user_options_, CachingBlobStreamBuffer&& streambuf)
    : user_options_(user_options_), detected_options_(user_options_), blob_streambuf_(move(streambuf)) {}

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
    blob_streambuf_.Rewind();
    std::istream in{&blob_streambuf_};
    if (options.IsSingleCharacterDialect()) {
        SimpleCSVParser parser{options, in, move(donated_buffers_)};
        auto donate_back = defer([&]() { donated_buffers_ = parser.DonateBuffers(); });
        if (!parser.Parse(sample_limit)) return {};
        return get_score(parser);
    } else {
        ComplexCSVParser parser{options, in, move(donated_buffers_)};
        auto donate_back = defer([&]() { donated_buffers_ = parser.DonateBuffers(); });
        if (!parser.Parse(sample_limit)) return {};
        return get_score(parser);
    }
}

/// Detect the dialect
void CSVSniffer::DetectDialect() {
    using namespace std;

    // Default candidates for delimiter detection
    vector<string_view> delim_candidates{",", "|", ";", "\t"};
    // Default candidates for quote rule auto detection
    vector<CSVQuoteRule> quoterule_candidates = {CSVQuoteRule::QUOTES_RFC, CSVQuoteRule::QUOTES_OTHER,
                                                 CSVQuoteRule::NO_QUOTES};
    // Default candidates for quote sign auto detection (per quote rule)
    vector<vector<std::string_view>> quote_candidates_map{{"\""}, {"\"", "'"}, {""}};
    // Default candidates for escape character auto detection (per quote rule)
    vector<vector<string_view>> escape_candidates_map{{""}, {"\\"}, {""}};

    // User-specified delimiter?
    if (user_options_.delimiter) {
        delim_candidates = {*user_options_.delimiter};
    }
    // User-specified quote?
    if (user_options_.quote) {
        quote_candidates_map = {{*user_options_.quote}, {*user_options_.quote}, {*user_options_.quote}};
    }
    // User-specified escape?
    if (user_options_.escape) {
        if (user_options_.escape == "") {
            quoterule_candidates = {CSVQuoteRule::QUOTES_RFC};
        } else {
            quoterule_candidates = {CSVQuoteRule::QUOTES_OTHER};
        }
        escape_candidates_map[static_cast<uint8_t>(quoterule_candidates[0])] = {*user_options_.escape};
    }

    vector<CSVParserOptions> info_candidates;
    size_t best_consistent_rows = 0;
    size_t best_num_cols = 0;

    // Try all the dialects and find the best one
    auto options = detected_options_;
    for (auto quoterule : quoterule_candidates) {
        for (auto& quote : quote_candidates_map[static_cast<uint8_t>(quoterule)]) {
            for (auto& delim : delim_candidates) {
                for (auto &escape : escape_candidates_map[static_cast<uint8_t>(quoterule)]) {
                    options.delimiter = delim;
                    options.quote = quote;
                    options.escape = escape;

                    auto score = TryDialect(options);
                }
            }
        }
    }
}

/// Detect the data types
void CSVSniffer::DetectTypes() {}

/// Detect the parser options
const CSVParserOptions& CSVSniffer::Detect() {
    detected_options_ = user_options_;
    blob_streambuf_.Rewind();
    DetectDialect();
    DetectTypes();
    return detected_options_;
}

}  // namespace dashql

// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_EXTRACT_CSV_SNIFFER_H_
#define INCLUDE_DASHQL_EXTRACT_CSV_SNIFFER_H_

#include "dashql/common/blob_stream.h"
#include "dashql/extract/csv_parser.h"

namespace dashql {

class CSVSniffer {
   public:
    /// A dialect
    struct Dialect {
        /// The quote
        std::string_view quote;
        /// The delimiter
        std::string_view delimiter;
        /// The escape
        std::string_view escape;
    };
    /// A dialect evaluation
    struct DialectScore {
        /// The row count
        size_t row_count = 0;
        /// The column count
        size_t column_count = 0;
        /// The number of consistent rows
        size_t consistent_rows = 0;
        /// The first consistent row
        size_t first_consistent_row = 0;
    };

   protected:
    /// The user provided options
    const CSVParserOptions& user_options_;
    /// The parser options
    CSVParserOptions detected_options_;
    /// The blob stream buffer
    CachingBlobStreamBuffer blob_streambuf_;
    /// The donated buffers
    std::array<std::vector<char>, 2> donated_buffers_ = {};

    /// Try a dialect
    DialectScore TryDialect(CSVParserOptions& options);
    /// Detect the dialect
    Expected<std::vector<Dialect>> DetectDialect();
    /// Detct the data types
    void DetectTypes();

   public:
    /// Constructor
    CSVSniffer(const CSVParserOptions& user_options, CachingBlobStreamBuffer&& streambuf);

    /// Detect the parser options
    const CSVParserOptions& Detect();
};

}  // namespace dashql

#endif

// Copyright (c) 2020 The DashQL Authors

// This file copies large parts of the buffered CSV reader in DuckDB:
// https://github.com/cwida/duckdb/blob/6c3e3ab96ba20d7a5f51e5ec8afbeca3d0822528/src/execution/operator/persistent/buffered_csv_reader.cpp
//
// Notable changes:
//  - We only read from istreams.
//  - We don't seek during dialect detection.
//  - We use error codes instead of exceptions.

#ifndef INCLUDE_DASHQL_EXTRACT_CSV_PARSER_H_
#define INCLUDE_DASHQL_EXTRACT_CSV_PARSER_H_

#include <map>
#include <optional>

#include "dashql/common/enum.h"
#include "dashql/common/expected.h"
#include "dashql/common/pattern_search.h"
#include "dashql/common/pod_vector.h"
#include "duckdb/common/types.hpp"
#include "duckdb/common/types/data_chunk.hpp"
#include "duckdb/function/scalar/strftime.hpp"

namespace dashql {

BETTER_ENUM(CSVParserMode, uint8_t, PARSING, PARSING_HEADER, SNIFFING_DIALECT, SNIFFING_DATATYPES)
    
BETTER_ENUM(CSVQuoteRule, uint8_t, QUOTES_RFC = 0, QUOTES_OTHER = 1, NO_QUOTES = 2);

constexpr size_t CSV_OUTPUT_CHUNK_SIZE = 1024;
constexpr size_t CSV_PARSER_INITIAL_BUFFER_SIZE = 16384;
constexpr size_t CSV_PARSER_MAXIMUM_LINE_SIZE = 1048576;

struct CSVParserOptions {
    /// The CSV parser mode
    CSVParserMode mode = CSVParserMode::PARSING;
    /// The SQL types
    std::vector<duckdb::LogicalType> sql_types = {};
    /// Delimiter to separate columns within each line
    std::optional<std::string_view> delimiter = ",";
    /// Quote used for columns that contain reserved characters, e.g., delimiter
    std::optional<std::string_view> quote = "\"";
    /// Escape character to escape quote character
    std::optional<std::string_view> escape = "\\";
    /// Whether or not the file has a header line
    bool header = false;
    /// How many leading rows to skip
    size_t skip_rows = 0;
    /// Expected number of columns
    size_t num_cols = 0;
    /// Specifies the std::string that represents a null value
    std::string_view null_str = "";
    /// True, if column with that index must skip null check
    std::vector<bool> force_not_null = {};
    /// Consider all columns to be of type varchar
    bool all_varchar = false;
    /// The date format to use (if any is specified)
    std::map<duckdb::LogicalTypeId, duckdb::StrpTimeFormat> date_format = {{duckdb::LogicalTypeId::DATE, {}},
                                                                           {duckdb::LogicalTypeId::TIMESTAMP, {}}};
    /// Whether or not a type format is specified
    std::map<duckdb::LogicalTypeId, bool> has_format = {{duckdb::LogicalTypeId::DATE, false},
                                                        {duckdb::LogicalTypeId::TIMESTAMP, false}};

    /// Dump parser options as string
    std::string ToString() const;
    /// Requires a complex parser?
    bool IsSingleCharacterDialect() const { return (delimiter->size() > 1) || (quote->size() > 1) || (escape->size() > 1); }
};

class CSVParser {
   protected:
    /// The parser options
    const CSVParserOptions& options;
    /// The input stream
    std::istream& in;

    /// The error (if any)
    std::optional<Error> error = std::nullopt;
    /// The buffer
    std::array<std::vector<char>, 2> buffers = {};
    /// The buffer size
    size_t buffer_size = 0;
    /// The buffer position
    size_t buffer_position = 0;
    /// The start of the current token
    size_t token_start = 0;
    /// The current line
    size_t current_line = 0;
    /// The current column
    size_t current_column = 0;

    /// The column counts
    std::vector<size_t> column_counts = {};
    /// The parse chunk
    duckdb::DataChunk parse_chunk = {};

    /// Fail with error
    inline auto FailWith(ErrorCode ec) {
        return ErrorBuilder<CSVParser>{ec, !!error, this, [](CSVParser* p, Error&& err) { p->error = err; }};
    }
    /// The parsing finished
    inline Signal ParsingDone() { return error ? *error : Signal::OK(); }
    /// Read into buffer
    bool ReadBuffer();
    /// Add a value
    void AddValue(std::string_view val, std::vector<size_t>& escape_positions);
    /// Adds a row to the output_chunk, returns true if the chunk is filled as a result of this row being added
    bool AddRow(size_t limit, duckdb::DataChunk* output_chunk);
    /// Flush data chunk
    void Flush(size_t limit, duckdb::DataChunk* output_chunk);

   public:
    /// Constructor
    CSVParser(const CSVParserOptions& options, std::istream& in, std::array<std::vector<char>, 2> donated_buffers = {});
    /// Deleted copy constructor
    CSVParser(const CSVParser& other) = delete;
    /// Deleted copy assignment
    CSVParser& operator=(const CSVParser& other) = delete;

    /// Return the column counts
    auto& GetColumnCounts() const { return column_counts; }
};

class SimpleCSVParser : public CSVParser {
   public:
    /// Constructor
    SimpleCSVParser(const CSVParserOptions& options, std::istream& in, std::array<std::vector<char>, 2> donated_buffers = {});
    /// Move assignment
    SimpleCSVParser& operator=(SimpleCSVParser&& other);

    /// Parse the input
    Signal Parse(size_t limit = CSV_OUTPUT_CHUNK_SIZE, duckdb::DataChunk* output_chunk = nullptr);
};

class ComplexCSVParser : public CSVParser {
   protected:
    /// The shift array for the delimiter search
    PatternShiftArray delimiter_search;
    /// The shift array for the escape search
    PatternShiftArray escape_search;
    /// The shift array for the quote search
    PatternShiftArray quote_search;

   public:
    /// Constructor
    ComplexCSVParser(const CSVParserOptions& options, std::istream& in, std::array<std::vector<char>, 2> donated_buffers = {});

    /// Parse the input
    Signal Parse(size_t limit = CSV_OUTPUT_CHUNK_SIZE, duckdb::DataChunk* output_chunk = nullptr);
};

}  // namespace dashql

#endif

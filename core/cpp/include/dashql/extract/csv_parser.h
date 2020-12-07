// Copyright (c) 2020 The DashQL Authors

// c.f.: dashql/extract/csv_extract.h

#ifndef INCLUDE_DASHQL_EXTRACT_CSV_PARSER_H_
#define INCLUDE_DASHQL_EXTRACT_CSV_PARSER_H_

#include <map>
#include "dashql/common/enum.h"
#include "dashql/common/expected.h"
#include "dashql/common/pattern_search.h"
#include "dashql/common/pod_vector.h"
#include "duckdb/common/types.hpp"
#include "duckdb/common/types/data_chunk.hpp"
#include "duckdb/function/scalar/strftime.hpp"

namespace dashql {

BETTER_ENUM(CSVParserMode, uint8_t,
    PARSING,
    PARSING_HEADER,
    SNIFFING_DIALECT,
    SNIFFING_DATATYPES
)

constexpr size_t CSV_OUTPUT_CHUNK_SIZE = 1024;
constexpr size_t CSV_PARSER_INITIAL_BUFFER_SIZE = 16384;
constexpr size_t CSV_PARSER_MAXIMUM_LINE_SIZE = 1048576;

struct CSVParserOptions {
    /// The CSV parser mode
    CSVParserMode mode = CSVParserMode::PARSING;
    /// The SQL types
    std::vector<duckdb::LogicalType> sql_types = {};
    /// Delimiter to separate columns within each line
    std::string_view delimiter = ",";
    /// Quote used for columns that contain reserved characters, e.g., delimiter
    std::string_view quote = "\"";
    /// Escape character to escape quote character
    std::string_view escape = "\\";
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
    std::map<duckdb::LogicalTypeId, duckdb::StrpTimeFormat> date_format = {{duckdb::LogicalTypeId::DATE, {}}, {duckdb::LogicalTypeId::TIMESTAMP, {}}};
    /// Whether or not a type format is specified
    std::map<duckdb::LogicalTypeId, bool> has_format = {{duckdb::LogicalTypeId::DATE, false}, {duckdb::LogicalTypeId::TIMESTAMP, false}};

    /// Dump parser options as string
    std::string ToString() const;
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
    std::vector<char> buffer = {};
    /// The temporary buffer
    std::vector<char> tmp = {};
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
    void FailWith(Error e) { if (!error) { error = std::move(e); } }
    /// Get the line number string
    std::string GetLineNumberStr() const;
    /// Read into buffer
    bool ReadBuffer();
    /// Add a value
    void AddValue(std::string_view val, std::vector<size_t> &escape_positions);
    /// Adds a row to the output_chunk, returns true if the chunk is filled as a result of this row being added
    bool AddRow(duckdb::DataChunk* output_chunk, size_t output_capacity);
    /// Flush data chunk
    void Flush(duckdb::DataChunk* output_chunk, size_t output_capacity);

   public:
    /// Constructor
    CSVParser(const CSVParserOptions& options, std::istream& in);
    /// Move constructor to reuse state
    CSVParser(CSVParser&& other, const CSVParserOptions& options, std::istream& in);
    /// Deleted copy constructor
    CSVParser(const CSVParser& other) = delete;
    /// Deleted copy assignment
    CSVParser& operator=(const CSVParser& other) = delete;
};

class SimpleCSVParser: public CSVParser {
   public:
    /// Constructor
    SimpleCSVParser(const CSVParserOptions& options, std::istream& in);
    /// Move constructor to reuse state
    SimpleCSVParser(SimpleCSVParser&& other, const CSVParserOptions& options, std::istream& in);
    /// Move assignment
    SimpleCSVParser& operator=(SimpleCSVParser&& other);

    /// Parse the input
    Signal Parse(duckdb::DataChunk* output_chunk = nullptr, size_t output_capacity = CSV_OUTPUT_CHUNK_SIZE);
};


class ComplexCSVParser: public CSVParser {
   protected:
    /// The shift array for the delimiter search
    PatternShiftArray delimiter_search;
    /// The shift array for the escape search
    PatternShiftArray escape_search;
    /// The shift array for the quote search
    PatternShiftArray quote_search;

   public:
    /// Constructor
    ComplexCSVParser(const CSVParserOptions& options, std::istream& in);
    /// Move constructor to reuse state
    ComplexCSVParser(ComplexCSVParser&& other, const CSVParserOptions& options, std::istream& in);

    /// Parse the input
    Signal Parse(duckdb::DataChunk* output_chunk = nullptr, size_t output_capacity = CSV_OUTPUT_CHUNK_SIZE);
};

}

#endif

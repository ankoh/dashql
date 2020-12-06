// Copyright (c) 2020 The DashQL Authors

// This file copies large parts of the buffered CSV reader in DuckDB:
// https://github.com/cwida/duckdb/blob/6c3e3ab96ba20d7a5f51e5ec8afbeca3d0822528/src/execution/operator/persistent/buffered_csv_reader.cpp
//
// Notable changes:
//  - We only read from istreams.
//  - We don't like exceptions.
//  - We flush directly into tables instead of accumulating a single insert chunk.
//  - We don't jump within the stream for sampling since we try to avoid blob buffering.

#ifndef INCLUDE_DASHQL_EXTRACT_CSV_EXTRACT_H_
#define INCLUDE_DASHQL_EXTRACT_CSV_EXTRACT_H_

#include <iostream>
#include <map>
#include <memory>
#include <stack>
#include <string>
#include <queue>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>

#include "dashql/common/blob_stream.h"
#include "dashql/common/pattern_search.h"
#include "duckdb/common/types.hpp"
#include "duckdb/common/types/data_chunk.hpp"
#include "duckdb/function/scalar/strftime.hpp"

namespace dashql {

constexpr size_t CSV_EXTRACT_SAMPLE_CHUNK_SIZE = 1024;
constexpr size_t CSV_EXTRACT_BUFFER_SIZE = 10 * 1024;
constexpr size_t CSV_EXTRACT_INITIAL_BUFFER_SIZE = 16384;

struct CSVExtractOptions {
    /// The blob id
    size_t blob_id = 0;
    /// The blob size
    size_t blob_size = 0;
    /// Whether or not to automatically detect dialect and datatypes
    bool auto_detect = false;
    /// Whether or not a delimiter was defined by the user
    bool has_delimiter = false;
    /// Delimiter to separate columns within each line
    std::string delimiter = ",";
    /// Whether or not a quote sign was defined by the user
    bool has_quote = false;
    /// Quote used for columns that contain reserved characters, e.g., delimiter
    std::string quote = "\"";
    /// Whether or not an escape character was defined by the user
    bool has_escape = false;
    /// Escape character to escape quote character
    std::string escape;
    /// Whether or not a header information was given by the user
    bool has_header = false;
    /// Whether or not the file has a header line
    bool header = false;
    /// How many leading rows to skip
    size_t skip_rows = 0;
    /// Expected number of columns
    size_t num_cols = 0;
    /// Specifies the std::string that represents a null value
    std::string null_str;
    /// True, if column with that index must skip null check
    std::vector<bool> force_not_null;
    /// Size of sample chunk used for dialect and type detection
    size_t sample_chunk_size = CSV_EXTRACT_SAMPLE_CHUNK_SIZE;
    /// Number of sample chunks used for type detection
    size_t sample_chunks = 10;
    /// Number of samples to buffer
    size_t buffer_size = CSV_EXTRACT_BUFFER_SIZE * 10;
    /// Consider all columns to be of type varchar
    bool all_varchar = false;
    /// The date format to use (if any is specified)
    std::map<duckdb::LogicalTypeId, duckdb::StrpTimeFormat> date_format = {{duckdb::LogicalTypeId::DATE, {}}, {duckdb::LogicalTypeId::TIMESTAMP, {}}};
    /// Whether or not a type format is specified
    std::map<duckdb::LogicalTypeId, bool> has_format = {{duckdb::LogicalTypeId::DATE, false}, {duckdb::LogicalTypeId::TIMESTAMP, false}};

    std::string toString() const {
        return "DELIMITER='" + delimiter + (has_delimiter ? "'" : (auto_detect ? "' (auto detected)" : "' (default)")) +
               ", QUOTE='" + quote + (has_quote ? "'" : (auto_detect ? "' (auto detected)" : "' (default)")) +
               ", ESCAPE='" + escape + (has_escape ? "'" : (auto_detect ? "' (auto detected)" : "' (default)")) +
               ", HEADER=" + std::to_string(header) +
               (has_header ? "" : (auto_detect ? "' (auto detected)" : "' (default)")) +
               ", SAMPLE_SIZE=" + std::to_string(sample_chunk_size * sample_chunks) +
               ", ALL_VARCHAR=" + std::to_string(all_varchar);
    }
};

enum class QuoteRule : uint8_t { QUOTES_RFC = 0, QUOTES_OTHER = 1, NO_QUOTES = 2 };

enum class ParserMode : uint8_t { PARSING = 0, SNIFFING_DIALECT = 1, SNIFFING_DATATYPES = 2, PARSING_HEADER = 3 };

/// Buffered CSV reader is a class that reads values from a stream and parses them as a CSV file
class CSVExtract {
    ParserMode mode;

    /// Candidates for delimiter auto detection
    std::vector<std::string> delim_candidates = {",", "|", ";", "\t"};
    /// Candidates for quote rule auto detection
    std::vector<QuoteRule> quoterule_candidates = {QuoteRule::QUOTES_RFC, QuoteRule::QUOTES_OTHER, QuoteRule::NO_QUOTES};
    /// Candidates for quote sign auto detection (per quote rule)
    std::vector<std::vector<std::string>> quote_candidates_map = {{"\""}, {"\"", "'"}, {""}};
    /// Candidates for escape character auto detection (per quote rule)
    std::vector<std::vector<std::string>> escape_candidates_map = {{""}, {"\\"}, {""}};

public:
    CSVExtract(CSVExtractOptions options, std::vector<duckdb::LogicalType> requested_types, std::istream& source);

    CSVExtractOptions options;
    std::vector<duckdb::LogicalType> sql_types;
    std::vector<std::string> col_names;
    std::istream& source;

    std::unique_ptr<char[]> buffer;
    size_t buffer_size;
    size_t position;
    size_t start = 0;

    size_t linenr = 0;
    bool linenr_estimated = false;

    std::vector<size_t> sniffed_column_counts;
    size_t sample_chunk_idx = 0;
    bool jumping_samples = false;
    bool end_of_file_reached = false;

    size_t bytes_in_chunk = 0;
    double bytes_per_line_avg = 0;

    std::vector<std::unique_ptr<char[]>> cached_buffers;

    PatternShiftArray delimiter_search, escape_search, quote_search;

    duckdb::DataChunk parse_chunk;

    std::queue<std::unique_ptr<duckdb::DataChunk>> cached_chunks;

public:
    /// Extract a single DataChunk from the CSV file and stores it in insert_chunk
    void Extract(duckdb::DataChunk &insert_chunk);

private:
    /// Initialize Parser
    void Initialize(std::vector<duckdb::LogicalType> requested_types);
    /// Initializes the parse_chunk with varchar columns and aligns info with new number of cols
    void InitParseChunk(size_t num_cols);
    /// Initializes the TextSearchShiftArrays for complex parser
    void PrepareComplexParser();
    /// Extract a single DataChunk from the CSV file and stores it in insert_chunk
    void ParseCSV(duckdb::DataChunk &insert_chunk);
    /// Extract a single DataChunk from the CSV file and stores it in insert_chunk
    void ParseCSV(ParserMode mode, duckdb::DataChunk &insert_chunk);
    /// Sniffs CSV dialect and determines skip rows, header row, column types and column names
    std::vector<duckdb::LogicalType> SniffCSV(std::vector<duckdb::LogicalType> requested_types);
    /// Change the date format for the type to the string
    void SetDateFormat(const std::string &format_specifier, const duckdb::LogicalTypeId &sql_type);
    /// Try to cast a string value to the specified sql type
    bool TryCastValue(duckdb::Value value, duckdb::LogicalType sql_type);
    /// Try to cast a vector of values to the specified sql type
    bool TryCastVector(duckdb::Vector &parse_chunk_col, size_t size, duckdb::LogicalType sql_type);
    /// Skips skip_rows, reads header row from input stream
    void SkipRowsAndReadHeader(size_t skip_rows, bool skip_header);
    /// Jumps back to the beginning of input stream and resets necessary internal states
    void JumpToBeginning(size_t skip_rows, bool skip_header);
    /// Jumps back to the beginning of input stream and resets necessary internal states
    bool JumpToNextSample();
    /// Resets the buffer
    void ResetBuffer();
    /// Resets the steam
    void ResetStream();
    /// Prepare candidate sets for auto detection based on user input
    void PrepareCandidateSets();

    /// Parses a CSV file with a one-byte delimiter, escape and quote character
    void ParseSimpleCSV(duckdb::DataChunk &insert_chunk);
    /// Parses more complex CSV files with multi-byte delimiters, escapes or quotes
    void ParseComplexCSV(duckdb::DataChunk &insert_chunk);

    /// Adds a value to the current row
    void AddValue(char *str_val, size_t length, size_t &column, std::vector<size_t> &escape_positions);
    /// Adds a row to the insert_chunk, returns true if the chunk is filled as a result of this row being added
    bool AddRow(duckdb::DataChunk &insert_chunk, size_t &column);
    /// Finalizes a chunk, parsing all values that have been added so far and adding them to the insert_chunk
    void Flush(duckdb::DataChunk &insert_chunk);
    /// Reads a new buffer from the CSV file if the current one has been exhausted
    bool ReadBuffer(size_t &start);
};

}

#endif

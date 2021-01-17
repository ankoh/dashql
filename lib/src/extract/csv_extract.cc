#include "dashql/extract/csv_extract.h"

#include <algorithm>
#include <cctype>
#include <cstring>
#include <fstream>

#include "duckdb/catalog/catalog_entry/table_catalog_entry.hpp"
#include "duckdb/common/file_system.hpp"
#include "duckdb/common/gzip_stream.hpp"
#include "duckdb/common/string_util.hpp"
#include "duckdb/common/vector_operations/unary_executor.hpp"
#include "duckdb/common/vector_operations/vector_operations.hpp"
#include "duckdb/execution/operator/persistent/buffered_csv_reader.hpp"
#include "duckdb/function/scalar/strftime.hpp"
#include "duckdb/main/database.hpp"
#include "duckdb/parser/column_definition.hpp"
#include "duckdb/storage/data_table.hpp"

using namespace std;
using namespace duckdb;

namespace dashql {
namespace {

string GetLineNumberStr(size_t linenr, bool linenr_estimated) {
    string estimated = (linenr_estimated ? string(" (estimated)") : string(""));
    return std::to_string(linenr + 1) + estimated;
}

}  // namespace

CSVExtract::CSVExtract(CSVExtractOptions options, vector<LogicalType> requested_types, istream &ssource)
    : options(options), source(ssource), buffer_size(0), position(0), start(0) {
    Initialize(requested_types);
}

void CSVExtract::Initialize(vector<LogicalType> requested_types) {
    if (options.auto_detect) {
        sql_types = SniffCSV(requested_types);
    } else {
        sql_types = requested_types;
        JumpToBeginning(options.skip_rows, options.header);
    }

    PrepareComplexParser();
    InitParseChunk(sql_types.size());
}

// void CSVExtract::SkipRowsAndReadHeader(size_t skip_rows, bool skip_header) {
//     for (size_t i = 0; i < skip_rows; i++) {
//         // Ignore skip rows
//         string read_line;
//         getline(source, read_line);
//         linenr++;
//     }
//
//     if (skip_header) {
//         // Ignore the first line as a header line
//         InitParseChunk(sql_types.size());
//         ParseCSV(ParserMode::PARSING_HEADER);
//     }
// }

void CSVExtract::ResetBuffer() {
    buffer.reset();
    buffer_size = 0;
    position = 0;
    start = 0;
    cached_buffers.clear();
}

void CSVExtract::ResetStream() {
    linenr = 0;
    linenr_estimated = false;
    bytes_per_line_avg = 0;
    sample_chunk_idx = 0;
}

void CSVExtract::InitParseChunk(size_t num_cols) {
    bytes_in_chunk = 0;

    // adapt not null info
    if (options.force_not_null.size() != num_cols) {
        options.force_not_null.resize(num_cols, false);
    }

    parse_chunk.Destroy();

    // initialize the parse_chunk with a set of VARCHAR types
    vector<LogicalType> varchar_types(num_cols, LogicalType::VARCHAR);
    parse_chunk.Initialize(varchar_types);
}

void CSVExtract::JumpToBeginning(size_t skip_rows = 0, bool skip_header = false) {
    ResetBuffer();
    ResetStream();
    SkipRowsAndReadHeader(skip_rows, skip_header);
    sample_chunk_idx = 0;
}

bool CSVExtract::JumpToNextSample() {
    // get bytes contained in the previously read chunk
    size_t remaining_bytes_in_buffer = buffer_size - start;
    bytes_in_chunk -= remaining_bytes_in_buffer;
    if (remaining_bytes_in_buffer == 0) {
        return false;
    }

    if (end_of_file_reached || sample_chunk_idx >= options.sample_chunks) {
        return false;
    }

    // Just read x continuous chunks from the stream for sampling.
    sample_chunk_idx++;
    return true;
}

void CSVExtract::SetDateFormat(const string &format_specifier, const LogicalTypeId &sql_type) {
    options.has_format[sql_type] = true;
    auto &date_format = options.date_format[sql_type];
    date_format.format_specifier = format_specifier;
    StrTimeFormat::ParseFormatSpecifier(date_format.format_specifier, date_format);
}

bool CSVExtract::TryCastValue(Value value, LogicalType sql_type) {
    try {
        if (options.has_format[LogicalTypeId::DATE] && sql_type.id() == LogicalTypeId::DATE) {
            options.date_format[LogicalTypeId::DATE].ParseDate(value.str_value);
        } else if (options.has_format[LogicalTypeId::TIMESTAMP] && sql_type.id() == LogicalTypeId::TIMESTAMP) {
            options.date_format[LogicalTypeId::TIMESTAMP].ParseTimestamp(value.str_value);
        } else {
            value.CastAs(sql_type, true);
        }
        return true;
    } catch (...) {
        return false;
    }
    return false;
}

bool CSVExtract::TryCastVector(Vector &parse_chunk_col, size_t size, LogicalType sql_type) {
    try {
        // try vector-cast from string to sql_type
        Vector dummy_result(sql_type);
        if (options.has_format[LogicalTypeId::DATE] && sql_type == LogicalTypeId::DATE) {
            // use the date format to cast the chunk
            UnaryExecutor::Execute<string_t, date_t, true>(parse_chunk_col, dummy_result, size, [&](string_t input) {
                return options.date_format[LogicalTypeId::DATE].ParseDate(input);
            });
        } else if (options.has_format[LogicalTypeId::TIMESTAMP] && sql_type == LogicalTypeId::TIMESTAMP) {
            // use the date format to cast the chunk
            UnaryExecutor::Execute<string_t, timestamp_t, true>(
                parse_chunk_col, dummy_result, size,
                [&](string_t input) { return options.date_format[LogicalTypeId::TIMESTAMP].ParseTimestamp(input); });
        } else {
            // target type is not varchar: perform a cast
            VectorOperations::Cast(parse_chunk_col, dummy_result, size, true);
        }
    } catch (const Exception &e) {
        return false;
    }
    return true;
}

void CSVExtract::PrepareCandidateSets() {
    if (options.has_delimiter) {
        delim_candidates = {options.delimiter};
    }
    if (options.has_quote) {
        quote_candidates_map = {{options.quote}, {options.quote}, {options.quote}};
    }
    if (options.has_escape) {
        if (options.escape == "") {
            quoterule_candidates = {QuoteRule::QUOTES_RFC};
        } else {
            quoterule_candidates = {QuoteRule::QUOTES_OTHER};
        }
        escape_candidates_map[static_cast<uint8_t>(quoterule_candidates[0])] = {options.escape};
    }
}

void CSVExtract::ParseCSV(DataChunk &insert_chunk) {
    // Flush the chunks that we already parsed during sniffing (if any)
    if (cached_chunks.empty()) {
        cached_buffers.clear();
    } else {
        auto &chunk = cached_chunks.front();
        parse_chunk.Reference(*chunk);
        cached_chunks.pop();
        Flush(insert_chunk);
        return;
    }

    ParseCSV(ParserMode::PARSING, insert_chunk);
}

void CSVExtract::ParseCSV(ParserMode parser_mode, DataChunk &insert_chunk) {
    mode = parser_mode;
    if (options.quote.size() <= 1 && options.escape.size() <= 1 && options.delimiter.size() == 1) {
        ParseSimpleCSV(insert_chunk);
    } else {
        ParseComplexCSV(insert_chunk);
    }
}

}  // namespace dashql

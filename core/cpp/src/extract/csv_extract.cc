#include "dashql/extract/csv_extract.h"

#include "duckdb/execution/operator/persistent/buffered_csv_reader.hpp"

#include "duckdb/catalog/catalog_entry/table_catalog_entry.hpp"
#include "duckdb/common/file_system.hpp"
#include "duckdb/common/gzip_stream.hpp"
#include "duckdb/common/string_util.hpp"
#include "duckdb/common/vector_operations/unary_executor.hpp"
#include "duckdb/common/vector_operations/vector_operations.hpp"
#include "duckdb/function/scalar/strftime.hpp"
#include "duckdb/main/database.hpp"
#include "duckdb/parser/column_definition.hpp"
#include "duckdb/storage/data_table.hpp"

#include <algorithm>
#include <cctype>
#include <cstring>
#include <fstream>

using namespace std;
using namespace duckdb;

namespace dashql {
namespace {

string GetLineNumberStr(size_t linenr, bool linenr_estimated) {
    string estimated = (linenr_estimated ? string(" (estimated)") : string(""));
    return std::to_string(linenr + 1) + estimated;
}

}

CSVExtract::CSVExtract(CSVExtractOptions options, vector<LogicalType> requested_types, istream& ssource)
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

void CSVExtract::SkipRowsAndReadHeader(size_t skip_rows, bool skip_header) {
    for (size_t i = 0; i < skip_rows; i++) {
        // Ignore skip rows
        string read_line;
        getline(source, read_line);
        linenr++;
    }

    if (skip_header) {
        // Ignore the first line as a header line
        InitParseChunk(sql_types.size());
        ParseCSV(ParserMode::PARSING_HEADER);
    }
}

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

void CSVExtract::AddValue(char *str_val, size_t length, size_t &column, vector<size_t> &escape_positions) {
    if (sql_types.size() > 0 && column == sql_types.size() && length == 0) {
        // skip a single trailing delimiter in last column
        return;
    }
    if (mode == ParserMode::SNIFFING_DIALECT) {
        column++;
        return;
    }
    if (column >= sql_types.size()) {
        throw InvalidInputException("Error on line %s: expected %lld values per row, but got more. (%s)",
                                    GetLineNumberStr(linenr, linenr_estimated).c_str(), sql_types.size(),
                                    options.toString());
    }

    // insert the line number into the chunk
    size_t row_entry = parse_chunk.size();

    str_val[length] = '\0';

    // test against null string
    if (!options.force_not_null[column] && strcmp(options.null_str.c_str(), str_val) == 0) {
        FlatVector::SetNull(parse_chunk.data[column], row_entry, true);
    } else {
        auto &v = parse_chunk.data[column];
        auto parse_data = FlatVector::GetData<string_t>(v);
        if (escape_positions.size() > 0) {
            // remove escape characters (if any)
            string old_val = str_val;
            string new_val = "";
            size_t prev_pos = 0;
            for (size_t i = 0; i < escape_positions.size(); i++) {
                size_t next_pos = escape_positions[i];
                new_val += old_val.substr(prev_pos, next_pos - prev_pos);

                if (options.escape.size() == 0 || options.escape == options.quote) {
                    prev_pos = next_pos + options.quote.size();
                } else {
                    prev_pos = next_pos + options.escape.size();
                }
            }
            new_val += old_val.substr(prev_pos, old_val.size() - prev_pos);
            escape_positions.clear();
            parse_data[row_entry] = StringVector::AddStringOrBlob(v, string_t(new_val));
        } else {
            parse_data[row_entry] = string_t(str_val, length);
        }
    }

    // move to the next column
    column++;
}

bool CSVExtract::AddRow(DataChunk &insert_chunk, size_t &column) {
    linenr++;

    if (column < sql_types.size() && mode != ParserMode::SNIFFING_DIALECT) {
        throw InvalidInputException("Error on line %s: expected %lld values per row, but got %d. (%s)",
                                    GetLineNumberStr(linenr, linenr_estimated).c_str(), sql_types.size(), column,
                                    options.toString());
    }

    if (mode == ParserMode::SNIFFING_DIALECT) {
        sniffed_column_counts.push_back(column);

        if (sniffed_column_counts.size() == options.sample_chunk_size) {
            return true;
        }
    } else {
        parse_chunk.SetCardinality(parse_chunk.size() + 1);
    }

    if (mode == ParserMode::PARSING_HEADER) {
        return true;
    }

    if (mode == ParserMode::SNIFFING_DATATYPES && parse_chunk.size() == options.sample_chunk_size) {
        return true;
    }

    if (mode == ParserMode::PARSING && parse_chunk.size() == STANDARD_VECTOR_SIZE) {
        Flush(insert_chunk);
        return true;
    }

    column = 0;
    return false;
}

void CSVExtract::Flush(DataChunk &insert_chunk) {
    if (parse_chunk.size() == 0) {
        return;
    }

    // Convert the columns in the parsed chunk to the types of the table
    insert_chunk.SetCardinality(parse_chunk);
    for (size_t col_idx = 0; col_idx < sql_types.size(); col_idx++) {

        if (sql_types[col_idx].id() == LogicalTypeId::VARCHAR) {
            // Target type is VARCHAR: no need to convert
            // Just test that all strings are valid utf-8 strings
            auto parse_data = FlatVector::GetData<string_t>(parse_chunk.data[col_idx]);
            for (size_t i = 0; i < parse_chunk.size(); i++) {
                if (!FlatVector::IsNull(parse_chunk.data[col_idx], i)) {
                    auto s = parse_data[i];
                    auto utf_type = Utf8Proc::Analyze(s.GetDataUnsafe(), s.GetSize());
                    if (utf_type == UnicodeType::INVALID) {
                        string col_name = std::to_string(col_idx);
                        if (col_idx < col_names.size()) {
                            col_name = "\"" + col_names[col_idx] + "\"";
                        }
                        throw InvalidInputException("Error in blob \"%s\" between line %llu and %llu in column \"%s\": "
                                                    "file is not valid UTF8. Parser options: %s",
                                                    options.blob_id, linenr - parse_chunk.size(), linenr, col_name,
                                                    options.toString());
                    }
                }
            }
            insert_chunk.data[col_idx].Reference(parse_chunk.data[col_idx]);
        } else {
            // Target type is not a VARCHAR so we need to convert
            try {
                // Need explicit DATE conversion?
                if (options.has_format[LogicalTypeId::DATE] && sql_types[col_idx].id() == LogicalTypeId::DATE) {
                    // use the date format to cast the chunk
                    UnaryExecutor::Execute<string_t, date_t, true>(
                        parse_chunk.data[col_idx], insert_chunk.data[col_idx], parse_chunk.size(),
                        [&](string_t input) { return options.date_format[LogicalTypeId::DATE].ParseDate(input); });
                }

                // Need explicit TIMESTAMP conversion?
                else if (options.has_format[LogicalTypeId::TIMESTAMP] &&
                           sql_types[col_idx].id() == LogicalTypeId::TIMESTAMP) {
                    // use the date format to cast the chunk
                    UnaryExecutor::Execute<string_t, timestamp_t, true>(
                        parse_chunk.data[col_idx], insert_chunk.data[col_idx], parse_chunk.size(), [&](string_t input) {
                            return options.date_format[LogicalTypeId::TIMESTAMP].ParseTimestamp(input);
                        });
                }

                // Cast the value
                else {
                    // target type is not varchar: perform a cast
                    VectorOperations::Cast(parse_chunk.data[col_idx], insert_chunk.data[col_idx], parse_chunk.size());
                }
            } catch (const Exception &e) {
                string col_name = std::to_string(col_idx);
                if (col_idx < col_names.size()) {
                    col_name = "\"" + col_names[col_idx] + "\"";
                }

                if (options.auto_detect) {
                    throw InvalidInputException(
                        "%s in column %s, between line %llu and %llu."
                        " Parser options: %s."
                        "Consider either increasing the sample size (using SAMPLE_SIZE=X) "
                        "or skipping column conversion (ALL_VARCHAR=1)",
                        e.what(), col_name, linenr - parse_chunk.size() + 1, linenr, options.toString());
                } else {
                    throw InvalidInputException("%s between line %llu and %llu in column %s. Parser options: %s ",
                                                e.what(), linenr - parse_chunk.size(), linenr, col_name,
                                                options.toString());
                }
            }
        }
    }
    parse_chunk.Reset();
}

} // namespace duckdb


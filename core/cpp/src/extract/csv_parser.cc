#include "dashql/extract/csv_parser.h"

#include "dashql/extract/csv_extract.h"
#include "duckdb/common/string_util.hpp"
#include "utf8proc_wrapper.hpp"

using namespace duckdb;

namespace dashql {
namespace {

char is_newline(char c) { return c == '\n' || c == '\r'; }

}  // namespace

/// Dump parser options as string
std::string CSVParserOptions::ToString() const {
    std::stringstream out;
    out << "mode=" << mode;
    out << ", types=[";
    for (unsigned i = 0; i < sql_types.size(); ++i) {
        if (i > 0) out << ", ";
        out << sql_types[i].ToString();
    }
    out << "], quote='" << quote << "'";
    out << ", escape='" << escape << "'";
    out << ", header=" << header;
    out << ", skip_rows=" << skip_rows;
    out << ", null_str='" << null_str << "'";
    out << ", force_not_null=[";
    for (unsigned i = 0; i < force_not_null.size(); ++i) {
        if (i > 0) out << ", ";
        out << force_not_null[i];
    }
    out << "], all_varchar=" << all_varchar;
    return out.str();
}

CSVParser::CSVParser(const CSVParserOptions& options, std::istream& in) : options(options), in(in) {
    vector<LogicalType> varchar_types(options.sql_types.size(), LogicalType::VARCHAR);
    parse_chunk.Initialize(varchar_types);
}

CSVParser::CSVParser(CSVParser&& other, const CSVParserOptions& options, std::istream& in)
    : options(options), in(in), buffer(move(other.buffer)), tmp(move(other.tmp)), column_counts(other.column_counts) {
    vector<LogicalType> varchar_types(options.sql_types.size(), LogicalType::VARCHAR);
    parse_chunk.Initialize(varchar_types);
}

bool CSVParser::ReadBuffer() {
    std::swap(buffer, tmp);

    // Get the remaining part of the last buffer
    auto remaining = buffer_size - token_start;
    auto buffer_read_size = std::max(buffer.size(), CSV_PARSER_INITIAL_BUFFER_SIZE);
    while (remaining > buffer_read_size) {
        buffer_read_size *= 2;
    }

    // Exceeded maximum line size?
    if ((remaining + buffer_read_size) > CSV_PARSER_MAXIMUM_LINE_SIZE) {
        FailWith(ErrorCode::CSV_PARSER_ERROR)
            << "Maximum line size of " << CSV_PARSER_MAXIMUM_LINE_SIZE << "bytes exceeded!";
        return false;
    }

    // Need to resize the buffer?
    auto required_buffer_size = buffer_read_size + remaining + 1;
    if (buffer.size() < required_buffer_size) {
        buffer.resize(required_buffer_size);
    }

    // Read new bytes
    std::memcpy(buffer.data(), tmp.data() + token_start, remaining);
    in.read(buffer.data() + remaining, buffer_read_size);
    auto n = in.eof() ? in.gcount() : buffer_read_size;
    buffer_size = remaining + n;

    // Adjust cursor
    token_start = 0;
    buffer_position = remaining;
    return n > 0;
}

void CSVParser::AddValue(std::string_view val, vector<size_t>& escapes) {
    // Skip a single trailing delimiter in last column
    if (options.sql_types.size() > 0 && current_column == options.sql_types.size() && val.length() == 0) {
        return;
    }

    // Dont write the actual data chunks when sniffing the dialect
    if (options.mode == +CSVParserMode::SNIFFING_DIALECT) {
        ++current_column;
        return;
    }

    // More values than types?
    if (current_column >= options.sql_types.size()) {
        FailWith(ErrorCode::CSV_PARSER_ERROR) << "Line " << current_line << ": expected " << options.sql_types.size()
                                              << " values per row, but got more.";
        return;
    }

    // Insert the line number into the chunk
    size_t row_entry = parse_chunk.size();

    // Test against given NULL string
    if (!options.force_not_null[current_column] && (options.null_str == val)) {
        FlatVector::SetNull(parse_chunk.data[current_column], row_entry, true);
    } else {
        auto& v = parse_chunk.data[current_column];
        auto* parse_data = FlatVector::GetData<string_t>(v);
        if (escapes.size() > 0) {
            // Remove escape characters (if any)
            auto old_val = val;
            std::string new_val = "";
            size_t prev_pos = 0;
            for (size_t i = 0; i < escapes.size(); ++i) {
                size_t next_pos = escapes[i];
                new_val += old_val.substr(prev_pos, next_pos - prev_pos);

                if (options.escape.size() == 0 || options.escape == options.quote) {
                    prev_pos = next_pos + options.quote.size();
                } else {
                    prev_pos = next_pos + options.escape.size();
                }
            }

            // Store value
            new_val += old_val.substr(prev_pos, old_val.size() - prev_pos);
            escapes.clear();
            parse_data[row_entry] = StringVector::AddStringOrBlob(v, string_t(new_val));
        } else {
            parse_data[row_entry] = string_t(val.data(), val.length());
        }
    }

    // Move to the next column
    ++current_column;
}

bool CSVParser::AddRow(size_t limit, duckdb::DataChunk* output_chunk) {
    if (error) return true;
    ++current_line;

    if (current_column < options.sql_types.size() && (options.mode != +CSVParserMode::SNIFFING_DIALECT)) {
        FailWith(ErrorCode::CSV_PARSER_ERROR) << "Line " << current_line << ": expected " << options.sql_types.size()
                                              << " values per row, but got " << current_column << ".";
        return true;
    }
    if (options.mode == +CSVParserMode::SNIFFING_DIALECT) {
        column_counts.push_back(current_column);
        if (column_counts.size() == limit) return true;
    } else {
        parse_chunk.SetCardinality(parse_chunk.size() + 1);
    }
    if (options.mode == +CSVParserMode::PARSING_HEADER) return true;
    if (options.mode == +CSVParserMode::SNIFFING_DATATYPES && parse_chunk.size() == limit) return true;
    if (options.mode == +CSVParserMode::PARSING && parse_chunk.size() == limit) {
        Flush(limit, output_chunk);
        return true;
    }
    current_column = 0;
    return false;
}

void CSVParser::Flush(size_t limit, duckdb::DataChunk* output_chunk) {
    if (error || !output_chunk || parse_chunk.size() == 0) return;

    // Convert the columns in the parsed chunk to the types of the table
    output_chunk->SetCardinality(parse_chunk);
    for (idx_t col_idx = 0; col_idx < options.sql_types.size(); col_idx++) {
        if (options.sql_types[col_idx].id() == LogicalTypeId::VARCHAR) {
            // Target type is varchar: no need to convert
            // just test that all strings are valid utf-8 strings
            auto parse_data = FlatVector::GetData<string_t>(parse_chunk.data[col_idx]);
            for (idx_t i = 0; i < parse_chunk.size(); i++) {
                if (!FlatVector::IsNull(parse_chunk.data[col_idx], i)) {
                    auto s = parse_data[i];
                    auto utf_type = Utf8Proc::Analyze(s.GetDataUnsafe(), s.GetSize());
                    if (utf_type == UnicodeType::INVALID) {
                        // XXX
                    }
                }
            }
            output_chunk->data[col_idx].Reference(parse_chunk.data[col_idx]);
        } else {
            try {
                if (options.has_format.count(duckdb::LogicalTypeId::DATE) &&
                    options.sql_types[col_idx].id() == duckdb::LogicalTypeId::DATE) {
                    // Use the date format to cast the chunk
                    auto fmt = options.date_format.at(LogicalTypeId::DATE);
                    UnaryExecutor::Execute<string_t, date_t, true>(
                        parse_chunk.data[col_idx], output_chunk->data[col_idx], parse_chunk.size(),
                        [&](string_t input) { return fmt.ParseDate(input); });
                } else if (options.has_format.count(LogicalTypeId::TIMESTAMP) &&
                           options.sql_types[col_idx].id() == LogicalTypeId::TIMESTAMP) {
                    // Use the date format to cast the chunk
                    auto fmt = options.date_format.at(LogicalTypeId::TIMESTAMP);
                    UnaryExecutor::Execute<string_t, timestamp_t, true>(
                        parse_chunk.data[col_idx], output_chunk->data[col_idx], parse_chunk.size(),
                        [&](string_t input) { return fmt.ParseTimestamp(input); });
                } else {
                    // Target type is not varchar: perform a cast
                    VectorOperations::Cast(parse_chunk.data[col_idx], output_chunk->data[col_idx], parse_chunk.size());
                }
            } catch (const Exception& e) {
                FailWith(ErrorCode::CSV_PARSER_ERROR) << e.what() << " in column " << current_column << " between line "
                                                      << (current_line - parse_chunk.size()) << " and " << current_line;
                return;
            }
        }
    }
    parse_chunk.Reset();
}

/// Constructor
SimpleCSVParser::SimpleCSVParser(const CSVParserOptions& options, std::istream& in) : CSVParser(options, in) {}

/// Move constructor to reuse state
SimpleCSVParser::SimpleCSVParser(SimpleCSVParser&& other, const CSVParserOptions& options, std::istream& in)
    : CSVParser(move(other), options, in) {}

Signal SimpleCSVParser::Parse(size_t limit, duckdb::DataChunk* output_chunk) {
    // Used for parsing algorithm
    bool finished_chunk = false;
    size_t offset = 0;
    std::vector<size_t> escapes;
    Expected<bool> read;

    // Read values into the buffer (if any)
    if (buffer_position >= buffer_size) {
        if (!ReadBuffer()) return ParsingDone();
    }
    // Start parsing the first value
    goto value_start;

value_start:
    // This state parses the first character of a value
    offset = 0;
    if (buffer[buffer_position] == options.quote[0]) {
        // Quote: actual value starts in the next position
        // move to in_quotes state
        token_start = buffer_position + 1;
        goto in_quotes;
    } else {
        // No quote, move to normal parsing state
        token_start = buffer_position;
        goto normal;
    }

normal:
    // This state parses the remainder of a non-quoted value until we reach a delimiter or newline
    do {
        for (; buffer_position < buffer_size; buffer_position++) {
            if (buffer[buffer_position] == options.delimiter[0]) {
                // Delimiter: end the value and add it to the chunk
                goto add_value;
            } else if (is_newline(buffer[buffer_position])) {
                // Newline: add row
                goto add_row;
            }
        }
    } while (ReadBuffer());
    // File ends during normal scan: go to end state
    goto final_state;

add_value:
    AddValue({buffer.data() + token_start, buffer_position - token_start - offset}, escapes);

    // Increase position by 1 and move start to the new position
    offset = 0;
    token_start = ++buffer_position;
    if (error || (buffer_position >= buffer_size && !ReadBuffer())) {
        // File ends right after delimiter, go to final state
        goto final_state;
    }
    goto value_start;

add_row : {
    // Check type of newline (\r or \n)
    bool carriage_return = buffer[buffer_position] == '\r';
    // Add value
    AddValue({buffer.data() + token_start, buffer_position - token_start - offset}, escapes);
    // Add row
    finished_chunk = AddRow(limit, output_chunk);

    // Increase position by 1 and move start to the new position
    offset = 0;
    token_start = ++buffer_position;
    if (error || (buffer_position >= buffer_size && !ReadBuffer())) {
        // file ends right after delimiter, go to final state
        goto final_state;
    }
    if (carriage_return) {
        // \r newline, go to special state that parses an optional \n afterwards
        goto carriage_return;
    } else {
        // \n newline, move to value start
        if (finished_chunk) {
            return ParsingDone();
        }
        goto value_start;
    }
}

in_quotes:
    // This state parses the remainder of a quoted value
    buffer_position++;
    do {
        for (; buffer_position < buffer_size; buffer_position++) {
            if (buffer[buffer_position] == options.quote[0]) {
                // quote: move to unquoted state
                goto unquote;
            } else if (buffer[buffer_position] == options.escape[0]) {
                // escape: store the escaped position and move to handle_escape state
                escapes.push_back(buffer_position - token_start);
                goto handle_escape;
            }
        }
    } while (ReadBuffer());
    // still in quoted state at the end of the file, error:
    return Error(ErrorCode::CSV_PARSER_ERROR) << "Line " << current_line << ": unterminated quotes.";

unquote:
    // This state handles the state directly after we unquote
    // in this state we expect either another quote (entering the quoted state again, and escaping the quote)
    // or a delimiter/newline, ending the current value and moving on to the next value

    buffer_position++;
    if (buffer_position >= buffer_size && !ReadBuffer()) {
        // file ends right after unquote, go to final state
        offset = 1;
        goto final_state;
    }
    if (buffer[buffer_position] == options.quote[0] &&
        (options.escape.size() == 0 || options.escape[0] == options.quote[0])) {
        // escaped quote, return to quoted state and store escape position
        escapes.push_back(buffer_position - token_start);
        goto in_quotes;
    } else if (buffer[buffer_position] == options.delimiter[0]) {
        // delimiter, add value
        offset = 1;
        goto add_value;
    } else if (is_newline(buffer[buffer_position])) {
        offset = 1;
        goto add_row;
    } else {
        return Error(ErrorCode::CSV_PARSER_ERROR)
               << "Line " << current_line
               << ": quote should be followed by end of value, end of row or another quote.";
    }

handle_escape:
    // Escape should be followed by a quote or another escape character

    buffer_position++;
    if (buffer_position >= buffer_size && !ReadBuffer()) {
        return Error(ErrorCode::CSV_PARSER_ERROR)
               << "Line " << current_line << ": neither QUOTE nor ESCAPE is proceeded by ESCAPE.";
    }
    if (buffer[buffer_position] != options.quote[0] && buffer[buffer_position] != options.escape[0]) {
        return Error(ErrorCode::CSV_PARSER_ERROR)
               << "Line " << current_line << ": neither QUOTE nor ESCAPE is proceeded by ESCAPE.";
    }
    // escape was followed by quote or escape, go back to quoted state
    goto in_quotes;

carriage_return:
    // This stage optionally skips a newline (\n) character, which allows \r\n to be interpreted as a single line

    if (buffer[buffer_position] == '\n') {
        // Newline after carriage return: skip
        // increase position by 1 and move start to the new position
        token_start = ++buffer_position;
        if (buffer_position >= buffer_size && !ReadBuffer()) {
            // File ends right after delimiter, go to final state
            goto final_state;
        }
    }
    if (finished_chunk) return ParsingDone();

    goto value_start;

final_state:
    if (finished_chunk) return ParsingDone();
    if (current_column > 0 || buffer_position > token_start) {
        // remaining values to be added to the chunk
        AddValue({buffer.data() + token_start, buffer_position - token_start - offset}, escapes);
        finished_chunk = AddRow(limit, output_chunk);
    }

    /// Final flush
    if (!error && options.mode == +CSVParserMode::PARSING) {
        Flush(limit, output_chunk);
    }
    return ParsingDone();
}

ComplexCSVParser::ComplexCSVParser(const CSVParserOptions& options, std::istream& in) : CSVParser(options, in) {}

ComplexCSVParser::ComplexCSVParser(ComplexCSVParser&& other, const CSVParserOptions& options, std::istream& in)
    : CSVParser(move(other), options, in) {}

Signal ComplexCSVParser::Parse(size_t limit, duckdb::DataChunk* output_chunk) {
    // Used for parsing algorithm
    bool finished_chunk = false;
    vector<size_t> escapes;
    uint8_t delimiter_pos = 0, escape_pos = 0, quote_pos = 0;
    size_t offset = 0;

    // Read values into the buffer (if any)
    if (buffer_position >= buffer_size) {
        if (!ReadBuffer()) return ParsingDone();
    }
    // Start parsing the first value
    token_start = buffer_position;
    goto value_start;

value_start:
    // This state parses the first characters of a value
    offset = 0;
    delimiter_pos = 0;
    quote_pos = 0;
    do {
        size_t count = 0;
        for (; buffer_position < buffer_size; buffer_position++) {
            quote_search.Match(quote_pos, buffer[buffer_position]);
            delimiter_search.Match(delimiter_pos, buffer[buffer_position]);
            count++;
            if (delimiter_pos == options.delimiter.size()) {
                // Found a delimiter, add the value
                offset = options.delimiter.size() - 1;
                goto add_value;
            } else if (is_newline(buffer[buffer_position])) {
                // Found a newline, add the row
                goto add_row;
            }
            if (count > quote_pos) {
                // Did not find a quote directly at the start of the value, stop looking for the quote now
                goto normal;
            }
            if (quote_pos == options.quote.size()) {
                // Found a quote, go to quoted loop and skip the initial quote
                token_start += options.quote.size();
                goto in_quotes;
            }
        }
    } while (ReadBuffer());
    // File ends while scanning for quote/delimiter, go to final state
    goto final_state;

normal:
    // This state parses the remainder of a non-quoted value until we reach a delimiter or newline
    buffer_position++;
    do {
        for (; buffer_position < buffer_size; buffer_position++) {
            delimiter_search.Match(delimiter_pos, buffer[buffer_position]);
            if (delimiter_pos == options.delimiter.size()) {
                offset = options.delimiter.size() - 1;
                goto add_value;
            } else if (is_newline(buffer[buffer_position])) {
                goto add_row;
            }
        }
    } while (ReadBuffer());
    goto final_state;

add_value:
    AddValue({buffer.data() + token_start, buffer_position - token_start - offset}, escapes);

    // Increase position by 1 and move start to the new position
    offset = 0;
    token_start = ++buffer_position;
    if (error || (buffer_position >= buffer_size && !ReadBuffer())) {
        // File ends right after delimiter, go to final state
        goto final_state;
    }
    goto value_start;

add_row : {
    // Check type of newline (\r or \n)
    bool carriage_return = buffer[buffer_position] == '\r';
    // Add value
    AddValue({buffer.data() + token_start, buffer_position - token_start - offset}, escapes);

    // Add row
    finished_chunk = AddRow(limit, output_chunk);
    // Increase position by 1 and move start to the new position
    offset = 0;
    token_start = ++buffer_position;
    if (error || (buffer_position >= buffer_size && !ReadBuffer())) {
        // File ends right after newline, go to final state
        goto final_state;
    }
    if (carriage_return) {
        // \r newline, go to special state that parses an optional \n afterwards
        goto carriage_return;
    } else {
        // \n newline, move to value start
        if (finished_chunk) return ParsingDone();
        goto value_start;
    }
}

in_quotes:
    // This state parses the remainder of a quoted value
    quote_pos = 0;
    escape_pos = 0;
    buffer_position++;
    do {
        for (; buffer_position < buffer_size; buffer_position++) {
            quote_search.Match(quote_pos, buffer[buffer_position]);
            escape_search.Match(escape_pos, buffer[buffer_position]);
            if (quote_pos == options.quote.size()) {
                goto unquote;
            } else if (escape_pos == options.escape.size()) {
                escapes.push_back(buffer_position - token_start - (options.escape.size() - 1));
                goto handle_escape;
            }
        }
    } while (ReadBuffer());

    // Still in quoted state at the end of the file, error:
    return Error(ErrorCode::CSV_PARSER_ERROR) << "Line " << current_line << ": unterminated quote.";

unquote:
    // This state handles the state directly after we unquote
    // in this state we expect either another quote (entering the quoted state again, and escaping the quote)
    // or a delimiter/newline, ending the current value and moving on to the next value
    delimiter_pos = 0;
    quote_pos = 0;
    buffer_position++;
    if (buffer_position >= buffer_size && !ReadBuffer()) {
        // File ends right after unquote, go to final state
        offset = options.quote.size();
        goto final_state;
    }
    if (is_newline(buffer[buffer_position])) {
        // Quote followed by newline, add row
        offset = options.quote.size();
        goto add_row;
    }
    do {
        size_t count = 0;
        for (; buffer_position < buffer_size; buffer_position++) {
            quote_search.Match(quote_pos, buffer[buffer_position]);
            delimiter_search.Match(delimiter_pos, buffer[buffer_position]);
            count++;
            if (count > delimiter_pos && count > quote_pos) {
                return Error(ErrorCode::CSV_PARSER_ERROR)
                       << "Line " << current_line
                       << ": quote should be followed by end of value, end of row or another quote.";
            }
            if (delimiter_pos == options.delimiter.size()) {
                // Quote followed by delimiter, add value
                offset = options.quote.size() + options.delimiter.size() - 1;
                goto add_value;
            } else if (quote_pos == options.quote.size() &&
                       (options.escape.size() == 0 || options.escape == options.quote)) {
                // Quote followed by quote, go back to quoted state and add to escape
                escapes.push_back(buffer_position - token_start - (options.quote.size() - 1));
                goto in_quotes;
            }
        }
    } while (ReadBuffer());

    return Error(ErrorCode::CSV_PARSER_ERROR)
           << "Line " << current_line << ": quote should be followed by end of value, end of row or another quote.";

handle_escape:
    escape_pos = 0;
    quote_pos = 0;
    buffer_position++;
    do {
        size_t count = 0;
        for (; buffer_position < buffer_size; buffer_position++) {
            quote_search.Match(quote_pos, buffer[buffer_position]);
            escape_search.Match(escape_pos, buffer[buffer_position]);
            count++;
            if (count > escape_pos && count > quote_pos) {
                return Error(ErrorCode::CSV_PARSER_ERROR)
                       << "Line " << current_line << ": neither QUOTE nor ESCAPE is proceeded by ESCAPE.";
            }
            if (quote_pos == options.quote.size() || escape_pos == options.escape.size()) {
                // Found quote or escape: move back to quoted state
                goto in_quotes;
            }
        }
    } while (ReadBuffer());

    return Error(ErrorCode::CSV_PARSER_ERROR)
           << "Line " << current_line << ": neither QUOTE nor ESCAPE is proceeded by ESCAPE.";

carriage_return:
    // This stage optionally skips a newline (\n) character, which allows \r\n to be interpreted as a single line
    if (buffer[buffer_position] == '\n') {
        // Newline after carriage return: skip
        token_start = ++buffer_position;
        if (buffer_position >= buffer_size && !ReadBuffer()) {
            // File ends right after newline, go to final state
            goto final_state;
        }
    }
    if (finished_chunk) return ParsingDone();

    goto value_start;

final_state:
    if (finished_chunk) return ParsingDone();
    if (current_column > 0 || buffer_position > token_start) {
        // Remaining values to be added to the chunk
        AddValue({buffer.data() + token_start, buffer_position - token_start - offset}, escapes);
        finished_chunk = AddRow(limit, output_chunk);
    }

    // Final flush
    if (!error && options.mode == +CSVParserMode::PARSING) {
        Flush(limit, output_chunk);
    }
    return ParsingDone();
}

}  // namespace dashql

#include "dashql/extract/csv_parser.h"

#include "dashql/extract/csv_extract.h"
#include "duckdb/common/string_util.hpp"
#include "utf8proc_wrapper.hpp"

using namespace duckdb;

namespace dashql {
namespace {

char is_newline(char c) { return c == '\n' || c == '\r'; }

string GetLineNumberStr(size_t linenr, bool linenr_estimated) {
    string estimated = (linenr_estimated ? string(" (estimated)") : string(""));
    return std::to_string(linenr + 1) + estimated;
}

}  // namespace

Expected<bool> CSVParser::ReadBuffer() {
    std::swap(buffer, tmp);

    // Get the remaining part of the last buffer
    auto remaining = buffer_size - token_start;
    auto buffer_read_size = std::max(buffer.size(), CSV_PARSER_INITIAL_BUFFER_SIZE);
    while (remaining > buffer_read_size) {
        buffer_read_size *= 2;
    }

    // Exceeded maximum line size?
    if ((remaining + buffer_read_size) > CSV_PARSER_MAXIMUM_LINE_SIZE) {
        return Error(ErrorCode::CSV_PARSER_ERROR)
               << "Maximum line size of " << CSV_PARSER_MAXIMUM_LINE_SIZE << "bytes exceeded!";
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

Signal CSVParser::AddValue(std::string_view val, vector<size_t>& escape_positions) {
    // Skip a single trailing delimiter in last column
    if (options.sql_types.size() > 0 && current_column == options.sql_types.size() && val.length() == 0) {
        return Signal::OK();
    }

    // Dont write the actual data chunks when sniffing the dialect
    if (options.mode == CSVParserMode::SNIFFING_DIALECT) {
        current_column++;
        return Signal::OK();
    }

    // More values than types?
    if (current_column >= options.sql_types.size()) {
        return Error(ErrorCode::CSV_PARSER_ERROR)
               << "Line " << GetLineNumberStr() << ": expected " << options.sql_types.size()
               << " values per row, but got more. (" << options.ToString() << ")";
    }

    // Insert the line number into the chunk
    size_t row_entry = parse_chunk.size();

    // Test against given NULL string
    if (!options.force_not_null[current_column] && (options.null_str == val) == 0) {
        FlatVector::SetNull(parse_chunk.data[current_column], row_entry, true);
    } else {
        auto& v = parse_chunk.data[current_column];
        auto parse_data = FlatVector::GetData<string_t>(v);
        if (escape_positions.size() > 0) {
            // Remove escape characters (if any)
            auto old_val = val;
            std::string new_val = "";
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

            // Store value
            new_val += old_val.substr(prev_pos, old_val.size() - prev_pos);
            escape_positions.clear();
            parse_data[row_entry] = StringVector::AddStringOrBlob(v, string_t(new_val));
        } else {
            parse_data[row_entry] = string_t(val.data(), val.length());
        }
    }

    // Move to the next column
    current_column++;
    return Signal::OK();
}

Expected<bool> CSVParser::AddRow(duckdb::DataChunk* output_chunk, size_t output_capacity) {
    current_line++;

    if (current_column < options.sql_types.size() && (options.mode != CSVParserMode::SNIFFING_DIALECT)) {
        throw InvalidInputException("Line %s: expected %lld values per row, but got %d. (%s)",
                                    GetLineNumberStr().c_str(), options.sql_types.size(), options.ToString());
    }
    if (options.mode == CSVParserMode::SNIFFING_DIALECT) {
        column_counts.push_back(current_column);
        if (column_counts.size() == output_capacity) return true;
    } else {
        parse_chunk.SetCardinality(parse_chunk.size() + 1);
    }
    if (options.mode == CSVParserMode::PARSING_HEADER) return true;
    if (options.mode == CSVParserMode::SNIFFING_DATATYPES && parse_chunk.size() == output_capacity) return true;
    if (options.mode == CSVParserMode::PARSING && parse_chunk.size() == output_capacity) {
        Flush(output_chunk, output_capacity);
        return true;
    }
    current_column = 0;
    return false;
}

Signal CSVParser::Flush(duckdb::DataChunk* output_chunk, size_t output_capacity) {
    if (!output_chunk || parse_chunk.size() == 0) return Signal::OK();

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
                string col_name = std::to_string(col_idx);
                // XXX
            }
        }
    }
    parse_chunk.Reset();
    return Signal::OK();
}

Signal SimpleCSVParser::Parse(duckdb::DataChunk* output_chunk, size_t output_capacity) {
    // Used for parsing algorithm
    bool finished_chunk = false;
    size_t offset = 0;
    std::vector<size_t> escape_positions;

    // Read values into the buffer (if any)
    if (buffer_position >= buffer_size) {
        if (!ReadBuffer()) return Signal::OK();
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
    AddValue({buffer.data() + token_start, buffer_position - token_start - offset}, escape_positions);
    // Increase position by 1 and move start to the new position
    offset = 0;
    token_start = ++buffer_position;
    if (buffer_position >= buffer_size && !ReadBuffer()) {
        // File ends right after delimiter, go to final state
        goto final_state;
    }
    goto value_start;

add_row : {
    // Check type of newline (\r or \n)
    bool carriage_return = buffer[buffer_position] == '\r';
    AddValue({buffer.data() + token_start, buffer_position - token_start - offset}, escape_positions);
    finished_chunk = AddRow(output_chunk, output_capacity);

    // Increase position by 1 and move start to the new position
    offset = 0;
    token_start = ++buffer_position;
    if (buffer_position >= buffer_size && !ReadBuffer()) {
        // file ends right after delimiter, go to final state
        goto final_state;
    }
    if (carriage_return) {
        // \r newline, go to special state that parses an optional \n afterwards
        goto carriage_return;
    } else {
        // \n newline, move to value start
        if (finished_chunk) {
            return Signal::OK();
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
                escape_positions.push_back(buffer_position - token_start);
                goto handle_escape;
            }
        }
    } while (ReadBuffer());
    // still in quoted state at the end of the file, error:
    throw InvalidInputException("Line %s: unterminated quotes. (%s)", GetLineNumberStr().c_str(), options.ToString());

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
        escape_positions.push_back(buffer_position - token_start);
        goto in_quotes;
    } else if (buffer[buffer_position] == options.delimiter[0]) {
        // delimiter, add value
        offset = 1;
        goto add_value;
    } else if (is_newline(buffer[buffer_position])) {
        offset = 1;
        goto add_row;
    } else {
        throw InvalidInputException(
            "Line %s: quote should be followed by end of value, end of "
            "row or another quote. (%s)",
            GetLineNumberStr().c_str(), options.ToString());
    }

handle_escape:
    // Escape should be followed by a quote or another escape character

    buffer_position++;
    if (buffer_position >= buffer_size && !ReadBuffer()) {
        throw InvalidInputException("Line %s: neither QUOTE nor ESCAPE is proceeded by ESCAPE. (%s)",
                                    GetLineNumberStr().c_str(), options.ToString());
    }
    if (buffer[buffer_position] != options.quote[0] && buffer[buffer_position] != options.escape[0]) {
        throw InvalidInputException("Line %s: neither QUOTE nor ESCAPE is proceeded by ESCAPE. (%s)",
                                    GetLineNumberStr().c_str(), options.ToString());
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
    if (finished_chunk) return Signal::OK();

    goto value_start;

final_state:
    if (finished_chunk) return Signal::OK();
    if (current_column > 0 || buffer_position > token_start) {
        // remaining values to be added to the chunk
        AddValue({buffer.data() + token_start, buffer_position - token_start - offset}, escape_positions);
        finished_chunk = AddRow(output_chunk, output_capacity);
    }

    /// Final flush
    if (options.mode == CSVParserMode::PARSING) {
        Flush(output_chunk, output_capacity);
    }
    return Signal::OK();
}

Signal ComplexCSVParser::Parse(duckdb::DataChunk* output_chunk, size_t output_capacity) {
    // Used for parsing algorithm
    bool finished_chunk = false;
    vector<size_t> escape_positions;
    uint8_t delimiter_pos = 0, escape_pos = 0, quote_pos = 0;
    size_t offset = 0;

    // Read values into the buffer (if any)
    if (buffer_position >= buffer_size) {
        if (!ReadBuffer()) return Signal::OK();
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
    AddValue({buffer.data() + token_start, buffer_position - token_start - offset}, escape_positions);
    // Increase position by 1 and move start to the new position
    offset = 0;
    token_start = ++buffer_position;
    if (buffer_position >= buffer_size && !ReadBuffer()) {
        // File ends right after delimiter, go to final state
        goto final_state;
    }
    goto value_start;

add_row : {
    // Check type of newline (\r or \n)
    bool carriage_return = buffer[buffer_position] == '\r';
    AddValue({buffer.data() + token_start, buffer_position - token_start - offset}, escape_positions);
    finished_chunk = AddRow(output_chunk, output_capacity);
    // Increase position by 1 and move start to the new position
    offset = 0;
    token_start = ++buffer_position;
    if (buffer_position >= buffer_size && !ReadBuffer()) {
        // File ends right after newline, go to final state
        goto final_state;
    }
    if (carriage_return) {
        // \r newline, go to special state that parses an optional \n afterwards
        goto carriage_return;
    } else {
        // \n newline, move to value start
        if (finished_chunk) return Signal::OK();
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
                escape_positions.push_back(buffer_position - token_start - (options.escape.size() - 1));
                goto handle_escape;
            }
        }
    } while (ReadBuffer());

    // Still in quoted state at the end of the file, error:
    throw InvalidInputException("Line %s: unterminated quotes. (%s)", GetLineNumberStr().c_str(), options.ToString());

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
                throw InvalidInputException(
                    "Line %s: quote should be followed by end of value, end "
                    "of row or another quote. (%s)",
                    GetLineNumberStr().c_str(), options.ToString());
            }
            if (delimiter_pos == options.delimiter.size()) {
                // Quote followed by delimiter, add value
                offset = options.quote.size() + options.delimiter.size() - 1;
                goto add_value;
            } else if (quote_pos == options.quote.size() &&
                       (options.escape.size() == 0 || options.escape == options.quote)) {
                // Quote followed by quote, go back to quoted state and add to escape
                escape_positions.push_back(buffer_position - token_start - (options.quote.size() - 1));
                goto in_quotes;
            }
        }
    } while (ReadBuffer());
    throw InvalidInputException("Line %s: quote should be followed by end of value, end of row or another quote. (%s)",
                                GetLineNumberStr().c_str(), options.ToString());

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
                throw InvalidInputException("Line %s: neither QUOTE nor ESCAPE is proceeded by ESCAPE. (%s)",
                                            GetLineNumberStr().c_str(), options.ToString());
            }
            if (quote_pos == options.quote.size() || escape_pos == options.escape.size()) {
                // Found quote or escape: move back to quoted state
                goto in_quotes;
            }
        }
    } while (ReadBuffer());
    throw InvalidInputException("Line %s: neither QUOTE nor ESCAPE is proceeded by ESCAPE. (%s)",
                                GetLineNumberStr().c_str(), options.ToString());

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
    if (finished_chunk) return Signal::OK();

    goto value_start;

final_state:
    if (finished_chunk) return Signal::OK();
    if (current_column > 0 || buffer_position > token_start) {
        // Remaining values to be added to the chunk
        AddValue({buffer.data() + token_start, buffer_position - token_start - offset}, escape_positions);
        finished_chunk = AddRow(output_chunk, output_capacity);
    }

    // Final flush
    if (options.mode == CSVParserMode::PARSING) {
        Flush(output_chunk, output_capacity);
    }
    return Signal::OK();
}

}  // namespace dashql

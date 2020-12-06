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

bool CSVParser::ReadBuffer() {
    std::swap(buffer, tmp);

    // Get the remaining part of the last buffer
    auto remaining = buffer_size - token_start;
    auto buffer_read_size = std::max(buffer.size(), CSV_EXTRACT_INITIAL_BUFFER_SIZE);
    while (remaining > buffer_read_size) {
        buffer_read_size *= 2;
    }

    // Exceeded maximum line size?
    if ((remaining + buffer_read_size) > CSV_MAXIMUM_LINE_SIZE) {
        throw InvalidInputException("Maximum line size of %llu bytes exceeded!", CSV_MAXIMUM_LINE_SIZE);
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

void CSVParser::AddValue(std::string_view str_val, vector<size_t> &escape_positions) {
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

void SimpleCSVParser::Parse() {
    // Used for parsing algorithm
    bool finished_chunk = false;
    size_t offset = 0;
    std::vector<size_t> escape_positions;

    // Read values into the buffer (if any)
    if (buffer_position >= buffer_size) {
        if (!ReadBuffer()) {
            return;
        }
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
    finished_chunk = AddRow();

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
            return;
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
        // newline after carriage return: skip
        // increase position by 1 and move start to the new position
        token_start = ++buffer_position;
        if (buffer_position >= buffer_size && !ReadBuffer()) {
            // file ends right after delimiter, go to final state
            goto final_state;
        }
    }
    if (finished_chunk) {
        return;
    }
    goto value_start;

final_state:
    if (finished_chunk) {
        return;
    }

    if (current_column > 0 || buffer_position > token_start) {
        // remaining values to be added to the chunk
        AddValue({buffer.data() + token_start, buffer_position - token_start - offset}, escape_positions);
        finished_chunk = AddRow();
    }

    /// Final flush
    Flush();
}

void ComplexCSVParser::Parse() {
    // Used for parsing algorithm
    bool finished_chunk = false;
    vector<size_t> escape_positions;
    uint8_t delimiter_pos = 0, escape_pos = 0, quote_pos = 0;
    size_t offset = 0;

    // Read values into the buffer (if any)
    if (buffer_position >= buffer_size) {
        if (!ReadBuffer()) {
            return;
        }
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
    // increase position by 1 and move start to the new position
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
    finished_chunk = AddRow();
    // increase position by 1 and move start to the new position
    offset = 0;
    token_start = ++buffer_position;
    if (buffer_position >= buffer_size && !ReadBuffer()) {
        // file ends right after newline, go to final state
        goto final_state;
    }
    if (carriage_return) {
        // \r newline, go to special state that parses an optional \n afterwards
        goto carriage_return;
    } else {
        // \n newline, move to value start
        if (finished_chunk) {
            return;
        }
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

    // still in quoted state at the end of the file, error:
    throw InvalidInputException("Line %s: unterminated quotes. (%s)", GetLineNumberStr().c_str(), options.ToString());

unquote:
    // This state handles the state directly after we unquote
    // in this state we expect either another quote (entering the quoted state again, and escaping the quote)
    // or a delimiter/newline, ending the current value and moving on to the next value
    delimiter_pos = 0;
    quote_pos = 0;
    buffer_position++;
    if (buffer_position >= buffer_size && !ReadBuffer()) {
        // file ends right after unquote, go to final state
        offset = options.quote.size();
        goto final_state;
    }
    if (is_newline(buffer[buffer_position])) {
        // quote followed by newline, add row
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
                // quote followed by delimiter, add value
                offset = options.quote.size() + options.delimiter.size() - 1;
                goto add_value;
            } else if (quote_pos == options.quote.size() &&
                       (options.escape.size() == 0 || options.escape == options.quote)) {
                // quote followed by quote, go back to quoted state and add to escape
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
                // found quote or escape: move back to quoted state
                goto in_quotes;
            }
        }
    } while (ReadBuffer());
    throw InvalidInputException("Line %s: neither QUOTE nor ESCAPE is proceeded by ESCAPE. (%s)",
                                GetLineNumberStr().c_str(), options.ToString());

carriage_return:
    // this stage optionally skips a newline (\n) character, which allows \r\n to be interpreted as a single line
    if (buffer[buffer_position] == '\n') {
        // newline after carriage return: skip
        token_start = ++buffer_position;
        if (buffer_position >= buffer_size && !ReadBuffer()) {
            // file ends right after newline, go to final state
            goto final_state;
        }
    }
    if (finished_chunk) {
        return;
    }
    goto value_start;

final_state:
    if (finished_chunk) {
        return;
    }
    if (current_column > 0 || buffer_position > token_start) {
        // remaining values to be added to the chunk
        AddValue({buffer.data() + token_start, buffer_position - token_start - offset}, escape_positions);
        finished_chunk = AddRow();
    }

    // Final flush
    Flush();
}

}  // namespace dashql

#include "dashql/extract/csv_extract.h"
#include "duckdb/common/string_util.hpp"
#include "duckdb/common/types/numeric_helper.hpp"

using namespace duckdb;

namespace dashql {

namespace {

// Helper function to generate column names
string GenerateColumnName(const size_t total_cols, const size_t col_number, const string prefix = "column") {
    int max_digits = NumericHelper::UnsignedLength(total_cols - 1);
    int digits = NumericHelper::UnsignedLength(col_number);
    string leading_zeros = string("0", max_digits - digits);
    string value = std::to_string(col_number);
    return string(prefix + leading_zeros + value);
}

// Helper function to generate the date format string
string GenerateDateFormat(const string &separator, const char *format_template) {
    string format_specifier = format_template;
    for (auto pos = std::find(format_specifier.begin(), format_specifier.end(), '-'); pos != format_specifier.end();
         pos = std::find(pos + separator.size(), format_specifier.end(), '-')) {
        format_specifier.replace(pos, pos + 1, separator);
    }
    return format_specifier;
}

// String starts with a numeric date?
bool StartsWithNumericDate(string &separator, const string_t &value) {
    auto begin = value.GetDataUnsafe();
    auto end = begin + value.GetSize();

    // StrpTimeFormat::Parse will skip whitespace, so we can too
    auto field1 = std::find_if_not(begin, end, StringUtil::CharacterIsSpace);
    if (field1 == end) {
        return false;
    }

    // First numeric field must start immediately
    if (!StringUtil::CharacterIsDigit(*field1)) {
        return false;
    }
    auto literal1 = std::find_if_not(field1, end, StringUtil::CharacterIsDigit);
    if (literal1 == end) {
        return false;
    }

    // Second numeric field must exist
    auto field2 = std::find_if(literal1, end, StringUtil::CharacterIsDigit);
    if (field2 == end) {
        return false;
    }
    auto literal2 = std::find_if_not(field2, end, StringUtil::CharacterIsDigit);
    if (literal2 == end) {
        return false;
    }

    // Third numeric field must exist
    auto field3 = std::find_if(literal2, end, StringUtil::CharacterIsDigit);
    if (field3 == end) {
        return false;
    }

    // Second literal must match first
    if (((field3 - literal2) != (field2 - literal1)) || strncmp(literal1, literal2, (field2 - literal1))) {
        return false;
    }

    // Copy the literal as the separator, escaping percent signs
    separator.clear();
    while (literal1 < field2) {
        const auto literal_char = *literal1++;
        if (literal_char == '%') {
            separator.push_back(literal_char);
        }
        separator.push_back(literal_char);
    }

    return true;
}

}

vector<LogicalType> CSVExtract::SniffCSV(vector<LogicalType> requested_types) {
    for (auto &type : requested_types) {
        // auto detect for blobs not supported: there may be invalid UTF-8 in the file
        if (type.id() == LogicalTypeId::BLOB) {
            return requested_types;
        }
    }

    // -------------------------------------------
    // Detect the CSV dialect

    PrepareCandidateSets();
    CSVExtractOptions original_options = options;
    vector<CSVExtractOptions> info_candidates;
    size_t best_consistent_rows = 0;
    size_t best_num_cols = 0;

    // Check each quote rule
    for (QuoteRule quoterule : quoterule_candidates) {
        auto& quote_candidates = quote_candidates_map[static_cast<uint8_t>(quoterule)];

        // Check each quoting candidate
        for (const auto &quote : quote_candidates) {

            // Check each delimiter candidate
            for (const auto &delim : delim_candidates) {
                auto& escape_candidates = escape_candidates_map[static_cast<uint8_t>(quoterule)];
                for (const auto &escape : escape_candidates) {
                    CSVExtractOptions sniff_info = original_options;
                    sniff_info.delimiter = delim;
                    sniff_info.quote = quote;
                    sniff_info.escape = escape;

                    options = sniff_info;
                    PrepareComplexParser();

                    JumpToBeginning();
                    sniffed_column_counts.clear();
                    try {
                        ParseCSV(ParserMode::SNIFFING_DIALECT);
                    } catch (const InvalidInputException &e) {
                        continue;
                    }

                    size_t start_row = 0;
                    size_t consistent_rows = 0;
                    size_t num_cols = 0;

                    for (size_t row = 0; row < sniffed_column_counts.size(); row++) {
                        if (sniffed_column_counts[row] == num_cols) {
                            consistent_rows++;
                        } else {
                            num_cols = sniffed_column_counts[row];
                            start_row = row;
                            consistent_rows = 1;
                        }
                    }

                    // some logic
                    bool more_values = (consistent_rows > best_consistent_rows && num_cols >= best_num_cols);
                    bool single_column_before = best_num_cols < 2 && num_cols > best_num_cols;
                    bool rows_consistent = start_row + consistent_rows == sniffed_column_counts.size();
                    bool more_than_one_row = (consistent_rows > 1);
                    bool more_than_one_column = (num_cols > 1);
                    bool start_good = info_candidates.size() > 0 && (start_row <= info_candidates.front().skip_rows);

                    if (requested_types.size() > 0 && requested_types.size() != num_cols) {
                        continue;
                    } else if ((more_values || single_column_before) && rows_consistent) {
                        sniff_info.skip_rows = start_row;
                        sniff_info.num_cols = num_cols;
                        best_consistent_rows = consistent_rows;
                        best_num_cols = num_cols;

                        info_candidates.clear();
                        info_candidates.push_back(sniff_info);
                    } else if (more_than_one_row && more_than_one_column && start_good && rows_consistent) {
                        bool same_quote_is_candidate = false;
                        for (auto &info_candidate : info_candidates) {
                            if (quote.compare(info_candidate.quote) == 0) {
                                same_quote_is_candidate = true;
                            }
                        }
                        if (!same_quote_is_candidate) {
                            sniff_info.skip_rows = start_row;
                            sniff_info.num_cols = num_cols;
                            info_candidates.push_back(sniff_info);
                        }
                    }
                }
            }
        }
    }

    // If not dialect candidate was found, then file was most likely empty and we throw an exception
    if (info_candidates.size() < 1) {
        throw InvalidInputException(
            "Error in blob \"%d\": CSV options could not be auto-detected. Consider setting parser options manually.",
            options.blob_id);
    }

    // -------------------------------------------
    // Type detection (initial)

    // Type candidates, ordered by descending specificity (~ from high to low)
    vector<LogicalType> type_candidates = {
        LogicalType::VARCHAR, LogicalType::TIMESTAMP,
        LogicalType::DATE,    LogicalType::TIME,
        LogicalType::DOUBLE,  LogicalType::BIGINT,
        LogicalType::INTEGER, LogicalType::BOOLEAN,
        LogicalType::SQLNULL};

    // Format template candidates, ordered by descending specificity (~ from high to low)
    std::map<LogicalTypeId, vector<const char *>> format_template_candidates = {
        {LogicalTypeId::DATE, {"%m-%d-%Y", "%m-%d-%y", "%d-%m-%Y", "%d-%m-%y", "%Y-%m-%d", "%y-%m-%d"}},
        {LogicalTypeId::TIMESTAMP,
         {"%m-%d-%Y %I:%M:%S %p", "%m-%d-%y %I:%M:%S %p", "%d-%m-%Y %H:%M:%S", "%d-%m-%y %H:%M:%S", "%Y-%m-%d %H:%M:%S",
          "%y-%m-%d %H:%M:%S"}},
    };

    // Check which info candidate leads to minimum amount of non-varchar columns...
    CSVExtractOptions best_options;
    size_t min_varchar_cols = best_num_cols + 1;
    vector<vector<LogicalType>> best_sql_types_candidates;
    std::map<LogicalTypeId, vector<string>> best_format_candidates;
    DataChunk best_header_row;

    for (const auto &t : format_template_candidates) {
        best_format_candidates[t.first].clear();
    }
    for (auto &info_candidate : info_candidates) {
        options = info_candidate;
        vector<vector<LogicalType>> info_sql_types_candidates(options.num_cols, type_candidates);
        std::map<LogicalTypeId, bool> has_format_candidates;
        std::map<LogicalTypeId, vector<string>> format_candidates;
        for (const auto &t : format_template_candidates) {
            has_format_candidates[t.first] = false;
            format_candidates[t.first].clear();
        }

        // Set all sql_types to VARCHAR so we can do datatype detection based on VARCHAR values
        sql_types.clear();
        sql_types.assign(options.num_cols, LogicalType::VARCHAR);

        // Jump to beginning and skip potential header
        JumpToBeginning(options.skip_rows, true);
        DataChunk header_row;
        header_row.Initialize(sql_types);
        parse_chunk.Copy(header_row);

        // Init parse chunk and read csv with info candidate
        InitParseChunk(sql_types.size());
        ParseCSV(ParserMode::SNIFFING_DATATYPES);

        // Scan rows in parse chunk
        for (size_t row_idx = 0; row_idx <= parse_chunk.size(); row_idx++) {
            bool is_header_row = row_idx == 0;
            size_t row = row_idx - 1;

            // Check column with the row
            for (size_t col = 0; col < parse_chunk.ColumnCount(); col++) {
                // Check every type candidate
                auto &col_type_candidates = info_sql_types_candidates[col];
                while (col_type_candidates.size() > 1) {
                    const auto &sql_type = col_type_candidates.back();
                    // Try cast from string to sql_type
                    Value dummy_val;
                    if (is_header_row) {
                        dummy_val = header_row.GetValue(col, 0);
                    } else {
                        dummy_val = parse_chunk.GetValue(col, row);
                    }
                    // Try formatting for date types if the user did not specify one and it starts with numeric values.
                    string separator;
                    if (has_format_candidates.count(sql_type.id()) && !original_options.has_format[sql_type.id()] &&
                        StartsWithNumericDate(separator, dummy_val.str_value)) {
                        // Generate date format candidates the first time through
                        auto &type_format_candidates = format_candidates[sql_type.id()];
                        const auto had_format_candidates = has_format_candidates[sql_type.id()];
                        if (!has_format_candidates[sql_type.id()]) {
                            has_format_candidates[sql_type.id()] = true;
                            // Order by preference
                            for (const auto &t : format_template_candidates[sql_type.id()]) {
                                const auto format_string = GenerateDateFormat(separator, t);
                                // Don't parse ISO 8601
                                if (format_string.find("%Y-%m-%d") == string::npos)
                                    type_format_candidates.emplace_back(format_string);
                            }

                            // Initialise the first candidate
                            options.has_format[sql_type.id()] = true;
                            // All formats are constructed to be valid
                            SetDateFormat(type_format_candidates.back(), sql_type.id());
                        }

                        // Check all formats and keep the first one that works
                        StrpTimeFormat::ParseResult result;
                        auto save_format_candidates = type_format_candidates;
                        while (type_format_candidates.size()) {
                            // Avoid using exceptions for flow control...
                            auto &current_format = options.date_format[sql_type.id()];
                            if (current_format.Parse(dummy_val.str_value, result)) {
                                break;
                            }

                            // Doesn't work - move to the next one
                            type_format_candidates.pop_back();
                            options.has_format[sql_type.id()] = (type_format_candidates.size() > 0);
                            if (type_format_candidates.size() > 0) {
                                SetDateFormat(type_format_candidates.back(), sql_type.id());
                            }
                        }

                        // If none match, then this is not a value of type sql_type,
                        if (!type_format_candidates.size()) {
                            // So restore the candidates that did work.
                            // Or throw them out if they were generated by this value.
                            if (had_format_candidates) {
                                type_format_candidates.swap(save_format_candidates);
                                if (type_format_candidates.size()) {
                                    SetDateFormat(type_format_candidates.back(), sql_type.id());
                                }
                            } else {
                                has_format_candidates[sql_type.id()] = false;
                            }
                        }
                    }

                    // Try cast from string to sql_type
                    if (TryCastValue(dummy_val, sql_type)) {
                        break;
                    } else {
                        col_type_candidates.pop_back();
                    }
                }
            }

            // Reset type detection, because first row could be header,
            // But only do it if csv has more than one line (including header)
            if (parse_chunk.size() > 0 && is_header_row) {
                info_sql_types_candidates = vector<vector<LogicalType>>(options.num_cols, type_candidates);
                for (auto &f : format_candidates) {
                    f.second.clear();
                }
                for (auto &h : has_format_candidates) {
                    h.second = false;
                }
            }
        }

        // Check number of varchar columns
        size_t varchar_cols = 0;
        for (size_t col = 0; col < parse_chunk.ColumnCount(); col++) {
            auto &col_type_candidates = info_sql_types_candidates[col];
            const auto &col_type = col_type_candidates.back();
            if (col_type == LogicalType::VARCHAR) {
                varchar_cols++;
            }
        }

        // It's good if the dialect creates more non-varchar columns, but only if we sacrifice < 30% of best_num_cols.
        if (varchar_cols < min_varchar_cols && parse_chunk.ColumnCount() > (best_num_cols * 0.7)) {
            // We have a new best_options candidate
            best_options = info_candidate;
            min_varchar_cols = varchar_cols;
            best_sql_types_candidates = info_sql_types_candidates;
            best_format_candidates = format_candidates;
            best_header_row.Destroy();
            auto header_row_types = header_row.GetTypes();
            best_header_row.Initialize(header_row_types);
            header_row.Copy(best_header_row);
        }
    }

    options = best_options;
    for (const auto &best : best_format_candidates) {
        if (best.second.size()) {
            SetDateFormat(best.second.back(), best.first);
        }
    }

    // -------------------------------------------
    // Header detection

    // Information for header detection
    bool first_row_consistent = true;
    bool first_row_nulls = false;

    // Check if header row is all null and/or consistent with detected column data types
    first_row_nulls = true;
    for (size_t col = 0; col < best_sql_types_candidates.size(); col++) {
        auto dummy_val = best_header_row.GetValue(col, 0);
        // Try cast as SQLNULL
        try {
            dummy_val.CastAs(LogicalType::SQLNULL, true);
        } catch (const Exception &e) {
            first_row_nulls = false;
        }

        // Try cast to sql_type of column
        const auto &sql_type = best_sql_types_candidates[col].back();
        if (!TryCastValue(dummy_val, sql_type)) {
            first_row_consistent = false;
        }
    }

    // Update parser info, and read, generate & set col_names based on previous findings
    if (((!first_row_consistent || first_row_nulls) && !options.has_header) || (options.has_header && options.header)) {
        options.header = true;
        vector<string> t_col_names;
        for (size_t col = 0; col < options.num_cols; col++) {
            const auto &val = best_header_row.GetValue(col, 0);
            string col_name = val.ToString();
            if (col_name.empty() || val.is_null) {
                col_name = GenerateColumnName(options.num_cols, col);
            }

            // We'll keep column names as they appear in the file, no canonicalization
            // col_name = StringUtil::Lower(col_name);
            t_col_names.push_back(col_name);
        }

        for (size_t col = 0; col < t_col_names.size(); col++) {
            string col_name = t_col_names[col];
            auto exists_n_times = std::count(t_col_names.begin(), t_col_names.end(), col_name);
            auto exists_n_times_before = std::count(t_col_names.begin(), t_col_names.begin() + col, col_name);
            if (exists_n_times > 1) {
                col_name = GenerateColumnName(exists_n_times, exists_n_times_before, col_name + "_");
            }
            col_names.push_back(col_name);
        }

    } else {
        options.header = false;
        auto total_columns = parse_chunk.ColumnCount();
        for (size_t col = 0; col < total_columns; col++) {
            string column_name = GenerateColumnName(total_columns, col);
            col_names.push_back(column_name);
        }
    }

    // -------------------------------------------
    // Type detection (refining)

    // Sql_types and parse_chunk have to be in line with new info
    sql_types.clear();
    sql_types.assign(options.num_cols, LogicalType::VARCHAR);
    vector<LogicalType> detected_types;

    // If data types were provided, exit here if number of columns does not match
    if (requested_types.size() > 0) {
        if (requested_types.size() != options.num_cols) {
            throw InvalidInputException(
                "Error while determining column types: found %lld columns but expected %d. (%s)", options.num_cols,
                requested_types.size(), options.toString());
        } else {
            detected_types = requested_types;
        }
    }

    // ALL_VARCHAR?
    else if (options.all_varchar) {
        // return all types varchar
        detected_types = sql_types;
    }


    // Scan additional samples and refine the sql type guess
    else {
        while (JumpToNextSample()) {
            InitParseChunk(sql_types.size());
            ParseCSV(ParserMode::SNIFFING_DATATYPES);

            // Check all columns of next row
            for (size_t col = 0; col < parse_chunk.ColumnCount(); col++) {
                vector<LogicalType> &col_type_candidates = best_sql_types_candidates[col];

                // Refine column candidates
                while (col_type_candidates.size() > 1) {
                    const auto &sql_type = col_type_candidates.back();
                    // Narrow down the date formats
                    if (best_format_candidates.count(sql_type.id())) {
                        auto &best_type_format_candidates = best_format_candidates[sql_type.id()];
                        auto save_format_candidates = best_type_format_candidates;
                        while (best_type_format_candidates.size()) {
                            if (TryCastVector(parse_chunk.data[col], parse_chunk.size(), sql_type)) {
                                break;
                            }

                            // Doesn't work - move to the next one
                            best_type_format_candidates.pop_back();
                            options.has_format[sql_type.id()] = (best_type_format_candidates.size() > 0);
                            if (best_type_format_candidates.size() > 0) {
                                SetDateFormat(best_type_format_candidates.back(), sql_type.id());
                            }
                        }

                        // If none match, then this is not a column of type sql_type,
                        if (!best_type_format_candidates.size()) {
                            // So restore the candidates that did work.
                            best_type_format_candidates.swap(save_format_candidates);
                            if (best_type_format_candidates.size()) {
                                SetDateFormat(best_type_format_candidates.back(), sql_type.id());
                            }
                        }
                    }

                    if (TryCastVector(parse_chunk.data[col], parse_chunk.size(), sql_type)) {
                        break;
                    } else {
                        col_type_candidates.pop_back();
                    }
                }
            }

            if ((sample_chunk_idx)*options.sample_chunk_size <= options.buffer_size) {
                // Cache parse chunk
                // Create a new chunk and fill it with the remainder
                auto chunk = make_unique<DataChunk>();
                auto parse_chunk_types = parse_chunk.GetTypes();
                chunk->Initialize(parse_chunk_types);
                chunk->Reference(parse_chunk);
                cached_chunks.push(move(chunk));
            }
        }

        // Set sql types
        for (auto &best_sql_types_candidate : best_sql_types_candidates) {
            LogicalType d_type = best_sql_types_candidate.back();
            if (best_sql_types_candidate.size() == type_candidates.size()) {
                d_type = LogicalType::VARCHAR;
            }
            detected_types.push_back(d_type);
        }
    }

    return detected_types;
}

}

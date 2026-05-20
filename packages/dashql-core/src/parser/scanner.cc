#include "dashql/parser/scanner.h"

#include <charconv>

#include "dashql/buffers/index_generated.h"
#include "dashql/exception.h"
#include "dashql/external.h"
#include "dashql/parser/grammar/keywords.h"
#include "dashql/parser/parser.h"
#include "dashql/script.h"
#include "dashql/utils/string_conversion.h"
#include "dashql/utils/string_trimming.h"

using Parser = dashql::parser::Parser;

extern Parser::symbol_type dashql_yylex(void* state);

namespace dashql {
namespace parser {

/// Add an error
void Scanner::AddError(buffers::parser::SymbolSpan location, const char* message) {
    output->errors.push_back({buffers::parser::TextSpan(location.offset(), location.length()), message});
}
/// Add an error
void Scanner::AddError(buffers::parser::SymbolSpan location, std::string&& message) {
    output->errors.push_back({buffers::parser::TextSpan(location.offset(), location.length()), std::move(message)});
}
/// Add a line break
void Scanner::AddLineBreak(buffers::parser::SymbolSpan location) {
    output->line_breaks.push_back(buffers::parser::TextSpan(location.offset(), location.length()));
}
/// Add a comment
void Scanner::AddComment(buffers::parser::SymbolSpan location) {
    output->comments.push_back(buffers::parser::TextSpan(location.offset(), location.length()));
}

/// Read a parameter
Parser::symbol_type Scanner::ReadParameter(buffers::parser::SymbolSpan loc) {
    auto text = GetInputData().substr(loc.offset(), loc.length());
    int64_t value;
    auto result = std::from_chars(text.data(), text.data() + text.size(), value);
    if (result.ec == std::errc::invalid_argument) {
        AddError(loc, "invalid parameter");
    }
    return Parser::make_PARAM(loc);
}

/// Read an integer
Parser::symbol_type Scanner::ReadInteger(buffers::parser::SymbolSpan loc) {
    auto text = GetInputData().substr(loc.offset(), loc.length());
    int64_t value;
    auto result = std::from_chars(text.data(), text.data() + text.size(), value);
    if (result.ec == std::errc::invalid_argument) {
        return Parser::make_FCONST(loc);
    } else {
        return Parser::make_ICONST(loc);
    }
}

/// Read an unquoted identifier
Parser::symbol_type Scanner::ReadIdentifier(buffers::parser::SymbolSpan loc) {
    auto text = GetInputData().substr(loc.offset(), loc.length());
    // Convert to lower-case
    temp_buffer = text;
    bool all_lower = true;
    for (size_t i = 0; i < temp_buffer.size(); ++i) {
        temp_buffer[i] = tolower_fuzzy(temp_buffer[i]);
        all_lower &= temp_buffer[i] == text[i];
    }
    // Check if it's a keyword
    if (auto k = Keyword::Find(temp_buffer); !!k) {
        if (k->category == KeywordCategory::VIS_UNRESERVED) {
            output->name_registry.Register(k->name, buffers::parser::TextSpan(loc.offset(), loc.length()));
        }
        return Parser::symbol_type(k->scanner_token, k->name, loc);
    }
    // Add string to dictionary
    std::string_view owned = text;
    if (!all_lower) {
        owned = output->name_pool.AllocateCopy(temp_buffer);
    }
    size_t id = output->name_registry.Register(owned, buffers::parser::TextSpan(loc.offset(), loc.length())).name_id;
    return Parser::make_IDENT(id, loc);
}
/// Read a double quoted identifier
Parser::symbol_type Scanner::ReadDoubleQuotedIdentifier(buffers::parser::SymbolSpan loc) {
    auto text = GetInputData().substr(loc.offset(), loc.length());
    // Trim spaces & quotes
    auto trimmed = trim_view_right(text, is_no_space);
    trimmed = trim_view(trimmed, is_no_double_quote);
    // Add string to dictionary
    size_t id = output->name_registry.Register(trimmed, buffers::parser::TextSpan(loc.offset(), loc.length())).name_id;
    return Parser::make_IDENT(id, loc);
}
/// Read a backtick quoted identifier
Parser::symbol_type Scanner::ReadBacktickQuotedIdentifier(buffers::parser::SymbolSpan loc) {
    auto text = GetInputData().substr(loc.offset(), loc.length());
    auto trimmed = trim_view_right(text, is_no_space);
    trimmed = trim_view(trimmed, is_no_backtick);
    size_t id = output->name_registry.Register(trimmed, buffers::parser::TextSpan(loc.offset(), loc.length())).name_id;
    return Parser::make_IDENT(id, loc);
}

/// Read a string literal
Parser::symbol_type Scanner::ReadStringLiteral(buffers::parser::SymbolSpan loc) {
    auto text = GetInputData().substr(loc.offset(), loc.length());
    auto trimmed = trim_view_right(text, is_no_space);
    return Parser::make_SCONST(sx::parser::SymbolSpan(loc.offset(), trimmed.size()));
}
/// Read a hex string literal
Parser::symbol_type Scanner::ReadHexStringLiteral(buffers::parser::SymbolSpan loc) {
    auto text = GetInputData().substr(loc.offset(), loc.length());
    auto trimmed = trim_view_right(text, is_no_space);
    return Parser::make_XCONST(sx::parser::SymbolSpan(loc.offset(), trimmed.size()));
}
/// Read a bit string literal
Parser::symbol_type Scanner::ReadBitStringLiteral(buffers::parser::SymbolSpan loc) {
    auto text = GetInputData().substr(loc.offset(), loc.length());
    auto trimmed = trim_view_right(text, is_no_space);
    return Parser::make_BCONST(sx::parser::SymbolSpan(loc.offset(), trimmed.size()));
}

/// Scan input and produce all tokens
std::shared_ptr<ScannedScript> Scanner::Scan(const rope::Rope& text, TextVersion text_version,
                                             CatalogEntryID external_id) {
    // Function to get next token
    auto next = [](void* scanner_state_ptr, std::optional<Parser::symbol_type>& lookahead_symbol) {
        // Have lookahead?
        Parser::symbol_type current_symbol;
        if (lookahead_symbol) {
            current_symbol.move(*lookahead_symbol);
            lookahead_symbol.reset();
        } else {
            auto t = dashql_yylex(scanner_state_ptr);
            current_symbol.move(t);
        }

        // Requires additional lookahead?
        switch (current_symbol.kind()) {
            case Parser::symbol_kind::S_NOT:
            case Parser::symbol_kind::S_NULLS_P:
            case Parser::symbol_kind::S_WITH:
                break;
            default:
                return current_symbol;
        }

        // Get next token
        auto next_symbol = dashql_yylex(scanner_state_ptr);
        auto next_symbol_kind = next_symbol.kind();
        lookahead_symbol.emplace(std::move(next_symbol));

        // Should replace current token?
        switch (current_symbol.kind()) {
            case Parser::symbol_kind::S_NOT:
                // Replace NOT by NOT_LA if it's followed by BETWEEN, IN, etc
                switch (next_symbol_kind) {
                    case Parser::symbol_kind::S_BETWEEN:
                    case Parser::symbol_kind::S_IN_P:
                    case Parser::symbol_kind::S_LIKE:
                    case Parser::symbol_kind::S_ILIKE:
                    case Parser::symbol_kind::S_SIMILAR:
                        return Parser::make_NOT_LA(current_symbol.location);
                    default:
                        break;
                }
                break;

            case Parser::symbol_kind::S_NULLS_P:
                // Replace NULLS_P by NULLS_LA if it's followed by FIRST or LAST
                switch (next_symbol_kind) {
                    case Parser::symbol_kind::S_FIRST_P:
                    case Parser::symbol_kind::S_LAST_P:
                        return Parser::make_NULLS_LA(current_symbol.location);
                    default:
                        break;
                }
                break;
            case Parser::symbol_kind::S_WITH:
                // Replace WITH by WITH_LA if it's followed by TIME or ORDINALITY
                switch (next_symbol_kind) {
                    case Parser::symbol_kind::S_TIME:
                    case Parser::symbol_kind::S_ORDINALITY:
                        return Parser::make_WITH_LA(current_symbol.location);
                    default:
                        break;
                }
                break;
            default:
                break;
        }
        return current_symbol;
    };

    // Create the scanner
    Scanner scanner{text, text_version, external_id};
    // Collect all tokens until we hit EOF
    std::optional<Parser::symbol_type> lookahead_symbol;
    while (true) {
        auto token = next(scanner.scanner_state_ptr, lookahead_symbol);
        scanner.output->symbols.PushBack(token);
        if (token.kind() == Parser::symbol_kind::S_YYEOF) break;
    }

    // Collect scanner output
    return std::move(scanner.output);
}

}  // namespace parser
}  // namespace dashql

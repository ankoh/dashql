// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_SCANNER_H_
#define INCLUDE_DASHQL_PARSER_SCANNER_H_

#include <string_view>
#include <charconv>
#include <optional>
#include "dashql/parser/common/span.h"
#include "dashql/parser/parser.h"
#include "dashql/parser/proto/syntax_generated.h"

namespace sx = dashql::proto::syntax;

namespace dashql {
namespace parser {

class ParserDriver;

constexpr size_t YY_SCANNER_STATE_SIZE = 200;
constexpr size_t YY_BUFFER_STATE_SIZE = 144;

/// XXX Note that flex requires the input to be padded with 2 additional characters to match YY_END_OF_BUFFER.
///     This scanner will blindly overwrite these last two characters and fall back to an empty buffer if the size of the input is < 2.
class Scanner {
    protected:
    /// The full input buffer
    nonstd::span<char> _input_buffer;
    /// The invalid input buffer
    std::array<char, 2> _null_buffer;

    /// The scanner state
    std::array<char, YY_SCANNER_STATE_SIZE> _scanner_state_mem;
    /// The scanner buffer stack
    std::array<void*, 1> _scanner_buffer_stack;
    /// The buffer state
    std::array<char, YY_BUFFER_STATE_SIZE> _buffer_state_mem;
    /// The address of the scanner state
    void* _scanner_state_ptr;
    /// The address of the buffer state
    void* _buffer_state_ptr;

    /// The begin of the comment
    sx::Location _comment_begin;
    /// The comment depth
    int _comment_depth;
    /// The begin of the literal
    sx::Location _literal_begin;

    /// The scanner errors
    std::vector<std::pair<sx::Location, std::string>> _errors;
    /// The line breaks
    std::vector<sx::Location> _line_breaks;
    /// The comments
    std::vector<sx::Location> _comments;

    public:
    /// Constructor
    Scanner(nonstd::span<char> input);
    /// Destructor
    ~Scanner();
    /// Delete the copy constructor
    Scanner(const Scanner& other) = delete;
    /// Delete the copy assignment
    Scanner& operator=(const Scanner& other) = delete;

    /// Access the scanner state pointer
    auto* state() { return _scanner_state_ptr; } 
    /// Access the input
    std::string_view input_text() { return std::string_view{_input_buffer.data(), _input_buffer.size() - 2}; }

    /// Get the text at location
    inline std::string_view TextAt(sx::Location loc) {
        return input_text().substr(loc.offset(), loc.length());
    }
    /// Begin a literal
    inline void BeginLiteral(sx::Location loc) { _literal_begin = loc; }
    /// End a literal
    inline sx::Location EndLiteral(sx::Location loc) {
        return sx::Location(_literal_begin.offset(), loc.offset() + loc.length() - _literal_begin.offset());
    }
    /// Begin a comment
    inline void BeginComment(sx::Location loc) {
        if (_comment_depth++ == 0) {
            _comment_begin = loc;
        }
    }
    /// End a comment
    inline std::optional<sx::Location> EndComment(sx::Location loc) {
        if (--_comment_depth == 0) {
            return sx::Location(_literal_begin.offset(), loc.offset() + loc.length() - _literal_begin.offset());
        }
        return std::nullopt;
    }

    /// Add an error
    void AddError(sx::Location location, const char* message);
    /// Add an error
    void AddError(sx::Location location, std::string&& message);
    /// Add a line break
    void AddLineBreak(sx::Location location);
    /// Add a comment
    void AddComment(sx::Location location);

    /// Read a parameter
    Parser::symbol_type ReadParameter(sx::Location loc);
    /// Read an integer
    Parser::symbol_type ReadInteger(sx::Location loc);
};

} // namespace parser
} // namespace dashql

#endif // INCLUDE_DASHQL_PARSER_PARSER_DRIVER_H_

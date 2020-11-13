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
    /// The buffer state
    std::array<char, YY_BUFFER_STATE_SIZE> _scanner_buffer_state_mem;
    /// The scanner buffer stack
    std::array<void*, 2> _scanner_buffer_stack;
    /// The address of the scanner state
    void* _scanner_state_ptr;

    /// The lookahead token (if any)
    std::optional<Parser::symbol_type> _lookahead_token;

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
    /// Delete the copy constructor
    Scanner(const Scanner& other) = delete;
    /// Delete the copy assignment
    Scanner& operator=(const Scanner& other) = delete;

    /// Get the scanner state pointer
    auto* state() { return _scanner_state_ptr; } 
    /// Get the errors
    auto& errors() { return _errors; } 
    /// Get the line breaks
    auto& line_breaks() { return _line_breaks; } 
    /// Get the comments
    auto& comments() { return _comments; } 
    /// Access the input
    std::string_view input_text() {
        assert(_input_buffer.size() >= 2);
        return std::string_view{_input_buffer.data(), _input_buffer.size() - 2}; }

    /// Get the text at location
    std::string_view TextAt(sx::Location loc);

    /// Begin a literal
    void BeginLiteral(sx::Location loc);
    /// End a literal
    sx::Location EndLiteral(sx::Location loc);

    /// Begin a comment
    void BeginComment(sx::Location loc);
    /// End a comment
    std::optional<sx::Location> EndComment(sx::Location loc);

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

    /// Get the next symbol
    Parser::symbol_type Next();
};

} // namespace parser
} // namespace dashql

#endif // INCLUDE_DASHQL_PARSER_PARSER_DRIVER_H_

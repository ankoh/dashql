// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_SCANNER_H_
#define INCLUDE_DASHQL_PARSER_SCANNER_H_

#include <charconv>
#include <optional>
#include <string_view>
#include <unordered_set>

#include "dashql/parser/parser.h"
#include "dashql/proto_generated.h"
#include "nonstd/span.h"

namespace dashql {
namespace parser {

class ParserDriver;

constexpr size_t YY_SCANNER_STATE_SIZE = 200;
constexpr size_t YY_BUFFER_STATE_SIZE = 144;

/// XXX Note that flex requires the input to be padded with 2 additional characters to match YY_END_OF_BUFFER.
///     This scanner will blindly overwrite these last two characters and fall back to an empty buffer if the size of
///     the input is < 2.
class Scanner {
   protected:
    /// The full input buffer
    nonstd::span<char> input_buffer_;
    /// The invalid input buffer
    std::array<char, 2> null_buffer_ = {};

    /// The scanner state
    std::array<char, YY_SCANNER_STATE_SIZE> scanner_state_mem_ = {};
    /// The buffer state
    std::array<char, YY_BUFFER_STATE_SIZE> scanner_buffer_state_mem_ = {};
    /// The scanner buffer stack
    std::array<void*, 2> scanner_buffer_stack_ = {};
    /// The address of the scanner state
    void* scanner_state_ptr_ = nullptr;

    /// The begin of the comment
    sx::Location comment_begin_ = sx::Location();
    /// The comment depth
    int comment_depth_ = 0;
    /// The begin of the literal
    sx::Location literal_begin_ = sx::Location();

    /// The scanner errors
    std::vector<std::pair<sx::Location, std::string>> errors_ = {};
    /// The line breaks
    std::vector<sx::Location> line_breaks_ = {};
    /// The comments
    std::vector<sx::Location> comments_ = {};
    /// The dson keys
    std::unordered_set<size_t> dson_key_offsets_ = {};

    /// All symbols
    std::vector<Parser::symbol_type> symbols_ = {};
    /// All symbols linebreaks
    std::vector<size_t> symbol_line_breaks_ = {};
    /// The next symbol index
    size_t next_symbol_index_ = 0;

   public:
    /// Constructor
    Scanner(nonstd::span<char> input);
    /// Delete the copy constructor
    Scanner(const Scanner& other) = delete;
    /// Delete the copy assignment
    Scanner& operator=(const Scanner& other) = delete;

    /// Scan entire input and produce all tokens
    void Produce();

    /// Get the scanner state pointer
    auto* state() { return scanner_state_ptr_; }
    /// Get the errors
    auto& errors() { return errors_; }
    /// Get the line breaks
    auto& line_breaks() { return line_breaks_; }
    /// Get the comments
    auto& comments() { return comments_; }
    /// Get the dson key offsets
    auto& dson_key_offsets() { return dson_key_offsets_; }
    /// Access the input
    std::string_view input_text() {
        assert(input_buffer_.size() >= 2);
        return std::string_view{input_buffer_.data(), input_buffer_.size() - 2};
    }

    /// Release the line breaks
    auto&& ReleaseLineBreaks() { return move(line_breaks_); }
    /// Release the comments
    auto&& ReleaseComments() { return move(comments_); }
    /// Pack syntax highlighting
    std::unique_ptr<proto::syntax::HighlightingT> BuildHighlighting();

    /// Get the text at location
    std::string_view TextAt(sx::Location loc);
    /// The the location of a text
    sx::Location LocationOf(std::string_view text);

    /// Begin a literal
    void BeginLiteral(sx::Location loc);
    /// End a literal
    sx::Location EndLiteral(sx::Location loc, bool trim_right = false);

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
    /// Mark as option key
    void MarkAsDSONKey(sx::Location location);

    /// Read a parameter
    Parser::symbol_type ReadParameter(sx::Location loc);
    /// Read an integer
    Parser::symbol_type ReadInteger(sx::Location loc);

    /// Get the next symbol
    Parser::symbol_type Next();
};

}  // namespace parser
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_PARSER_DRIVER_H_

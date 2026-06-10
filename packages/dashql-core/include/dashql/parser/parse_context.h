#pragma once

#include <initializer_list>
#include <span>
#include <string>
#include <utility>
#include <vector>

#include "dashql/buffers/index_generated.h"
#include "dashql/parser/parser.h"
#include "dashql/script.h"
#include "dashql/utils/chunk_buffer.h"
#include "dashql/utils/temp_allocator.h"

namespace dashql {

class ScannedScript;
class ParsedScript;

namespace parser {

class ParseContext {
    friend class ::dashql::ParsedScript;
    friend class ::dashql::parser::Parser;

   protected:
    /// The scanner
    ScannedScript& program;
    /// The symbol iterator
    ChunkBuffer<Parser::symbol_type>::ConstTupleIterator symbol_iterator;

    /// The nodes
    ChunkBuffer<buffers::parser::Node> nodes;
    /// The statements
    std::vector<ParsedScript::Statement> statements;
    /// The errors
    std::vector<ParseError> errors;
    /// Symbol indices of vis spec keys (for token type remapping)
    std::vector<uint32_t> vis_key_symbols;
    /// Hint produced by `Parser::yysyntax_error_` and consumed by the next `Parser::error` call.
    /// Lives here (not on the Parser) so the const-qualified `yysyntax_error_` can write through
    /// the non-const `ctx` reference without needing a mutable Parser member.
    std::string pending_hint;

    /// The current statement
    ParsedScript::Statement current_statement;
    /// The temporary node lists
    NodeList::ListPool temp_lists;
    /// The temporary node list elements
    NodeList::ListElementPool temp_list_elements;
    /// The temporary nary expression nodes
    TempNodePool<NAryExpression, 16> temp_nary_expressions;

    /// Is the VISUALISE syntax enabled?
    bool enable_vis_syntax;

   public:
    /// Constructor
    explicit ParseContext(ScannedScript& scan, bool enable_vis_syntax = true);
    /// Destructor
    ~ParseContext();

    /// Get the program
    auto& GetProgram() { return program; };
    /// Is the VISUALISE syntax enabled?
    bool IsVisEnabled() const { return enable_vis_syntax; }
    /// Get the symbol iterator
    inline auto& GetSymbolIterator() const { return symbol_iterator; }
    /// Rewind the scanner to a previously captured position. Used by the suffix probe to re-read
    /// the post-cursor token after injecting a synthetic candidate keyword.
    inline void RewindScanner(ChunkBuffer<Parser::symbol_type>::ConstTupleIterator iter,
                              uint32_t token_index) {
        symbol_iterator = iter;
        next_token_index = token_index;
    }
    /// The current token index (incremented each time NextSymbol returns a token)
    uint32_t next_token_index = 0;
    /// Get next symbol
    inline Parser::symbol_type NextSymbol() {
        if (symbol_iterator.IsAtEnd()) {
            return parser::Parser::make_EOF(buffers::parser::SymbolSpan(next_token_index, 0));
        }
        Parser::symbol_type sym = *symbol_iterator;
        sym.location = buffers::parser::SymbolSpan(next_token_index, 1);
        ++next_token_index;
        ++symbol_iterator;
        return sym;
    }

    /// Create a list
    BackedUniquePtr<NodeList> List(std::initializer_list<buffers::parser::Node> nodes = {});
    /// Add a an array
    buffers::parser::Node Array(buffers::parser::SymbolSpan loc, BackedUniquePtr<NodeList>&& values,
                                bool null_if_empty = true, bool shrink_location = false);
    /// Add a an array
    buffers::parser::Node Array(buffers::parser::SymbolSpan loc, std::span<ExpressionVariant> values,
                                bool null_if_empty = true, bool shrink_location = false);
    /// Add a an array
    inline buffers::parser::Node Array(buffers::parser::SymbolSpan loc,
                                       std::initializer_list<buffers::parser::Node> values, bool null_if_empty = true,
                                       bool shrink_location = false) {
        return Array(loc, List(std::move(values)), null_if_empty, shrink_location);
    }
    /// Add an object
    buffers::parser::Node Object(buffers::parser::SymbolSpan loc, buffers::parser::NodeType type,
                                 BackedUniquePtr<NodeList>&& attrs, bool null_if_empty = true,
                                 bool shrink_location = false);
    /// Add a an object
    inline buffers::parser::Node Object(buffers::parser::SymbolSpan loc, buffers::parser::NodeType type,
                                        std::initializer_list<buffers::parser::Node> values = {},
                                        bool null_if_empty = true, bool shrink_location = false) {
        return Object(loc, type, List(std::move(values)), null_if_empty, shrink_location);
    }
    /// Add an expression
    buffers::parser::Node Expression(ExpressionVariant&& expr);
    /// Flatten an expression
    std::optional<ExpressionVariant> TryMerge(buffers::parser::SymbolSpan loc, buffers::parser::Node opNode,
                                              std::span<ExpressionVariant> args);

    /// Create a name from a keyword
    buffers::parser::Node NameFromKeyword(buffers::parser::SymbolSpan loc, std::string_view text);
    /// Create a name from a string literal
    buffers::parser::Node NameFromStringLiteral(buffers::parser::SymbolSpan loc);
    /// Mark a trailing dot
    buffers::parser::Node TrailingDot(buffers::parser::SymbolSpan loc);

    /// Read a float type
    buffers::parser::NumericType ReadFloatType(buffers::parser::SymbolSpan bitsLoc);

    /// Add a node
    NodeID AddNode(buffers::parser::Node node);
    /// Add an error
    void AddError(buffers::parser::SymbolSpan loc, const std::string& message, std::string hint = {});
    /// Add a statement
    void AddStatement(buffers::parser::Node node);
    /// Reset a statement
    void ResetStatement();
    /// Mark a symbol as a vis spec key
    void MarkVisKey(buffers::parser::SymbolSpan loc) {
        for (uint32_t i = 0; i < loc.length(); ++i) {
            vis_key_symbols.push_back(loc.offset() + i);
        }
    }
};

}  // namespace parser
}  // namespace dashql

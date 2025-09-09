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
    std::vector<std::pair<buffers::parser::Location, std::string>> errors;

    /// The current statement
    ParsedScript::Statement current_statement;
    /// The temporary node lists
    NodeList::ListPool temp_lists;
    /// The temporary node list elements
    NodeList::ListElementPool temp_list_elements;
    /// The temporary nary expression nodes
    TempNodePool<NAryExpression, 16> temp_nary_expressions;

   public:
    /// Constructor
    explicit ParseContext(ScannedScript& scan);
    /// Destructor
    ~ParseContext();

    /// Get the program
    auto& GetProgram() { return program; };
    /// Get the symbol iterator
    inline auto& GetSymbolIterator() const { return symbol_iterator; }
    /// Get next symbol
    inline Parser::symbol_type NextSymbol() {
        if (symbol_iterator.IsAtEnd()) {
            return parser::Parser::make_EOF({static_cast<uint32_t>(program.text_buffer.size()), 0});
        }
        Parser::symbol_type sym = *symbol_iterator;
        ++symbol_iterator;
        return sym;
    }

    /// Create a list
    WeakUniquePtr<NodeList> List(std::initializer_list<buffers::parser::Node> nodes = {});
    /// Add a an array
    buffers::parser::Node Array(buffers::parser::Location loc, WeakUniquePtr<NodeList>&& values,
                                bool null_if_empty = true, bool shrink_location = false);
    /// Add a an array
    buffers::parser::Node Array(buffers::parser::Location loc, std::span<ExpressionVariant> values,
                                bool null_if_empty = true, bool shrink_location = false);
    /// Add a an array
    inline buffers::parser::Node Array(buffers::parser::Location loc,
                                       std::initializer_list<buffers::parser::Node> values, bool null_if_empty = true,
                                       bool shrink_location = false) {
        return Array(loc, List(std::move(values)), null_if_empty, shrink_location);
    }
    /// Add an object
    buffers::parser::Node Object(buffers::parser::Location loc, buffers::parser::NodeType type,
                                 WeakUniquePtr<NodeList>&& attrs, bool null_if_empty = true,
                                 bool shrink_location = false);
    /// Add a an object
    inline buffers::parser::Node Object(buffers::parser::Location loc, buffers::parser::NodeType type,
                                        std::initializer_list<buffers::parser::Node> values = {},
                                        bool null_if_empty = true, bool shrink_location = false) {
        return Object(loc, type, List(std::move(values)), null_if_empty, shrink_location);
    }
    /// Add an expression
    buffers::parser::Node Expression(ExpressionVariant&& expr);
    /// Flatten an expression
    std::optional<ExpressionVariant> TryMerge(buffers::parser::Location loc, buffers::parser::Node opNode,
                                              std::span<ExpressionVariant> args);

    /// Create a name from a keyword
    buffers::parser::Node NameFromKeyword(buffers::parser::Location loc, std::string_view text);
    /// Create a name from a string literal
    buffers::parser::Node NameFromStringLiteral(buffers::parser::Location loc);
    /// Mark a trailing dot
    buffers::parser::Node TrailingDot(buffers::parser::Location loc);

    /// Read a float type
    buffers::parser::NumericType ReadFloatType(buffers::parser::Location bitsLoc);

    /// Add a node
    NodeID AddNode(buffers::parser::Node node);
    /// Add an error
    void AddError(buffers::parser::Location loc, const std::string& message);
    /// Add a statement
    void AddStatement(buffers::parser::Node node);
    /// Reset a statement
    void ResetStatement();
};

}  // namespace parser
}  // namespace dashql

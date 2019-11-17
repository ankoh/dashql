//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_PARSER_TQL_TQL_PARSE_CONTEXT_H_
#define INCLUDE_TIGON_PARSER_TQL_TQL_PARSE_CONTEXT_H_

#include "tigon/parser/tql/tql_syntax.h"
#include <map>
#include <memory>
#include <stack>
#include <string>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>

namespace tigon {
namespace tql {

// Schema parse context
class ParseContext {
    friend class Parser;

  protected:
    /// Trace the scanning
    bool trace_scanning;
    /// Trace the parsing
    bool trace_parsing;
    /// The statements
    std::vector<Statement> statements;

    /// The cached values
    std::tuple<
        std::unique_ptr<VizStatement::Axis>,
        std::unique_ptr<VizStatement::LayoutLength>,
        std::unique_ptr<VizStatement>,
        std::unique_ptr<ExtractStatement>,
        std::unique_ptr<LoadStatement::FileLoader>,
        std::unique_ptr<LoadStatement::HTTPLoader>,
        std::unique_ptr<LoadStatement>,
        std::unique_ptr<ParameterDeclaration>
    > cache;

    /// Get a cached value
    template <typename T>
    std::unique_ptr<T>& cached() {
        auto& c = std::get<std::unique_ptr<T>>(cache);
        if (!c) {
            c = std::make_unique<T>();
        }
        return c;
    }

    /// Begin a scan
    void beginScan(std::string_view in);
    /// End a scan
    void endScan();

  public:
    /// Constructor
    explicit ParseContext(bool trace_scanning = false, bool trace_parsing = false);
    /// Destructor
    virtual ~ParseContext();

    /// Parse an istream
    Module Parse(std::string_view in);

    /// Throw an error
    void Error(uint32_t line, uint32_t column, const std::string &err);
    /// Throw an error
    void Error(const std::string &m);

    /// Define a statement
    void DefineStatement(Statement statement);
};

} // namespace tql
} // namespace tigon

#endif // INCLUDE_TIGON_PARSER_TQL_TQL_PARSE_CONTEXT_H_


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

    /// The current display statement
    std::unique_ptr<DisplayStatement> display;

    /// Begin a scan
    void beginScan(std::istream &in);
    /// End a scan
    void endScan();

    /// Define a layout width
    void setDisplayLayoutWidth(std::unique_ptr<DisplayStatement::LayoutLength> width);
    /// Define a layout height
    void setDisplayLayoutHeight(std::unique_ptr<DisplayStatement::LayoutLength> height);

  public:
    /// Constructor
    explicit ParseContext(bool trace_scanning = false, bool trace_parsing = false);
    /// Destructor
    virtual ~ParseContext();

    /// Parse an istream
    Program Parse(std::istream &in);

    /// Throw an error
    void Error(uint32_t line, uint32_t column, const std::string &err);
    /// Throw an error
    void Error(const std::string &m);
};

} // namespace tql
} // namespace tigon

#endif // INCLUDE_TIGON_PARSER_TQL_TQL_PARSE_CONTEXT_H_


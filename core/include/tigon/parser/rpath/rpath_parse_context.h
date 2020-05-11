//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_PARSER_RPATH_RPATH_PARSE_CONTEXT_H_
#define INCLUDE_TIGON_PARSER_RPATH_RPATH_PARSE_CONTEXT_H_

#include "tigon/parser/rpath/rpath_syntax.h"
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
namespace rpath {

// Schema parse context
class ParseContext {
    friend class Parser;

  protected:
    /// Trace the scanning
    bool trace_scanning;
    /// Trace the parsing
    bool trace_parsing;

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
    std::unique_ptr<RPath> Parse(std::string_view in);

    /// Throw an error
    void Error(uint32_t line, uint32_t column, const std::string &err);
    /// Throw an error
    void Error(const std::string &m);
};

} // namespace rpath
} // namespace tigon

#endif // INCLUDE_TIGON_PARSER_RPATH_RPATH_PARSE_CONTEXT_H_


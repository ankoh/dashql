// ---------------------------------------------------------------------------------------------------
// Tigon
// ---------------------------------------------------------------------------------------------------
#ifndef INCLUDE_TIGON_PARSER_QL_QL_PARSE_CONTEXT_H_
#define INCLUDE_TIGON_PARSER_QL_QL_PARSE_CONTEXT_H_
// ---------------------------------------------------------------------------------------------------
#include <map>
#include <memory>
#include <stack>
#include <string>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <vector>
// ---------------------------------------------------------------------------------------------------
namespace tigon {
namespace ql {
// ---------------------------------------------------------------------------------------------------
struct Parser;
// ---------------------------------------------------------------------------------------------------
struct LoadStatement {
};
// ---------------------------------------------------------------------------------------------------
struct ExtractStatement {
};
// ---------------------------------------------------------------------------------------------------
// Schema parse context
class ParseContext {
    friend Parser;

 public:
    // Constructor
    explicit ParseContext(bool trace_scanning = false, bool trace_parsing = false);
    // Destructor
    virtual ~ParseContext();

    // Parse an istream
    Schema Parse(std::istream &in);

    // Throw an error
    void Error(uint32_t line, uint32_t column, const std::string &err);
    // Throw an error
    void Error(const std::string &m);

 private:
    // Begin a scan
    void beginScan(std::istream &in);
    // End a scan
    void endScan();

    // Define a table
    void defineFoo(const std::string &id, const std::vector<SomeDeclaration> &declarations);
    // TODO

    // Trace the scanning
    bool trace_scanning_;
    // Trace the parsing
    bool trace_parsing_;
};
// ---------------------------------------------------------------------------------------------------
}  // namespace schemac
}  // namespace imlab
// ---------------------------------------------------------------------------------------------------
#endif  // INCLUDE_TIGON_PARSER_QL_QL_PARSE_CONTEXT_H_
// ---------------------------------------------------------------------------------------------------



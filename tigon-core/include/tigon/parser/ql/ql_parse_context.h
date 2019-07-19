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
#include <variant>

namespace tigon {
namespace ql {

struct Parser;

/// A type
enum class Type {
    Integer,
    Float,
    Text,
    Date,
    DateTime,
    Time
};

/// A raw sql statement
struct SQLStatement {
    /// The sql text
    std::string_view text;
};

/// A parameter declaration
struct ParameterDeclaration {
    /// The parameter name
    std::string_view name;
    /// The type
    Type type;
    /// The default value
    std::string_view default_value;
};

/// An output definiton
struct OutputDefinition {
    /// The output name
    std::string_view name;
    /// The sql statement
    SQLStatement statement;
};

/// A http loader
struct HTTPLoader {
    /// A paramter 
    struct Parameter {
        /// The key
        std::string_view key;
        /// The value
        std::string_view value;
    };

    /// The parameters
    std::vector<Parameter> parameters;
};

/// A file loader
struct FileLoader {};

using LoadMethod = std::variant<HTTPLoader, FileLoader>;

/// A load statement
struct LoadStatement {
    /// The name
    std::string_view name;
    /// The method
    LoadMethod method;
};

/// An extractor that uses Jsonpath
struct JSONPathExtractor {
    /// The column definition
    struct ColumnDefinition {
        /// The name
        std::string_view name;
        /// The json path
        std::string_view json_path;
        /// The type
        Type type;
    };

    /// The columns
    std::vector<ColumnDefinition> columns;
};

/// An extractor that uses CSV
struct CSVExtractor {
    /// The column definition
    struct ColumnDefinition {
        /// The name
        std::string_view name;
        /// The index within the csv
        unsigned index;
        /// The type
        Type type;
    };

    /// The columns
    std::vector<ColumnDefinition> columns;
};

using ExtractMethod = std::variant<JSONPathExtractor, CSVExtractor>;

/// An extract statement
struct ExtractStatement {
    /// The target
    std::string_view name;
    /// The source
    std::string_view source;
    /// The method
    ExtractMethod method;
};

/// A statement
using Statement = std::variant<
    ExtractStatement,
    LoadStatement,
    OutputDefinition,
    ParameterDeclaration
>;

/// A program
struct Program {
    /// The statements
    std::vector<Statement> statements;
};

// Schema parse context
class ParseContext {
    friend Parser;

 public:
    // Constructor
    explicit ParseContext(bool trace_scanning = false, bool trace_parsing = false);
    // Destructor
    virtual ~ParseContext();

    // Parse an istream
    Program Parse(std::istream &in);

    // Throw an error
    void Error(uint32_t line, uint32_t column, const std::string &err);
    // Throw an error
    void Error(const std::string &m);

 private:
    // Begin a scan
    void beginScan(std::istream &in);
    // End a scan
    void endScan();

    // Define statements
    void defineStatements(std::vector<Statement>&& statements);

    // Trace the scanning
    bool trace_scanning_;
    // Trace the parsing
    bool trace_parsing_;
};

}  // namespace schemac
}  // namespace imlab

#endif  // INCLUDE_TIGON_PARSER_QL_QL_PARSE_CONTEXT_H_



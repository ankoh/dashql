// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_SYNTAX_H_
#define INCLUDE_DASHQL_PARSER_SYNTAX_H_

#include <map>
#include <memory>
#include <optional>
#include <stack>
#include <string>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>

namespace dashql {
namespace parser {

/// A location within the program text
struct Location {
    /// A position
    struct Position {
        /// The line
        uint32_t line;
        /// The column
        uint32_t column;
    };

    /// The starting position
    Position begin;
    /// The finishing position
    Position end;
};

struct StringLiteral {
    /// The location
    Location location;
    /// The string
    std::string string;
};

struct BooleanLiteral {
    /// The location
    Location location;
    /// The boolean
    bool boolean;
};

/// A parameter type
struct ParameterType {
    enum class Type { Integer, Float, Text, Date, DateTime, Time, File };

    /// The location
    Location location;
    /// The type
    Type type;
};

/// A parameter declaration
struct ParameterDeclaration {
    /// The location
    Location location;
    /// The parameter name
    StringLiteral name;
    /// The parameter label
    StringLiteral label;
    /// The parameter type
    ParameterType type;
};

/// A variable
struct Variable {
    /// The location
    Location location;
    /// The variable name
    StringLiteral name;
};

/// A raw sql statement
struct QueryStatement {
    /// The location
    Location location;
    /// The query name (if any)
    std::optional<StringLiteral> name;
    /// The query text
    StringLiteral query_text;
};

/// A load statement
struct LoadStatement {
    /// A HTTP loader
    struct HTTPLoader {
        /// A HTTP method
        struct Method {
            /// A HTTP verb
            enum class Verb { Get, Put, Post };

            /// The location
            Location location;
            /// The HTTP verb
            Verb verb;
        };

        /// An URL
        struct URL {
            /// The location
            Location location;
            /// The url
            StringLiteral url;
        };

        using Attribute = std::variant<Method, URL>;

        /// Attributes
        struct Attributes {
            /// The location
            Location location;
            /// The attributes
            std::vector<Attribute> attributes;
        };

        /// The location
        Location location;
        /// The attributes
        std::optional<Attributes> attributes;
    };

    /// A file loader
    struct FileLoader {
        /// The location
        Location location;
        /// The variable
        Variable variable;
    };

    using LoadMethod = std::variant<HTTPLoader, FileLoader>;

    /// The location
    Location location;
    /// The name
    StringLiteral name;
    /// The method
    LoadMethod method;
};

/// An extract statement
struct ExtractStatement {
    /// An extractor that uses JSONPath
    struct JSONPathExtract {
        /// The location
        Location location;
    };

    /// An extractor that uses CSV
    struct CSVExtract {
        /// An encoding
        struct Encoding {
            /// The location
            Location location;
            /// The encoding
            StringLiteral encoding;
        };

        /// A header
        struct Header {
            /// The location
            Location location;
            /// The header
            std::variant<BooleanLiteral, std::vector<StringLiteral>> header;
        };

        /// A delimiter
        struct Delimiter {
            /// The location
            Location location;
            /// The delimiter
            StringLiteral delimiter;
        };

        /// A quote
        struct Quote {
            /// The location
            Location location;
            /// The quote
            StringLiteral quote;
        };

        /// A date format
        struct DateFormat {
            /// The location
            Location location;
            /// The date format
            StringLiteral date_format;
        };

        /// A timestamp format
        struct TimestampFormat {
            /// The location
            Location location;
            /// The timestamp format
            StringLiteral timestamp_format;
        };

        using Attribute = std::variant<Encoding, Header, Delimiter, Quote, DateFormat, TimestampFormat>;

        /// Attributes
        struct Attributes {
            /// The location
            Location location;
            /// The attributes
            std::vector<Attribute> attributes;
        };

        /// The location
        Location location;
        /// The attributes
        std::optional<Attributes> attributes;
    };

    using ExtractMethod = std::variant<JSONPathExtract, CSVExtract>;

    /// The location
    Location location;
    /// The name
    StringLiteral name;
    /// The data name
    StringLiteral data_name;
    /// The method
    ExtractMethod method;
};

/// A viz statement
struct VizStatement {
    /// A viz type
    struct VizType {
        /// A type
        enum class Type { Area = 0, Bar = 1, Box = 2, Bubble = 3, Grid = 4, Histogram = 5, Line = 6, Number = 7, Pie = 8, Point = 9, Scatter = 10, Table = 11, Text = 12 };

        /// The location
        Location location;
        /// The type
        Type type;
    };

    /// Get the type name
    const char* getTypeName();

    /// The location
    Location location;
    /// The name
    StringLiteral name;
    /// The query name
    StringLiteral query_name;
    /// The viz type
    VizType viz_type;
};

/// A statement
using Statement = std::variant<ParameterDeclaration, ExtractStatement, LoadStatement, QueryStatement, VizStatement>;

/// An error
struct Error {
    /// The location
    Location location;
    /// The message
    const std::string message;
};

/// A module
struct Program {
    /// The statements
    std::vector<Statement> statements;
    /// The errors
    std::vector<Error> errors;
};

} // namespace parser
} // namespace dashql

#endif // INCLUDE_DASHQL_PARSER_SYNTAX_H_

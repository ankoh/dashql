//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_PARSER_TQL_TQL_SYNTAX_H_
#define INCLUDE_TIGON_PARSER_TQL_TQL_SYNTAX_H_

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

/// A type
enum class Type { Integer, Float, Text, Date, DateTime, Time };

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

/// A load statement
struct LoadStatement {
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

    /// The name
    std::string_view name;
    /// The method
    LoadMethod method;
};

/// An extract statement
struct ExtractStatement {
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

    /// The target
    std::string_view name;
    /// The source
    std::string_view source;
    /// The method
    ExtractMethod method;
};

struct DisplayStatement {
    /// A length unit
    enum LengthUnit : uint8_t {
        Span = 0,
        Pixel = 1,
        Percent = 2,
    };

    /// A layout class
    enum SizeClass {
        Wildcard,
        Small,
        Medium,
        Large,
        ExtraLarge,
    };

    /// A length value
    struct LengthValue {
        /// The length
        uint16_t value;
        /// The unit
        LengthUnit unit;
        /// Is set?
        bool is_set;

        /// Constructor
        LengthValue()
            : value(), unit(), is_set(false) {}

        /// Set the value
        void set(uint16_t v, LengthUnit u = LengthUnit::Span) {
            value = v;
            unit = u;
            is_set = true;
        }

        /// Set the default value
        void setDefault(uint16_t v, LengthUnit u = LengthUnit::Span) {
            if (is_set)
                return;
            value = v;
            unit = u;
        }

        /// Get the value
        std::pair<uint16_t, LengthUnit> get() { return { value, unit }; }
    };

    /// A layout length
    struct LayoutLength {
        /// Small displays
        LengthValue sm;
        /// Medium displays
        LengthValue md;
        /// Large displays
        LengthValue lg;
        /// Extra large displays
        LengthValue xl;

        /// Constructor
        LayoutLength()
            :sm(), md(), lg(), xl() {}

        /// Set the default value
        void setDefault(uint16_t value, LengthUnit unit = LengthUnit::Span) {
            sm.setDefault(value, unit);
            md.setDefault(value, unit);
            lg.setDefault(value, unit);
            xl.setDefault(value, unit);
        };
    };

    /// A layout
    struct Layout {
        /// The width
        LayoutLength width;
        /// The height
        LayoutLength height;
    };

    /// The scale of an axis
    enum AxisScale : uint8_t {
        Linear = 0,
        Logarithmic = 1,
    };

    /// An axis
    struct Axis {
        /// The column
        std::string_view column;
        /// The scale
        AxisScale scale;
    };

    /// The axes
    struct Axes {
        /// X-axis
        Axis x;
        /// Y-axis
        Axis y;
    };
};

/// A statement
using Statement = std::variant<ExtractStatement, LoadStatement, ParameterDeclaration>;

/// A program
struct Program {
    /// The statements
    std::vector<Statement> statements;
};

} // namespace tql
} // namespace tigon

#endif // INCLUDE_TIGON_PARSER_TQL_TQL_SYNTAX_H_


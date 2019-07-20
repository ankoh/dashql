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
};

/// A load statement
struct LoadStatement {
    /// A http loader
    struct HTTPLoader {
        /// A http method
        enum class Method {
            Get,
            Put,
            Post
        };

        /// A URL
        std::string_view url;
        /// A method
        Method method;
    };

    /// A file loader
    struct FileLoader {};

    using LoadMethod = std::variant<
        std::unique_ptr<HTTPLoader>,
        std::unique_ptr<FileLoader>
    >;

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
    /// A type
    enum class Type {
        Area,
        Bar,
        Box,
        Bubble,
        Grid,
        Histogram,
        Line,
        Number,
        Pie,
        Point,
        Scatter,
        Table,
        Text
    };

    /// Type flags
    enum class TypeFlag: uint64_t {
        None = 0,
        Horizontal = 1,
        Vertical = 1 << 1,
        Stacked = 1 << 2,
    };

    /// A rgb color
    struct RGBColor {
        /// The red color
        uint8_t red;
        /// The green color
        uint8_t green;
        /// The blue color
        uint8_t blue;

        /// Constructor
        RGBColor() : red(), green(), blue() {}
        /// Constructor
        RGBColor(uint8_t r, uint8_t g, uint8_t b) : red(r), green(g), blue(b) {}
        /// Constructor
        RGBColor(uint32_t rgb)
            : red(static_cast<uint8_t>(rgb & 0xFF)),
            green(static_cast<uint8_t>((rgb >> 8) & 0xFF)),
            blue(static_cast<uint8_t>((rgb >> 16) & 0xFF)) {}
    };

    /// A display color
    struct Color {
        /// The column
        std::string_view column;
        /// The palette
        std::vector<RGBColor> palette;
    };

    /// A length unit
    enum class LengthUnit : uint8_t {
        Span = 0,
        Pixel = 1,
        Percent = 2,
    };

    /// A layout class
    enum class SizeClass {
        Wildcard,
        Small,
        Medium,
        Large,
        ExtraLarge,
    };

    /// A length value
    struct LengthValue {
        /// The length
        uint32_t value;
        /// The unit
        LengthUnit unit;
        /// Is set?
        bool is_set;

        /// Constructor
        LengthValue() : value(), unit(), is_set(false) {}

        /// Set the value
        void set(uint32_t v, LengthUnit u = LengthUnit::Span) {
            value = v;
            unit = u;
            is_set = true;
        }

        /// Set the default value
        void setDefault(uint32_t v, LengthUnit u = LengthUnit::Span) {
            if (is_set)
                return;
            value = v;
            unit = u;
        }

        /// Get the value
        std::pair<uint32_t, LengthUnit> get() { return {value, unit}; }
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
        LayoutLength() : sm(), md(), lg(), xl() {}

        /// Set a value
        void set(SizeClass size, uint32_t value, LengthUnit unit) {
            switch (size) {
            case SizeClass::Wildcard:
                sm.setDefault(value, unit);
                md.setDefault(value, unit);
                lg.setDefault(value, unit);
                xl.setDefault(value, unit);
                break;
            case SizeClass::Small:
                sm.setDefault(value, unit);
                break;
            case SizeClass::Medium:
                md.setDefault(value, unit);
                break;
            case SizeClass::Large:
                lg.setDefault(value, unit);
                break;
            case SizeClass::ExtraLarge:
                xl.setDefault(value, unit);
                break;
            }
        }
    };

    /// A layout
    struct Layout {
        /// The width
        std::unique_ptr<LayoutLength> width;
        /// The height
        std::unique_ptr<LayoutLength> height;
    };

    /// The scale of an axis
    enum class AxisScale : uint8_t {
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
        std::unique_ptr<Axis> x;
        /// Y-axis
        std::unique_ptr<Axis> y;
    };

    /// The target
    std::string_view target;
    /// The type
    Type type;
    /// The type flags
    uint64_t type_flags;
    /// The layout
    Layout layout;
    /// The color
    Color color;
    /// The axes
    Axes axes;
};

/// A statement
using Statement = std::variant<
    std::unique_ptr<DisplayStatement>,
    std::unique_ptr<ExtractStatement>,
    std::unique_ptr<LoadStatement>,
    std::unique_ptr<ParameterDeclaration>,
    std::unique_ptr<SQLStatement>
>;

/// A program
struct Program {
    /// The statements
    std::vector<Statement> statements;
};

} // namespace tql
} // namespace tigon

#endif // INCLUDE_TIGON_PARSER_TQL_TQL_SYNTAX_H_


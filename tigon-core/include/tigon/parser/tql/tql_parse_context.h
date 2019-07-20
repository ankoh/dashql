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

    /// The current display layout
    std::unique_ptr<DisplayStatement::LayoutLength> displayLayoutLength;
    /// The current display statement
    std::unique_ptr<DisplayStatement> display;

    /// Begin a scan
    void beginScan(std::istream &in);
    /// End a scan
    void endScan();

    /// Finish layout length
    auto finishDisplayLayoutLength() {
        auto result = std::move(displayLayoutLength);
        displayLayoutLength = std::make_unique<DisplayStatement::LayoutLength>();
        return result;
    }
    /// Set a layout length field
    void setDisplayLayoutLengthField(DisplayStatement::SizeClass size, uint32_t value, DisplayStatement::LengthUnit unit) {
        switch (size) {
            case DisplayStatement::SizeClass::Wildcard:
                displayLayoutLength->setDefault(value, unit);
                break;
            case DisplayStatement::SizeClass::Small:
                displayLayoutLength->sm.setDefault(value, unit);
                break;
            case DisplayStatement::SizeClass::Medium:
                displayLayoutLength->md.setDefault(value, unit);
                break;
            case DisplayStatement::SizeClass::Large:
                displayLayoutLength->lg.setDefault(value, unit);
                break;
            case DisplayStatement::SizeClass::ExtraLarge:
                displayLayoutLength->xl.setDefault(value, unit);
                break;
        }
    }
    /// Set a color column
    void setDisplayColorColumn(std::string_view column) {
        display->color.column = column;
    }
    /// Set a color palette
    void setDisplayColorPalette(std::vector<DisplayStatement::RGBColor> colors) {
        display->color.palette = std::move(colors);
    }
    /// Set a layout width
    void setDisplayLayoutWidth(std::unique_ptr<DisplayStatement::LayoutLength> width) {
        display->layout.width = std::move(width);
    }
    /// Set a layout height
    void setDisplayLayoutHeight(std::unique_ptr<DisplayStatement::LayoutLength> height) {
        display->layout.height = std::move(height);
    }

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


#pragma once

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <initializer_list>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

#include "dashql/buffers/index_generated.h"

namespace dashql {

constexpr size_t FORMATTING_DEFAULT_INDENTATION_WIDTH = 2;
constexpr size_t FORMATTING_DEFAULT_HANGING_INDENTATION_WIDTH = 2;
constexpr size_t FORMATTING_DEFAULT_MAX_WIDTH = 120;

/// Parse formatting mode from string
inline constexpr buffers::formatting::FormattingMode ParseFormattingMode(std::string_view value) {
    if (value == "inline") return buffers::formatting::FormattingMode::INLINE;
    if (value == "compact") return buffers::formatting::FormattingMode::COMPACT;
    if (value == "pretty") return buffers::formatting::FormattingMode::PRETTY;
    return buffers::formatting::FormattingMode::COMPACT;
}

/// Return the string name for a formatting mode
inline constexpr std::string_view FormattingModeToString(buffers::formatting::FormattingMode mode) {
    switch (mode) {
        case buffers::formatting::FormattingMode::INLINE:
            return "inline";
        case buffers::formatting::FormattingMode::COMPACT:
            return "compact";
        case buffers::formatting::FormattingMode::PRETTY:
            return "pretty";
    }
    return "compact";
}

/// Parse formatting dialect from string
inline constexpr buffers::formatting::FormattingDialect ParseFormattingDialect(std::string_view value) {
    if (value == "duckdb") return buffers::formatting::FormattingDialect::DUCKDB;
    return buffers::formatting::FormattingDialect::DUCKDB;
}

/// Return the string name for a formatting dialect
inline constexpr std::string_view FormattingDialectToString(buffers::formatting::FormattingDialect dialect) {
    switch (dialect) {
        case buffers::formatting::FormattingDialect::DUCKDB:
            return "duckdb";
    }
    return "duckdb";
}

using FmtReg = uint32_t;

enum class FormattingOpCode : uint8_t { Empty, Text, Break, Concat, Join, Indent, Parenthesis };
enum class FormattingJoinPolicy : uint8_t {
    /// Render inline only if the entire join can be rendered without breaks.
    BreakAllOrNone,
    /// Render progressively: keep each separator inline while the next segment fits.
    BreakOnOverflow,
    /// Always render this join broken unless global INLINE mode forces flat output.
    ForceBreak,
};
enum class FormattingParenthesisMode : uint8_t {
    BreakAndIndent,
    Inline,
};

struct FormattingOperation {
    FormattingOpCode code = FormattingOpCode::Empty;
    std::string_view text = {};
    std::vector<FmtReg> children = {};
    FmtReg inline_separator = 0;
    FmtReg break_separator = 0;
    bool indent_after_break = false;
    FormattingJoinPolicy join_policy = FormattingJoinPolicy::BreakAllOrNone;
    FormattingParenthesisMode parenthesis_mode = FormattingParenthesisMode::Inline;
};

struct FormattingRenderOptions {
    size_t max_width = FORMATTING_DEFAULT_MAX_WIDTH;
    size_t indentation_width = FORMATTING_DEFAULT_INDENTATION_WIDTH;
    bool debug_mode = false;
    buffers::formatting::FormattingMode mode = buffers::formatting::FormattingMode::COMPACT;
};

/// A small document arena for width-aware SQL layout.
struct FormattingProgram {
    buffers::formatting::FormattingConfigT config;
    std::vector<FormattingOperation> program;

    FormattingProgram() {
        config.mode = buffers::formatting::FormattingMode::COMPACT;
        Reset();
    }

    void SetConfig(const buffers::formatting::FormattingConfigT& value) { config = value; }

    void Reset() {
        program.clear();
        program.push_back(FormattingOperation{.code = FormattingOpCode::Empty});
    }

    FmtReg Empty() const { return 0; }

    FmtReg Text(std::string_view text) {
        return Push(FormattingOperation{
            .code = FormattingOpCode::Text,
            .text = text,
        });
    }

    FmtReg Break(bool indent_after_break = false) {
        return Push(FormattingOperation{
            .code = FormattingOpCode::Break,
            .indent_after_break = indent_after_break,
        });
    }

    FmtReg BreakIndented() { return Break(true); }

    FmtReg Concat(std::initializer_list<FmtReg> parts) { return Concat(std::vector<FmtReg>(parts)); }

    FmtReg Concat(std::vector<FmtReg> parts) {
        size_t write = 0;
        for (size_t read = 0; read < parts.size(); ++read) {
            if (parts[read] != 0) parts[write++] = parts[read];
        }
        parts.resize(write);
        if (parts.empty()) return Empty();
        if (parts.size() == 1) return parts.front();
        return Push(FormattingOperation{
            .code = FormattingOpCode::Concat,
            .children = std::move(parts),
        });
    }

    FmtReg Indented(FmtReg child) {
        if (child == 0) return Empty();
        return Push(FormattingOperation{
            .code = FormattingOpCode::Indent,
            .children = {child},
        });
    }

    FmtReg Parenthesized(FmtReg child, std::optional<FormattingParenthesisMode> mode = std::nullopt) {
        if (child == 0) return Empty();
        auto selected_mode = mode.value_or(config.mode == buffers::formatting::FormattingMode::PRETTY
                                               ? FormattingParenthesisMode::BreakAndIndent
                                               : FormattingParenthesisMode::Inline);
        return Push(FormattingOperation{
            .code = FormattingOpCode::Parenthesis,
            .children = {child},
            .parenthesis_mode = selected_mode,
        });
    }

    FmtReg Join(std::span<const FmtReg> items, FmtReg inline_separator, FmtReg break_separator,
                std::optional<FormattingJoinPolicy> join_policy = std::nullopt) {
        std::vector<FmtReg> filtered;
        filtered.reserve(items.size());
        for (auto item : items) {
            if (item != 0) filtered.push_back(item);
        }
        if (filtered.empty()) return Empty();
        if (filtered.size() == 1) return filtered.front();
        auto selected_policy = join_policy.value_or(config.mode == buffers::formatting::FormattingMode::PRETTY
                                                        ? FormattingJoinPolicy::BreakAllOrNone
                                                        : FormattingJoinPolicy::BreakOnOverflow);
        return Push(FormattingOperation{
            .code = FormattingOpCode::Join,
            .children = std::move(filtered),
            .inline_separator = inline_separator,
            .break_separator = break_separator,
            .join_policy = selected_policy,
        });
    }

    std::string Render(FmtReg root, const FormattingRenderOptions& options) const;

   private:
    FmtReg Push(FormattingOperation doc) {
        program.push_back(std::move(doc));
        return static_cast<FmtReg>(program.size() - 1);
    }
};

}  // namespace dashql

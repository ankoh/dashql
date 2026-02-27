#pragma once

#include <cassert>
#include <cstddef>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace dashql {

constexpr size_t FORMATTING_DEFAULT_INDENTATION_WIDTH = 2;
constexpr size_t FORMATTING_DEFAULT_HANGING_INDENTATION_WIDTH = 2;
constexpr size_t FORMATTING_DEFAULT_MAX_WIDTH = 128;

/// A formatting mode
enum class FormattingMode : uint8_t {
    Inline = 0b1,
    Compact = 0b10,
    Pretty = 0b100,
};

/// Parse formatting mode from string
inline constexpr FormattingMode ParseFormattingMode(std::string_view value) {
    if (value == "inline") return FormattingMode::Inline;
    if (value == "compact") return FormattingMode::Compact;
    if (value == "pretty") return FormattingMode::Pretty;
    return FormattingMode::Compact;
}

/// Return the string name for a formatting mode
inline constexpr std::string_view FormattingModeToString(FormattingMode mode) {
    switch (mode) {
        case FormattingMode::Inline:
            return "inline";
        case FormattingMode::Compact:
            return "compact";
        case FormattingMode::Pretty:
            return "pretty";
    }
    return "compact";
}

/// A formatting config
struct FormattingConfig {
    /// The mode
    FormattingMode mode = FormattingMode::Compact;
    /// What's our max-width that we want to render
    size_t max_width = FORMATTING_DEFAULT_MAX_WIDTH;
    /// How many characters are used for an indentation level?
    size_t indentation_width = FORMATTING_DEFAULT_INDENTATION_WIDTH;
};

/// A line break
enum LineBreakTag { LineBreak };
/// A indentation
struct Indent {
    /// The level
    size_t level = 0;
    /// The indentation width
    size_t indentation_width = 0;
    /// Constructor
    explicit Indent(size_t level = 0, size_t indentation_width = 0)
        : level(level), indentation_width(indentation_width) {}
    /// Constructor
    explicit Indent(FormattingConfig config) : level(0), indentation_width(config.indentation_width) {}
    /// Get the size
    size_t GetSize() const { return level * indentation_width; }
    /// Arithmentic to bump the level
    Indent operator+(size_t n) const { return Indent{level + n, indentation_width}; }
};

/// A formatting entry
template <typename T>
using FormattingEntry = std::variant<std::string_view, Indent, LineBreakTag, std::reference_wrapper<const T>>;
/// A formatting target base concept
template <typename T>
concept FormattingTarget =
    requires(T t, const T ct, std::string_view s, LineBreakTag lb, Indent indent, std::reference_wrapper<const T> x,
             size_t initial_offset, std::optional<size_t> maybe_offset, FormattingMode mode) {
        { t << s } -> std::same_as<T&>;
        { t << lb } -> std::same_as<T&>;
        { t << indent } -> std::same_as<T&>;
        { t << x } -> std::same_as<T&>;
        { t << std::tuple{indent, s, lb, x} } -> std::same_as<T&>;

        { t << std::optional{s} } -> std::same_as<T&>;
        { t << std::optional{lb} } -> std::same_as<T&>;
        { t << std::optional{indent} } -> std::same_as<T&>;
        { t << std::optional{x} } -> std::same_as<T&>;

        { t.Configure(mode, indent, maybe_offset) } -> std::same_as<T&>;
        { ct.GetLineWidth() } -> std::convertible_to<std::optional<size_t>>;
        { ct.GetIndent() } -> std::convertible_to<Indent>;
    };

/// A formatting buffer that collects output
struct FormattingBuffer {
    /// The entries
    std::vector<FormattingEntry<FormattingBuffer>> entries;
    /// The selected mode
    FormattingMode mode = FormattingMode::Inline;
    /// The indentation of this component
    Indent indent;
    /// The current offset. (if known)
    /// By default, we don't know.
    std::optional<size_t> offset = std::nullopt;
    /// The current line width. (if known)
    /// By default, we know it's 0.
    std::optional<size_t> line_width = 0;
    /// The number of line breaks. (if known)
    /// By default, we know there are 0.
    std::optional<size_t> line_breaks = 0;
    /// The number of characters that this node contributed.
    /// Not counting characters by referenced child buffers.
    size_t contributed_chars = 0;

    /// Configure the buffer
    FormattingBuffer& Configure(FormattingMode m, Indent i, std::optional<size_t> ofs) {
        mode = m;
        indent = i;
        offset = ofs;
        return *this;
    }
    /// Get the indentation
    Indent GetIndent() const { return indent; }
    /// Get the current line width
    std::optional<size_t> GetLineWidth() const {
        if (!line_width.has_value()) {
            return (line_breaks.value_or(1) == 0) ? (offset.value_or(0) + *line_width) : *line_width;
        } else {
            return std::nullopt;
        }
    }
    /// Append a string view
    FormattingBuffer& operator<<(std::string_view s) {
        if (line_width.has_value()) {
            *line_width += s.size();
        }
        contributed_chars += s.size();
        entries.push_back(s);
        return *this;
    }
    /// Append an indentation
    FormattingBuffer& operator<<(Indent i) {
        if (line_width.has_value()) {
            *line_width += indent.GetSize();
        }
        contributed_chars += indent.GetSize();
        entries.push_back(indent);
        return *this;
    }
    /// Append an indentation
    FormattingBuffer& operator<<(LineBreakTag lb) {
        if (line_width.has_value()) {
            line_width = 0;
        }
        if (line_breaks.has_value()) {
            *line_breaks += 1;
        }
        contributed_chars += 1;
        entries.push_back(lb);
        return *this;
    }
    /// Append another formatting buffer
    FormattingBuffer& operator<<(std::reference_wrapper<const FormattingBuffer> other) {
        // Try to track when rendering inline
        if (other.get().mode == FormattingMode::Inline) {
            // Other knows it's line width?
            // Then just add
            if (line_width.has_value()) {
                *line_width += other.get().line_width.value_or(0);
            }
            // Other has line breaks or does not know?
            // Then reset our line break assumption as well
            if (other.get().line_breaks.value_or(1) > 0) {
                line_breaks.reset();
            }

        } else {
            // Otherwise, stop assuming anything about line width and breaks.
            // The other buffer might decide to break, we just don't know.
            line_width.reset();
            line_breaks.reset();
        }
        entries.push_back(other);
        return *this;
    }
    /// Apply an optional value
    template <typename V> FormattingBuffer& operator<<(std::optional<V> v) {
        if (v.has_value()) {
            return *this << v;
        }
        return *this;
    }
    /// Apply a parameter pack
    template <typename... Vs> FormattingBuffer& operator<<(std::tuple<Vs...> v) {
        std::apply([this](auto&&... args) { ((*this) << ... << args); }, v);
        return *this;
    }
    /// Write the formatted text from entries into output
    void WriteText(std::string& output) const;
};
static_assert(FormattingTarget<FormattingBuffer>);

/// A simulating formatting target to compute the inline width
struct SimulatedInlineFormatter {
   protected:
    /// The current inline width
    size_t width = 0;
    /// The current offset. (if known)
    /// By default, we don't know.
    std::optional<size_t> offset = std::nullopt;

   public:
    /// Configure the buffer
    SimulatedInlineFormatter& Configure(FormattingMode m, Indent /* i */, std::optional<size_t> ofs) {
        assert(m == FormattingMode::Inline);
        offset = ofs;
        return *this;
    }
    /// Get the indentation
    Indent GetIndent() const { return Indent{}; }
    /// Get the current line width
    std::optional<size_t> GetLineWidth() const {
        return offset.has_value() ? std::optional{*offset + width} : std::optional{width};
    }

    /// Write a text
    SimulatedInlineFormatter& operator<<(std::string_view s) {
        width += s.size();
        return *this;
    }
    /// Write an indentation
    SimulatedInlineFormatter& operator<<(Indent i) {
        assert(false);
        return *this;
    }
    /// Write a line break
    SimulatedInlineFormatter& operator<<(LineBreakTag lb) {
        assert(false);
        return *this;
    }
    /// Write a formatting target
    SimulatedInlineFormatter& operator<<(std::reference_wrapper<const SimulatedInlineFormatter> other) {
        width += other.get().width;
        return *this;
    }
    /// Apply an optional value
    template <typename V> SimulatedInlineFormatter& operator<<(std::optional<V> v) {
        if (v.has_value()) {
            return *this << v;
        }
        return *this;
    }
    /// Apply a parameter pack
    template <typename... Vs> SimulatedInlineFormatter& operator<<(std::tuple<Vs...> v) {
        std::apply([this](auto&&... args) { ((*this) << ... << args); }, v);
        return *this;
    }
};
static_assert(FormattingTarget<SimulatedInlineFormatter>);

}  // namespace dashql

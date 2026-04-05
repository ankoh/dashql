#include <stack>

#include "dashql/formatter/formatting_target.h"

namespace dashql {

void FormattingBuffer::WriteText(std::string& output, size_t max_width, size_t& current_line_width, bool debug_mode) const {
    std::stack<FormattingEntry> pending;
    for (auto it = entries.rbegin(); it != entries.rend(); ++it) {
        pending.push(*it);
    }
    while (!pending.empty()) {
        auto entry = pending.top();
        pending.pop();
        std::visit(
            [&](const auto& v) {
                using T = std::decay_t<decltype(v)>;
                if constexpr (std::is_same_v<T, std::string_view>) {
                    output += v;
                    current_line_width += v.size();
                } else if constexpr (std::is_same_v<T, Indent>) {
                    output.append(v.GetSize(), ' ');
                    current_line_width += v.GetSize();
                } else if constexpr (std::is_same_v<T, LineBreakTag>) {
                    if (debug_mode) {
                        output += " /*";
                        output += std::to_string(current_line_width);
                        output += "*/";
                    }
                    output += '\n';
                    current_line_width = 0;
                } else if constexpr (std::is_same_v<T, BreakIndentTag>) {
                    if (debug_mode) {
                        output += " /*";
                        output += std::to_string(current_line_width);
                        output += "*/";
                    }
                    output += '\n';
                    output.append(v.indent.GetSize(), ' ');
                    current_line_width = v.indent.GetSize();
                } else if constexpr (std::is_same_v<T, Select>) {
                    const auto& entry = ((current_line_width + v.inline_width) > max_width) ? v.break_entry : v.inline_entry;
                    if (entry) {
                        std::visit([&](const auto& branch_entry) { pending.push(FormattingEntry{branch_entry}); }, *entry);
                    }
                } else if constexpr (std::is_same_v<T, std::reference_wrapper<const FormattingBuffer>>) {
                    for (auto it = v.get().entries.rbegin(); it != v.get().entries.rend(); ++it) {
                        pending.push(*it);
                    }
                }
            },
            entry);
    }
}

}  // namespace dashql

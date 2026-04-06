#include "dashql/formatter/formatting_program.h"

#include <utility>
#include <vector>

namespace dashql {
namespace {

constexpr ptrdiff_t FORMATTING_INLINE_WIDTH_SAFETY_BUFFER = 2;

ptrdiff_t RemainingInlineWidth(size_t max_width, size_t current_line_width) {
    auto remaining = static_cast<ptrdiff_t>(max_width) - static_cast<ptrdiff_t>(current_line_width);
    return remaining - FORMATTING_INLINE_WIDTH_SAFETY_BUFFER;
}

enum class RendererOpCode : uint8_t { Format, JoinNextBreakOnOverflow, CloseParenthesis, CloseParenthesisAfterBreak };

struct InlineRenderCommand {
    FmtReg doc = 0;
    size_t indentation = 0;
};

struct RenderCommand {
    RendererOpCode kind = RendererOpCode::Format;
    FmtReg reg = 0;
    size_t indentation = 0;
    size_t next_index = 0;
};

FmtReg GetOnlyChild(const FormattingOperation& doc) {
    assert(doc.children.size() == 1);
    return doc.children.front();
}

void PushInlineChildren(std::vector<InlineRenderCommand>& stack, const std::vector<FmtReg>& children,
                        size_t indentation) {
    for (auto it = children.rbegin(); it != children.rend(); ++it) {
        stack.push_back(InlineRenderCommand{
            .doc = *it,
            .indentation = indentation,
        });
    }
}

void PushDocs(std::vector<RenderCommand>& stack, const std::vector<FmtReg>& children, size_t indentation) {
    for (auto it = children.rbegin(); it != children.rend(); ++it) {
        stack.push_back(RenderCommand{
            .kind = RendererOpCode::Format,
            .reg = *it,
            .indentation = indentation,
        });
    }
}

void PushInlineJoin(std::vector<InlineRenderCommand>& stack, const FormattingOperation& doc, size_t indentation) {
    for (size_t i = doc.children.size(); i > 0; --i) {
        stack.push_back(InlineRenderCommand{
            .doc = doc.children[i - 1],
            .indentation = indentation,
        });
        if (i > 1 && doc.inline_separator != 0) {
            stack.push_back(InlineRenderCommand{
                .doc = doc.inline_separator,
                .indentation = indentation,
            });
        }
    }
}

void PushRenderedJoin(std::vector<RenderCommand>& stack, const FormattingOperation& doc, size_t indentation,
                      FmtReg separator) {
    for (size_t i = doc.children.size(); i > 0; --i) {
        stack.push_back(RenderCommand{
            .kind = RendererOpCode::Format,
            .reg = doc.children[i - 1],
            .indentation = indentation,
        });
        if (i > 1 && separator != 0) {
            stack.push_back(RenderCommand{
                .kind = RendererOpCode::Format,
                .reg = separator,
                .indentation = indentation,
            });
        }
    }
}

bool DryRunInline(ptrdiff_t remaining, std::vector<InlineRenderCommand> stack, const FormattingProgram& buffer,
                  const FormattingRenderOptions& options) {
    while (remaining >= 0 && !stack.empty()) {
        auto command = stack.back();
        stack.pop_back();

        const auto& doc = buffer.program[command.doc];
        switch (doc.code) {
            case FormattingOpCode::Empty:
                break;
            case FormattingOpCode::Text:
                remaining -= static_cast<ptrdiff_t>(doc.text.size());
                break;
            case FormattingOpCode::Break:
                return false;
            case FormattingOpCode::Concat:
                PushInlineChildren(stack, doc.children, command.indentation);
                break;
            case FormattingOpCode::Join:
                PushInlineJoin(stack, doc, command.indentation);
                break;
            case FormattingOpCode::Indent:
                if (!doc.children.empty()) {
                    stack.push_back(InlineRenderCommand{
                        .doc = GetOnlyChild(doc),
                        .indentation = command.indentation + options.indentation_width,
                    });
                }
                break;
            case FormattingOpCode::Parenthesis:
                remaining -= 2;
                if (!doc.children.empty()) {
                    stack.push_back(InlineRenderCommand{
                        .doc = GetOnlyChild(doc),
                        .indentation = command.indentation,
                    });
                }
                break;
        }
    }
    return remaining >= 0;
}

bool JoinFitsInline(ptrdiff_t remaining, const FormattingOperation& doc, size_t indentation,
                    const FormattingProgram& buffer, const FormattingRenderOptions& options) {
    std::vector<InlineRenderCommand> stack;
    for (size_t i = doc.children.size(); i > 0; --i) {
        stack.push_back(InlineRenderCommand{
            .doc = doc.children[i - 1],
            .indentation = indentation,
        });
        if (i > 1 && doc.inline_separator != 0) {
            stack.push_back(InlineRenderCommand{
                .doc = doc.inline_separator,
                .indentation = indentation,
            });
        }
    }
    return DryRunInline(remaining, std::move(stack), buffer, options);
}

bool CanInlineJoinStep(ptrdiff_t remaining, const FormattingOperation& doc, size_t next_index, size_t indentation,
                       const FormattingProgram& buffer, const FormattingRenderOptions& options) {
    if (next_index >= doc.children.size()) return true;

    std::vector<InlineRenderCommand> stack;
    stack.push_back(InlineRenderCommand{
        .doc = doc.children[next_index],
        .indentation = indentation,
    });
    if (doc.inline_separator != 0) {
        stack.push_back(InlineRenderCommand{
            .doc = doc.inline_separator,
            .indentation = indentation,
        });
    }
    return DryRunInline(remaining, std::move(stack), buffer, options);
}

bool ParenthesisFitsInline(ptrdiff_t remaining, const FormattingOperation& doc, size_t indentation,
                           const FormattingProgram& buffer, const FormattingRenderOptions& options) {
    if (remaining < 2) return false;
    std::vector<InlineRenderCommand> stack;
    if (!doc.children.empty()) {
        stack.push_back(InlineRenderCommand{
            .doc = GetOnlyChild(doc),
            .indentation = indentation,
        });
    }
    return DryRunInline(remaining - 2, std::move(stack), buffer, options);
}

void AppendLineBreak(std::string& output, size_t& current_line_width, size_t indentation, bool debug_mode) {
    if (debug_mode) {
        output += " /*";
        output += std::to_string(current_line_width);
        output += "*/";
    }
    output += '\n';
    output.append(indentation, ' ');
    current_line_width = indentation;
}

}  // namespace

std::string FormattingProgram::Render(FmtReg root, const FormattingRenderOptions& options) const {
    if (root == 0) return "";
    std::string output;
    size_t current_line_width = 0;
    const bool force_inline = options.mode == buffers::formatting::FormattingMode::INLINE;

    std::vector<RenderCommand> stack;
    stack.push_back(RenderCommand{
        .kind = RendererOpCode::Format,
        .reg = root,
        .indentation = 0,
    });

    while (!stack.empty()) {
        auto command = stack.back();
        stack.pop_back();

        if (command.kind == RendererOpCode::CloseParenthesis) {
            output += ')';
            current_line_width += 1;
            continue;
        }

        if (command.kind == RendererOpCode::CloseParenthesisAfterBreak) {
            AppendLineBreak(output, current_line_width, command.indentation, options.debug_mode);
            output += ')';
            current_line_width += 1;
            continue;
        }

        if (command.kind == RendererOpCode::JoinNextBreakOnOverflow) {
            const auto& doc = program[command.reg];
            if (command.next_index >= doc.children.size()) {
                continue;
            }

            if (CanInlineJoinStep(RemainingInlineWidth(options.max_width, current_line_width), doc, command.next_index,
                                  command.indentation, *this, options)) {
                stack.push_back(RenderCommand{
                    .kind = RendererOpCode::JoinNextBreakOnOverflow,
                    .reg = command.reg,
                    .indentation = command.indentation,
                    .next_index = command.next_index + 1,
                });
                stack.push_back(RenderCommand{
                    .kind = RendererOpCode::Format,
                    .reg = doc.children[command.next_index],
                    .indentation = command.indentation,
                });
                if (doc.inline_separator != 0) {
                    stack.push_back(RenderCommand{
                        .kind = RendererOpCode::Format,
                        .reg = doc.inline_separator,
                        .indentation = command.indentation,
                    });
                }
            } else {
                stack.push_back(RenderCommand{
                    .kind = RendererOpCode::JoinNextBreakOnOverflow,
                    .reg = command.reg,
                    .indentation = command.indentation,
                    .next_index = command.next_index + 1,
                });
                stack.push_back(RenderCommand{
                    .kind = RendererOpCode::Format,
                    .reg = doc.children[command.next_index],
                    .indentation = command.indentation,
                });
                if (doc.break_separator != 0) {
                    bool next_is_parenthesis =
                        doc.children[command.next_index] < program.size() &&
                        program[doc.children[command.next_index]].code == FormattingOpCode::Parenthesis;
                    stack.push_back(RenderCommand{
                        .kind = RendererOpCode::Format,
                        .reg = (next_is_parenthesis && doc.inline_separator != 0) ? doc.inline_separator
                                                                                  : doc.break_separator,
                        .indentation = command.indentation,
                    });
                }
            }
            continue;
        }

        const auto& doc = program[command.reg];
        switch (doc.code) {
            case FormattingOpCode::Empty:
                break;
            case FormattingOpCode::Text:
                output += doc.text;
                current_line_width += doc.text.size();
                break;
            case FormattingOpCode::Break: {
                auto indentation = command.indentation + (doc.indent_after_break ? options.indentation_width : 0);
                AppendLineBreak(output, current_line_width, indentation, options.debug_mode);
                break;
            }
            case FormattingOpCode::Concat:
                PushDocs(stack, doc.children, command.indentation);
                break;
            case FormattingOpCode::Join:
                if (force_inline || (doc.join_policy != FormattingJoinPolicy::ForceBreak &&
                                     JoinFitsInline(RemainingInlineWidth(options.max_width, current_line_width), doc,
                                                    command.indentation, *this, options))) {
                    PushRenderedJoin(stack, doc, command.indentation, doc.inline_separator);
                } else {
                    switch (doc.join_policy) {
                        case FormattingJoinPolicy::BreakAllOrNone:
                        case FormattingJoinPolicy::ForceBreak:
                            PushRenderedJoin(stack, doc, command.indentation, doc.break_separator);
                            break;
                        case FormattingJoinPolicy::BreakOnOverflow:
                            if (!doc.children.empty()) {
                                if (doc.children.size() > 1) {
                                    stack.push_back(RenderCommand{
                                        .kind = RendererOpCode::JoinNextBreakOnOverflow,
                                        .reg = command.reg,
                                        .indentation = command.indentation,
                                        .next_index = 1,
                                    });
                                }
                                stack.push_back(RenderCommand{
                                    .kind = RendererOpCode::Format,
                                    .reg = doc.children.front(),
                                    .indentation = command.indentation,
                                });
                            }
                            break;
                    }
                }
                break;
            case FormattingOpCode::Indent:
                if (!doc.children.empty()) {
                    stack.push_back(RenderCommand{
                        .kind = RendererOpCode::Format,
                        .reg = GetOnlyChild(doc),
                        .indentation = command.indentation + options.indentation_width,
                    });
                }
                break;
            case FormattingOpCode::Parenthesis: {
                bool render_flat =
                    force_inline || ParenthesisFitsInline(RemainingInlineWidth(options.max_width, current_line_width),
                                                          doc, command.indentation, *this, options);
                if (render_flat || doc.parenthesis_mode == FormattingParenthesisMode::Inline) {
                    output += '(';
                    current_line_width += 1;
                    stack.push_back(RenderCommand{
                        .kind = RendererOpCode::CloseParenthesis,
                        .indentation = command.indentation,
                    });
                    if (!doc.children.empty()) {
                        stack.push_back(RenderCommand{
                            .kind = RendererOpCode::Format,
                            .reg = GetOnlyChild(doc),
                            .indentation = command.indentation,
                        });
                    }
                } else {
                    output += '(';
                    current_line_width += 1;
                    AppendLineBreak(output, current_line_width, command.indentation + options.indentation_width,
                                    options.debug_mode);
                    stack.push_back(RenderCommand{
                        .kind = RendererOpCode::CloseParenthesisAfterBreak,
                        .indentation = command.indentation,
                    });
                    if (!doc.children.empty()) {
                        stack.push_back(RenderCommand{
                            .kind = RendererOpCode::Format,
                            .reg = GetOnlyChild(doc),
                            .indentation = command.indentation + options.indentation_width,
                        });
                    }
                }
                break;
            }
        }
    }

    return output;
}

}  // namespace dashql

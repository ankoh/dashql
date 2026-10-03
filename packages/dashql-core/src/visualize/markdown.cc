#include "dashql/visualize/markdown.h"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <limits>
#include <memory>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "dashql/utils/string_trimming.h"
#include "md4c.h"

extern "C" {
#include "entity.h"
}

namespace dashql::visualize {
namespace {

struct MarkdownField {
    std::string name;
    std::string token;
};

void AppendUtf8(std::string& out, uint32_t codepoint) {
    if (codepoint == 0 || codepoint > 0x10ffff || (codepoint >= 0xd800 && codepoint <= 0xdfff)) {
        out.append("\xef\xbf\xbd");
    } else if (codepoint <= 0x7f) {
        out.push_back(static_cast<char>(codepoint));
    } else if (codepoint <= 0x7ff) {
        out.push_back(static_cast<char>(0xc0 | (codepoint >> 6)));
        out.push_back(static_cast<char>(0x80 | (codepoint & 0x3f)));
    } else if (codepoint <= 0xffff) {
        out.push_back(static_cast<char>(0xe0 | (codepoint >> 12)));
        out.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3f)));
        out.push_back(static_cast<char>(0x80 | (codepoint & 0x3f)));
    } else {
        out.push_back(static_cast<char>(0xf0 | (codepoint >> 18)));
        out.push_back(static_cast<char>(0x80 | ((codepoint >> 12) & 0x3f)));
        out.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3f)));
        out.push_back(static_cast<char>(0x80 | (codepoint & 0x3f)));
    }
}

std::string DecodeEntity(std::string_view text) {
    if (text.size() > 3 && text[1] == '#') {
        uint32_t codepoint = 0;
        size_t begin = 2;
        int base = 10;
        if (text[2] == 'x' || text[2] == 'X') {
            begin = 3;
            base = 16;
        }
        for (size_t i = begin; i + 1 < text.size(); ++i) {
            auto ch = static_cast<unsigned char>(text[i]);
            uint32_t digit = 0;
            if (ch >= '0' && ch <= '9') {
                digit = ch - '0';
            } else if (base == 16 && ch >= 'a' && ch <= 'f') {
                digit = ch - 'a' + 10;
            } else if (base == 16 && ch >= 'A' && ch <= 'F') {
                digit = ch - 'A' + 10;
            } else {
                return std::string{text};
            }
            codepoint = codepoint * base + digit;
        }
        std::string decoded;
        AppendUtf8(decoded, codepoint);
        return decoded;
    }

    if (const auto* entity = entity_lookup(text.data(), text.size())) {
        std::string decoded;
        AppendUtf8(decoded, entity->codepoints[0]);
        if (entity->codepoints[1] != 0) AppendUtf8(decoded, entity->codepoints[1]);
        return decoded;
    }
    return std::string{text};
}

std::string DecodeAttribute(const MD_ATTRIBUTE& attribute) {
    std::string out;
    if (!attribute.text) return out;
    for (size_t i = 0; attribute.substr_offsets[i] < attribute.size; ++i) {
        auto offset = attribute.substr_offsets[i];
        auto size = attribute.substr_offsets[i + 1] - offset;
        std::string_view part{attribute.text + offset, size};
        switch (attribute.substr_types[i]) {
            case MD_TEXT_ENTITY: out += DecodeEntity(part); break;
            case MD_TEXT_NULLCHAR: out.append("\xef\xbf\xbd"); break;
            default: out.append(part); break;
        }
    }
    return out;
}

bool IsSafeUrl(std::string_view url) {
    std::string normalized;
    normalized.reserve(url.size());
    for (auto ch : url) {
        auto byte = static_cast<unsigned char>(ch);
        if (byte <= 0x20 || byte == 0x7f) continue;
        normalized.push_back(static_cast<char>(std::tolower(byte)));
    }
    auto colon = normalized.find(':');
    if (colon == std::string::npos) return true;
    auto slash = normalized.find('/');
    auto query = normalized.find('?');
    auto fragment = normalized.find('#');
    auto first_delimiter = std::min({slash, query, fragment});
    if (first_delimiter != std::string::npos && first_delimiter < colon) return true;
    auto scheme = std::string_view{normalized}.substr(0, colon);
    return scheme == "http" || scheme == "https" || scheme == "mailto";
}

std::pair<std::string, std::vector<MarkdownField>> TokenizeFields(std::string_view row_template) {
    std::string prefix = "DASHQLMARKDOWNFIELD";
    while (row_template.find(prefix) != std::string_view::npos) prefix.push_back('X');

    std::string markdown;
    std::vector<MarkdownField> fields;
    size_t cursor = 0;
    while (cursor < row_template.size()) {
        auto open = row_template.find("{{", cursor);
        if (open == std::string_view::npos) {
            markdown.append(row_template.substr(cursor));
            break;
        }
        markdown.append(row_template.substr(cursor, open - cursor));
        auto close = row_template.find("}}", open + 2);
        if (close == std::string_view::npos) {
            markdown.append(row_template.substr(open));
            break;
        }
        auto field = trim_view(row_template.substr(open + 2, close - open - 2), is_no_space);
        if (field.empty()) {
            markdown.append(row_template.substr(open, close + 2 - open));
        } else {
            std::string field_name{field};
            auto existing = std::find_if(fields.begin(), fields.end(), [&](const auto& item) {
                return item.name == field_name;
            });
            if (existing == fields.end()) {
                auto token = prefix + std::to_string(fields.size()) + "TOKEN";
                fields.push_back({std::move(field_name), std::move(token)});
                existing = std::prev(fields.end());
            }
            markdown.append(existing->token);
        }
        cursor = close + 2;
    }
    return {std::move(markdown), std::move(fields)};
}

class MarkdownBuilder {
   public:
    explicit MarkdownBuilder(const std::vector<MarkdownField>& fields) : fields_(fields) {
        root_.node_type = buffers::visualization::MarkdownNodeType::DOCUMENT;
        parents_.push_back(&root_);
    }

    std::unique_ptr<MarkdownNode> TakeRoot() { return std::make_unique<MarkdownNode>(std::move(root_)); }

    int EnterBlock(MD_BLOCKTYPE type, void* detail) {
        if (type == MD_BLOCK_HTML) {
            ++suppressed_html_depth_;
            return 0;
        }
        if (suppressed_html_depth_ > 0 || type == MD_BLOCK_DOC) return 0;

        auto node = std::make_unique<MarkdownNode>();
        bool container = true;
        switch (type) {
            case MD_BLOCK_QUOTE: node->node_type = buffers::visualization::MarkdownNodeType::BLOCKQUOTE; break;
            case MD_BLOCK_UL: {
                node->node_type = buffers::visualization::MarkdownNodeType::LIST;
                node->tight = static_cast<MD_BLOCK_UL_DETAIL*>(detail)->is_tight != 0;
                break;
            }
            case MD_BLOCK_OL: {
                auto* ordered = static_cast<MD_BLOCK_OL_DETAIL*>(detail);
                node->node_type = buffers::visualization::MarkdownNodeType::LIST;
                node->ordered = true;
                node->start = ordered->start;
                node->tight = ordered->is_tight != 0;
                break;
            }
            case MD_BLOCK_LI: node->node_type = buffers::visualization::MarkdownNodeType::LIST_ITEM; break;
            case MD_BLOCK_HR:
                node->node_type = buffers::visualization::MarkdownNodeType::THEMATIC_BREAK;
                container = false;
                break;
            case MD_BLOCK_H:
                node->node_type = buffers::visualization::MarkdownNodeType::HEADING;
                node->level = static_cast<MD_BLOCK_H_DETAIL*>(detail)->level;
                break;
            case MD_BLOCK_CODE: {
                node->node_type = buffers::visualization::MarkdownNodeType::CODE_BLOCK;
                auto* code = static_cast<MD_BLOCK_CODE_DETAIL*>(detail);
                node->language = DecodeAttribute(code->lang);
                break;
            }
            case MD_BLOCK_P: node->node_type = buffers::visualization::MarkdownNodeType::PARAGRAPH; break;
            default: return 0;
        }
        AppendNode(std::move(node), container);
        return 0;
    }

    int LeaveBlock(MD_BLOCKTYPE type) {
        if (type == MD_BLOCK_HTML) {
            if (suppressed_html_depth_ > 0) --suppressed_html_depth_;
            return 0;
        }
        if (suppressed_html_depth_ > 0 || type == MD_BLOCK_DOC || type == MD_BLOCK_HR) return 0;
        switch (type) {
            case MD_BLOCK_QUOTE:
            case MD_BLOCK_UL:
            case MD_BLOCK_OL:
            case MD_BLOCK_LI:
            case MD_BLOCK_H:
            case MD_BLOCK_CODE:
            case MD_BLOCK_P: PopParent(); break;
            default: break;
        }
        return 0;
    }

    int EnterSpan(MD_SPANTYPE type, void* detail) {
        if (suppressed_html_depth_ > 0) return 0;
        auto node = std::make_unique<MarkdownNode>();
        switch (type) {
            case MD_SPAN_EM: node->node_type = buffers::visualization::MarkdownNodeType::EMPHASIS; break;
            case MD_SPAN_STRONG: node->node_type = buffers::visualization::MarkdownNodeType::STRONG; break;
            case MD_SPAN_CODE: node->node_type = buffers::visualization::MarkdownNodeType::INLINE_CODE; break;
            case MD_SPAN_A: {
                auto* link = static_cast<MD_SPAN_A_DETAIL*>(detail);
                node->url = DecodeAttribute(link->href);
                node->title = DecodeAttribute(link->title);
                node->node_type = IsSafeUrl(node->url) && !ContainsFieldToken(node->url)
                                ? buffers::visualization::MarkdownNodeType::LINK
                                : buffers::visualization::MarkdownNodeType::SPAN;
                if (ContainsFieldToken(node->title)) node->title.clear();
                break;
            }
            case MD_SPAN_IMG: {
                auto* image = static_cast<MD_SPAN_IMG_DETAIL*>(detail);
                node->url = DecodeAttribute(image->src);
                node->title = DecodeAttribute(image->title);
                node->node_type = IsSafeUrl(node->url) && !ContainsFieldToken(node->url)
                                ? buffers::visualization::MarkdownNodeType::IMAGE
                                : buffers::visualization::MarkdownNodeType::SPAN;
                if (ContainsFieldToken(node->title)) node->title.clear();
                break;
            }
            default: node->node_type = buffers::visualization::MarkdownNodeType::SPAN; break;
        }
        AppendNode(std::move(node), true);
        return 0;
    }

    int LeaveSpan(MD_SPANTYPE) {
        if (suppressed_html_depth_ == 0) PopParent();
        return 0;
    }

    int Text(MD_TEXTTYPE type, const char* text, MD_SIZE size) {
        if (suppressed_html_depth_ > 0 || type == MD_TEXT_HTML) return 0;
        switch (type) {
            case MD_TEXT_BR: AppendLeaf(buffers::visualization::MarkdownNodeType::HARD_BREAK, {}); break;
            case MD_TEXT_SOFTBR: AppendLeaf(buffers::visualization::MarkdownNodeType::TEXT, "\n"); break;
            case MD_TEXT_NULLCHAR: AppendTextWithFields("\xef\xbf\xbd"); break;
            case MD_TEXT_ENTITY: AppendTextWithFields(DecodeEntity({text, size})); break;
            default: AppendTextWithFields({text, size}); break;
        }
        return 0;
    }

   private:
    MarkdownNode root_;
    std::vector<MarkdownNode*> parents_;
    const std::vector<MarkdownField>& fields_;
    uint32_t suppressed_html_depth_ = 0;

    bool ContainsFieldToken(std::string_view text) const {
        return std::any_of(fields_.begin(), fields_.end(), [&](const auto& field) {
            return text.find(field.token) != std::string_view::npos;
        });
    }

    void AppendNode(std::unique_ptr<MarkdownNode> node, bool push) {
        auto* raw = node.get();
        parents_.back()->children.push_back(std::move(node));
        if (push) parents_.push_back(raw);
    }

    void PopParent() {
        if (parents_.size() > 1) parents_.pop_back();
    }

    void AppendLeaf(buffers::visualization::MarkdownNodeType type, std::string value) {
        auto node = std::make_unique<MarkdownNode>();
        node->node_type = type;
        node->value = std::move(value);
        AppendNode(std::move(node), false);
    }

    void AppendTextWithFields(std::string_view text) {
        size_t cursor = 0;
        while (cursor < text.size()) {
            const MarkdownField* matched_field = nullptr;
            size_t matched_at = std::string_view::npos;
            for (const auto& field : fields_) {
                auto at = text.find(field.token, cursor);
                if (at < matched_at) {
                    matched_at = at;
                    matched_field = &field;
                }
            }
            if (!matched_field) {
                AppendLeaf(buffers::visualization::MarkdownNodeType::TEXT, std::string{text.substr(cursor)});
                break;
            }
            if (matched_at > cursor) {
                AppendLeaf(buffers::visualization::MarkdownNodeType::TEXT,
                           std::string{text.substr(cursor, matched_at - cursor)});
            }
            AppendLeaf(buffers::visualization::MarkdownNodeType::FIELD, matched_field->name);
            cursor = matched_at + matched_field->token.size();
        }
    }
};

int EnterBlock(MD_BLOCKTYPE type, void* detail, void* userdata) {
    return static_cast<MarkdownBuilder*>(userdata)->EnterBlock(type, detail);
}
int LeaveBlock(MD_BLOCKTYPE type, void*, void* userdata) {
    return static_cast<MarkdownBuilder*>(userdata)->LeaveBlock(type);
}
int EnterSpan(MD_SPANTYPE type, void* detail, void* userdata) {
    return static_cast<MarkdownBuilder*>(userdata)->EnterSpan(type, detail);
}
int LeaveSpan(MD_SPANTYPE type, void*, void* userdata) {
    return static_cast<MarkdownBuilder*>(userdata)->LeaveSpan(type);
}
int Text(MD_TEXTTYPE type, const char* text, MD_SIZE size, void* userdata) {
    return static_cast<MarkdownBuilder*>(userdata)->Text(type, text, size);
}

}  // namespace

std::shared_ptr<MarkdownDocument> CompileMarkdownSpec(const VisualizationSpec& spec) {
    if (spec.markdown_ast) return spec.markdown_ast;
    if (!spec.markdown.has_value()) return nullptr;

    const auto& row_template = spec.markdown->row_template;
    auto [markdown, fields] = TokenizeFields(row_template);
    if (markdown.size() > std::numeric_limits<MD_SIZE>::max()) return nullptr;

    MarkdownBuilder builder{fields};
    MD_PARSER parser = {
        0,
        MD_DIALECT_COMMONMARK,
        EnterBlock,
        LeaveBlock,
        EnterSpan,
        LeaveSpan,
        Text,
        nullptr,
        nullptr,
    };
    if (md_parse(markdown.data(), static_cast<MD_SIZE>(markdown.size()), &parser, &builder) != 0) {
        return nullptr;
    }
    auto out = std::make_shared<MarkdownDocument>();
    out->template_ = row_template;
    out->fields.reserve(fields.size());
    for (auto& field : fields) out->fields.push_back(std::move(field.name));
    out->document = builder.TakeRoot();
    spec.markdown_ast = out;
    return out;
}

flatbuffers::Offset<buffers::visualization::MarkdownSpec> PackMarkdownSpec(
    flatbuffers::FlatBufferBuilder& builder, const MarkdownDocument& spec) {
    return buffers::visualization::CreateMarkdownSpec(builder, &spec);
}

}  // namespace dashql::visualize

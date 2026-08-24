#pragma once

#include <flatbuffers/flatbuffer_builder.h>

#include <cstdint>
#include <limits>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "dashql/buffers/index_generated.h"
#include "dashql/script.h"

namespace dashql::editor {

/// Owns the native state for one editor document. The borrowed catalog must outlive the session.
///
/// Portable offsets use the unit selected at construction. Script's rope edits use Unicode codepoint
/// offsets, so edit boundaries are validated and converted before a batch is committed atomically.
class EditorSession {
   public:
    using EditorEvent = buffers::editor::EditorEventT;
    using EditorSelection = buffers::editor::EditorSelectionT;
    using EditorUpdate = buffers::editor::EditorUpdateT;

    explicit EditorSession(Catalog& catalog,
                           buffers::editor::EditorOffsetUnit offset_unit =
                               buffers::editor::EditorOffsetUnit::UTF8_BYTES);
    ~EditorSession() = default;
    EditorSession(const EditorSession&) = delete;
    EditorSession& operator=(const EditorSession&) = delete;

    CatalogEntryID GetCatalogEntryId() const { return script_.GetCatalogEntryId(); }
    std::string GetText() { return script_.ToString(); }
    uint64_t GetDocumentRevision() const { return document_revision_; }
    uint64_t GetStateRevision() const { return state_revision_; }
    uint64_t GetCatalogRevision() const { return catalog_.GetVersion(); }
    buffers::editor::EditorOffsetUnit GetOffsetUnit() const { return offset_unit_; }
    const std::optional<EditorSelection>& GetPrimarySelection() const { return primary_selection_; }
    const Script& GetScript() const { return script_; }

    EditorUpdate ReplaceText(uint64_t expected_document_revision, std::string_view text);
    EditorUpdate Apply(const EditorEvent& event);
    EditorUpdate SetPrimaryCursor(uint64_t expected_document_revision, uint64_t offset);
    EditorUpdate EnsureSynchronousAnalysis();
    void PackCompletion(flatbuffers::FlatBufferBuilder& builder, size_t limit);
    void CompileQuery(flatbuffers::FlatBufferBuilder& builder, const buffers::formatting::FormattingConfigT& config,
                      bool allow_extensions, bool parse_if_outdated);
    std::unique_ptr<Script> Format(const buffers::formatting::FormattingConfigT& config, bool parse_if_outdated,
                                   Catalog* catalog = nullptr);
    bool IsFullyFormattable(const buffers::formatting::FormattingConfigT& config, bool parse_if_outdated);
    void ComputeDiff(flatbuffers::FlatBufferBuilder& builder, Script& target);
    void LoadIntoCatalog(CatalogEntry::Rank rank);
    void DropFromCatalog();

   private:
    Catalog& catalog_;
    Script script_;
    const buffers::editor::EditorOffsetUnit offset_unit_;
    uint64_t document_revision_ = 0;
    uint64_t state_revision_ = 0;
    uint64_t analyzed_document_revision_ = std::numeric_limits<uint64_t>::max();
    uint64_t analyzed_catalog_revision_ = std::numeric_limits<uint64_t>::max();
    uint64_t cursor_document_revision_ = std::numeric_limits<uint64_t>::max();
    uint64_t cursor_catalog_revision_ = std::numeric_limits<uint64_t>::max();
    std::optional<EditorSelection> primary_selection_;

    EditorUpdate MakeUpdate(buffers::editor::EditorUpdateStatus status = buffers::editor::EditorUpdateStatus::OK,
                            std::string_view message = {});
    EditorUpdate FinalizeUpdate(EditorUpdate update);
    std::optional<rope::Rope::TextPosition> ResolveOffset(const rope::Rope& text, uint64_t offset) const;
    std::optional<uint64_t> TryProjectByteOffset(uint64_t offset) const;
    uint64_t ProjectByteOffset(uint64_t offset) const;
    std::unique_ptr<buffers::editor::EditorTextSpan> ProjectTextSpan(buffers::parser::TextSpan span) const;
    void ProjectEditorState(EditorUpdate& update);
    bool EnsureAnalysis(EditorUpdate& update);
};

}  // namespace dashql::editor

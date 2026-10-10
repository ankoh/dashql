#include "dashql/batch.h"

#include <flatbuffers/verifier.h>

#include <stdexcept>

#include "dashql/buffers/index_generated.h"
#include "dashql/catalog_descriptor.h"
#include "dashql/script.h"
#include "utf8proc/utf8proc_wrapper.hpp"

using namespace dashql;

flatbuffers::DetachedBuffer dashql::ProcessBatch(std::span<const uint8_t> request_bytes) {
    flatbuffers::Verifier request_verifier{request_bytes.data(), request_bytes.size()};
    if (request_bytes.empty() || !request_verifier.VerifyBuffer<buffers::batch::BatchRequest>(nullptr)) {
        throw std::invalid_argument("invalid BatchRequest FlatBuffer");
    }
    auto& request = *flatbuffers::GetRoot<buffers::batch::BatchRequest>(request_bytes.data());
    Catalog catalog;
    if (auto* descriptors = request.catalog_descriptors()) {
        CatalogEntry::Rank rank = 0;
        for (auto* descriptor : *descriptors) {
            if (!descriptor || !descriptor->data()) {
                throw std::invalid_argument("missing batch catalog descriptor bytes");
            }
            catalog.ReplaceDescriptor(catalog.AllocateEntryId(), rank++,
                                      {descriptor->data()->data(), descriptor->data()->size()});
        }
    }

    buffers::batch::BatchResultT result;
    if (auto* inputs = request.scripts()) {
        result.scripts.reserve(inputs->size());
        for (auto* input : *inputs) {
            if (!input) throw std::invalid_argument("null batch script input");
            auto out = std::make_unique<buffers::batch::BatchScriptResultT>();
            if (input->id()) out->id = input->id()->str();
            auto diagnostic = [&](buffers::batch::ProcessingStage stage, buffers::batch::DiagnosticSeverity severity,
                                  TextSpan span, std::string_view message) {
                auto value = std::make_unique<buffers::batch::BatchDiagnosticT>();
                value->stage = stage;
                value->severity = severity;
                value->offset = span.offset();
                value->length = span.length();
                value->message = message;
                out->diagnostics.push_back(std::move(value));
            };
            auto pack_stage = [](auto& stage, std::vector<uint8_t>& target) {
                flatbuffers::FlatBufferBuilder builder;
                builder.Finish(stage.Pack(builder));
                target.assign(builder.GetBufferPointer(), builder.GetBufferPointer() + builder.GetSize());
            };
            try {
                auto outputs = input->outputs();
                if (outputs & ~uint32_t{15}) throw std::invalid_argument("invalid batch output mask");
                auto text = input->text() ? input->text()->string_view() : std::string_view{};
                if (!utf8::Utf8Proc::IsValid(text)) throw std::invalid_argument("invalid UTF-8 batch script text");
                if (outputs) {
                    Script script{catalog};
                    script.ReplaceText(text);
                    script.Scan();
                    for (auto& [span, message] : script.scanned_script->errors) {
                        diagnostic(buffers::batch::ProcessingStage::SCAN, buffers::batch::DiagnosticSeverity::ERROR,
                                   span, message);
                    }
                    if (outputs & 1) pack_stage(*script.scanned_script, out->scanned);
                    if (outputs & 14) {
                        script.Parse();
                        for (auto& error : script.parsed_script->errors) {
                            auto span = script.scanned_script->ResolveTextSpan(error.location);
                            diagnostic(buffers::batch::ProcessingStage::PARSE, buffers::batch::DiagnosticSeverity::ERROR,
                                       span, error.message);
                        }
                        if (outputs & 2) pack_stage(*script.parsed_script, out->parsed);
                    }
                    if (outputs & 12) {
                        script.Analyze(false);
                        for (auto& error : script.analyzed_script->errors) {
                            auto severity = error.severity == buffers::analyzer::AnalyzerErrorSeverity::WARNING
                                                ? buffers::batch::DiagnosticSeverity::WARNING
                                                : buffers::batch::DiagnosticSeverity::ERROR;
                            TextSpan span;
                            if (error.text_span) span = *error.text_span;
                            else if (error.symbol_span) span = script.scanned_script->ResolveTextSpan(*error.symbol_span);
                            diagnostic(buffers::batch::ProcessingStage::ANALYZE, severity, span, error.message);
                        }
                        if (outputs & 4) pack_stage(*script.analyzed_script, out->analyzed);
                        bool erroneous = false;
                        for (auto& error : out->diagnostics) {
                            erroneous |= error->severity == buffers::batch::DiagnosticSeverity::ERROR;
                        }
                        if ((outputs & 8) && !erroneous) {
                            auto descriptor = PackCatalogDescriptor(*script.analyzed_script);
                            out->catalog_descriptor.assign(descriptor.data(), descriptor.data() + descriptor.size());
                        }
                    }
                }
            } catch (const std::exception& error) {
                out->failure = error.what();
            } catch (...) {
                out->failure = "unknown batch processing exception";
            }
            result.scripts.push_back(std::move(out));
        }
    }
    flatbuffers::FlatBufferBuilder builder;
    builder.Finish(buffers::batch::BatchResult::Pack(builder, &result));
    flatbuffers::Verifier result_verifier{builder.GetBufferPointer(), builder.GetSize()};
    if (!result_verifier.VerifyBuffer<buffers::batch::BatchResult>(nullptr)) {
        throw std::runtime_error("invalid BatchResult FlatBuffer");
    }
    return builder.Release();
}

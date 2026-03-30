// Stub implementations for MbedTLS wrapper functions.
// MbedTLS is NOT implemented in this build. All methods throw.
// Uses the actual DuckDB header to ensure signatures match across platforms
// (idx_t is uint64_t, which mangles differently on GCC vs Clang).

#include "mbedtls/cipher.h"
#include "mbedtls_wrapper.hpp"
#include "duckdb/common/exception.hpp"

#define MBEDTLS_NOT_IMPLEMENTED throw duckdb::NotImplementedException("MbedTLS is not supported in this build")

namespace duckdb_mbedtls {

void MbedTlsWrapper::ComputeSha256Hash(const char *in, size_t in_len, char *out) { MBEDTLS_NOT_IMPLEMENTED; }
std::string MbedTlsWrapper::ComputeSha256Hash(const std::string &file_content) { MBEDTLS_NOT_IMPLEMENTED; }
bool MbedTlsWrapper::IsValidSha256Signature(const std::string &pubkey, const std::string &signature,
                                             const std::string &sha256_hash) { MBEDTLS_NOT_IMPLEMENTED; }
void MbedTlsWrapper::Hmac256(const char *key, size_t key_len, const char *message, size_t message_len, char *out) { MBEDTLS_NOT_IMPLEMENTED; }
void MbedTlsWrapper::ToBase16(char *in, char *out, size_t len) { MBEDTLS_NOT_IMPLEMENTED; }

MbedTlsWrapper::SHA1State::SHA1State() : sha_context(nullptr) {}
MbedTlsWrapper::SHA1State::~SHA1State() {}
void MbedTlsWrapper::SHA1State::AddString(const std::string &str) { MBEDTLS_NOT_IMPLEMENTED; }
std::string MbedTlsWrapper::SHA1State::Finalize() { MBEDTLS_NOT_IMPLEMENTED; }
void MbedTlsWrapper::SHA1State::FinishHex(char *out) { MBEDTLS_NOT_IMPLEMENTED; }

MbedTlsWrapper::SHA256State::SHA256State() : sha_context(nullptr) {}
MbedTlsWrapper::SHA256State::~SHA256State() {}
void MbedTlsWrapper::SHA256State::AddString(const std::string &str) { MBEDTLS_NOT_IMPLEMENTED; }
void MbedTlsWrapper::SHA256State::AddBytes(duckdb::data_ptr_t input_bytes, duckdb::idx_t len) { MBEDTLS_NOT_IMPLEMENTED; }
void MbedTlsWrapper::SHA256State::AddBytes(duckdb::const_data_ptr_t input_bytes, duckdb::idx_t len) { MBEDTLS_NOT_IMPLEMENTED; }
void MbedTlsWrapper::SHA256State::AddSalt(unsigned char *salt, size_t salt_len) { MBEDTLS_NOT_IMPLEMENTED; }
std::string MbedTlsWrapper::SHA256State::Finalize() { MBEDTLS_NOT_IMPLEMENTED; }
void MbedTlsWrapper::SHA256State::FinishHex(char *out) { MBEDTLS_NOT_IMPLEMENTED; }
void MbedTlsWrapper::SHA256State::FinalizeDerivedKey(duckdb::data_ptr_t hash) { MBEDTLS_NOT_IMPLEMENTED; }

MbedTlsWrapper::AESStateMBEDTLS::AESStateMBEDTLS(duckdb::unique_ptr<duckdb::EncryptionStateMetadata> metadata)
    : duckdb::EncryptionState(std::move(metadata)) {}
MbedTlsWrapper::AESStateMBEDTLS::~AESStateMBEDTLS() {}

void MbedTlsWrapper::AESStateMBEDTLS::InitializeEncryption(duckdb::EncryptionNonce &nonce, duckdb::const_data_ptr_t key, duckdb::const_data_ptr_t aad, duckdb::idx_t aad_len) { MBEDTLS_NOT_IMPLEMENTED; }
void MbedTlsWrapper::AESStateMBEDTLS::InitializeDecryption(duckdb::EncryptionNonce &nonce, duckdb::const_data_ptr_t key, duckdb::const_data_ptr_t aad, duckdb::idx_t aad_len) { MBEDTLS_NOT_IMPLEMENTED; }
size_t MbedTlsWrapper::AESStateMBEDTLS::Process(duckdb::const_data_ptr_t in, duckdb::idx_t in_len, duckdb::data_ptr_t out, duckdb::idx_t out_len) { MBEDTLS_NOT_IMPLEMENTED; }
size_t MbedTlsWrapper::AESStateMBEDTLS::Finalize(duckdb::data_ptr_t out, duckdb::idx_t out_len, duckdb::data_ptr_t tag, duckdb::idx_t tag_len) { MBEDTLS_NOT_IMPLEMENTED; }
void MbedTlsWrapper::AESStateMBEDTLS::GenerateRandomDataStatic(duckdb::data_ptr_t data, duckdb::idx_t len) { MBEDTLS_NOT_IMPLEMENTED; }
void MbedTlsWrapper::AESStateMBEDTLS::GenerateRandomData(duckdb::data_ptr_t data, duckdb::idx_t len) { MBEDTLS_NOT_IMPLEMENTED; }
void MbedTlsWrapper::AESStateMBEDTLS::FinalizeGCM(duckdb::data_ptr_t tag, duckdb::idx_t tag_len) { MBEDTLS_NOT_IMPLEMENTED; }
const mbedtls_cipher_info_t *MbedTlsWrapper::AESStateMBEDTLS::GetCipher() { MBEDTLS_NOT_IMPLEMENTED; }
void MbedTlsWrapper::AESStateMBEDTLS::SecureClearData(duckdb::data_ptr_t data, duckdb::idx_t len) { MBEDTLS_NOT_IMPLEMENTED; }
void MbedTlsWrapper::AESStateMBEDTLS::InitializeInternal(duckdb::EncryptionNonce &nonce, duckdb::const_data_ptr_t aad, duckdb::idx_t aad_len) { MBEDTLS_NOT_IMPLEMENTED; }
void MbedTlsWrapper::AESStateMBEDTLS::GenerateRandomDataInsecure(duckdb::data_ptr_t data, duckdb::idx_t len) { MBEDTLS_NOT_IMPLEMENTED; }

}  // namespace duckdb_mbedtls

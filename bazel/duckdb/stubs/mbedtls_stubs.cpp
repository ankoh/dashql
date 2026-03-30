// Stub implementations for MbedTLS wrapper functions

#include <string>
#include "duckdb/common/unique_ptr.hpp"
#include "duckdb/common/encryption_state.hpp"

namespace duckdb_mbedtls {

class MbedTlsWrapper {
public:
    static void ToBase16(char *dst, char *src, unsigned long len);

    class SHA1State {
    public:
        SHA1State();
        ~SHA1State();
        void AddString(const std::string &str);
        void FinishHex(char *output);
    };

    class SHA256State {
    public:
        SHA256State();
        ~SHA256State();
        void AddString(const std::string &str);
        void AddSalt(unsigned char *salt, unsigned long len);
        void AddBytes(const unsigned char *bytes, unsigned long long len);
        void FinishHex(char *output);
        void FinalizeDerivedKey(unsigned char *key);
    };

    class AESStateMBEDTLS {
    public:
        explicit AESStateMBEDTLS(duckdb::unique_ptr<duckdb::EncryptionStateMetadata> metadata);
        static void SecureClearData(unsigned char *data, unsigned long long len);
    };
};

// ToBase16
void MbedTlsWrapper::ToBase16(char *dst, char *src, unsigned long len) {
    const char* hex = "0123456789abcdef";
    for (unsigned long i = 0; i < len; i++) {
        unsigned char c = static_cast<unsigned char>(src[i]);
        dst[i * 2] = hex[c >> 4];
        dst[i * 2 + 1] = hex[c & 0x0F];
    }
    dst[len * 2] = '\0';
}

// SHA1State
MbedTlsWrapper::SHA1State::SHA1State() {}
MbedTlsWrapper::SHA1State::~SHA1State() {}
void MbedTlsWrapper::SHA1State::AddString(const std::string &str) {}
void MbedTlsWrapper::SHA1State::FinishHex(char *output) {
    for (int i = 0; i < 40; i++) output[i] = '0';
    output[40] = '\0';
}

// SHA256State
MbedTlsWrapper::SHA256State::SHA256State() {}
MbedTlsWrapper::SHA256State::~SHA256State() {}
void MbedTlsWrapper::SHA256State::AddString(const std::string &str) {}
void MbedTlsWrapper::SHA256State::AddSalt(unsigned char *salt, unsigned long len) {}
void MbedTlsWrapper::SHA256State::AddBytes(const unsigned char *bytes, unsigned long long len) {}
void MbedTlsWrapper::SHA256State::FinishHex(char *output) {
    for (int i = 0; i < 64; i++) output[i] = '0';
    output[64] = '\0';
}
void MbedTlsWrapper::SHA256State::FinalizeDerivedKey(unsigned char *key) {
    for (int i = 0; i < 32; i++) key[i] = 0;
}

// AESStateMBEDTLS
MbedTlsWrapper::AESStateMBEDTLS::AESStateMBEDTLS(duckdb::unique_ptr<duckdb::EncryptionStateMetadata> metadata) {
    // No-op - encryption not supported in stub
}

void MbedTlsWrapper::AESStateMBEDTLS::SecureClearData(unsigned char *data, unsigned long long len) {
    if (data) {
        volatile unsigned char *ptr = data;
        for (unsigned long long i = 0; i < len; i++) ptr[i] = 0;
    }
}

}  // namespace duckdb_mbedtls

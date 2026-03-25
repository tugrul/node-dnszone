#pragma once
#include <string>
#include <vector>
#include <map>
#include <cstdint>

namespace punycode {
    std::string punycodeToUnicode(const std::string& domain);
    std::string unicodeToPunycode(const std::string& domain);
}

// ─────────────────────── Tokenizer ───────────────────────────────────────────

struct ZoneTokenizer {
    std::string buf_;
    size_t      pos_;
    uint32_t    lineNum_;

    ZoneTokenizer();
    void        feed(const char* data, size_t len);
    void        reset();
    std::string unconsumed() const;
    void        consumeConsumed();
    void        skipWS();
    std::string readToken();
    std::string readToEOL();
};

// ─────────────────────── Record ──────────────────────────────────────────────

struct ZoneRecord {
    std::string name;
    uint32_t    ttl  = 3600;
    std::string cls  = "IN";
    std::string type;
    std::map<std::string, std::string> rdata;
};

// ─────────────────────── Parser ──────────────────────────────────────────────

class ZoneParser {
public:
    explicit ZoneParser(bool convertIDN = false);

    void reset();

    // Feed a chunk of zone file data; returns all complete records found
    std::vector<ZoneRecord> feed(const char* data, size_t len);

    // Signal end-of-stream; returns any remaining records
    std::vector<ZoneRecord> flush();

private:
    ZoneTokenizer tok_;
    bool          convertIDN_;
    std::string   origin_;
    std::string   lastName_;
    uint32_t      defaultTTL_;
    uint32_t      currentTTL_;
    uint32_t      lineNum_;

    void parseLines(std::vector<ZoneRecord>& out, bool eof);
    ZoneRecord parseLine(const std::string& line);
    void       parseRdata(ZoneRecord& rec, const std::string& line, size_t& p);
    std::string expandName(const std::string& name);
    std::string toUpperType(const std::string& s);
};

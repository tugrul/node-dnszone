// zone_parser.cc — DNS Zone File Parser C++ Addon
// Implements a streaming parser that converts DNS zone file content into
// structured JavaScript objects entirely in C++ for maximum performance.

#include "zone_parser.h"
#include <algorithm>
#include <cstring>
#include <stdexcept>
#include <sstream>

// ─────────────────────────────── IDN / Punycode ──────────────────────────────

namespace punycode {

static const uint32_t BASE         = 36;
static const uint32_t TMIN         = 1;
static const uint32_t TMAX         = 26;
static const uint32_t SKEW         = 38;
static const uint32_t DAMP         = 700;
static const uint32_t INITIAL_BIAS = 72;
static const uint32_t INITIAL_N    = 128;
static const char     DELIMITER    = '-';

static uint32_t adapt(uint32_t delta, uint32_t numPoints, bool firstTime) {
    delta = firstTime ? delta / DAMP : delta >> 1;
    delta += delta / numPoints;
    uint32_t k = 0;
    while (delta > ((BASE - TMIN) * TMAX) / 2) {
        delta /= (BASE - TMIN);
        k += BASE;
    }
    return k + (BASE - TMIN + 1) * delta / (delta + SKEW);
}

static char encodeDigit(uint32_t d) {
    return d < 26 ? 'a' + d : '0' + (d - 26);
}

static uint32_t decodeDigit(char c) {
    if (c >= '0' && c <= '9') return c - '0' + 26;
    if (c >= 'a' && c <= 'z') return c - 'a';
    if (c >= 'A' && c <= 'Z') return c - 'A';
    return BASE; // invalid
}

// Decode a punycode-encoded label (without xn-- prefix) to UTF-8
static std::string decodeLabel(const std::string& input) {
    std::vector<uint32_t> output;

    // Copy basic code points
    size_t b = input.rfind(DELIMITER);
    size_t i = 0;
    if (b != std::string::npos) {
        for (size_t j = 0; j < b; ++j) {
            unsigned char ch = input[j];
            if (ch >= 128) return input; // invalid basic
            output.push_back(ch);
        }
        i = b + 1;
    }

    uint32_t n    = INITIAL_N;
    uint32_t bias = INITIAL_BIAS;
    uint32_t idx  = 0;

    while (i < input.size()) {
        uint32_t oldi = idx;
        uint32_t w    = 1;
        for (uint32_t k = BASE; ; k += BASE) {
            if (i >= input.size()) return input; // malformed
            uint32_t digit = decodeDigit(input[i++]);
            if (digit >= BASE) return input;
            idx += digit * w;
            uint32_t t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
            if (digit < t) break;
            w *= (BASE - t);
        }
        uint32_t sz = (uint32_t)output.size() + 1;
        bias = adapt(idx - oldi, sz, oldi == 0);
        n += idx / sz;
        idx %= sz;
        output.insert(output.begin() + idx, n);
        ++idx;
    }

    // Encode output codepoints as UTF-8
    std::string result;
    result.reserve(output.size() * 3);
    for (uint32_t cp : output) {
        if (cp < 0x80) {
            result += (char)cp;
        } else if (cp < 0x800) {
            result += (char)(0xC0 | (cp >> 6));
            result += (char)(0x80 | (cp & 0x3F));
        } else if (cp < 0x10000) {
            result += (char)(0xE0 | (cp >> 12));
            result += (char)(0x80 | ((cp >> 6) & 0x3F));
            result += (char)(0x80 | (cp & 0x3F));
        } else {
            result += (char)(0xF0 | (cp >> 18));
            result += (char)(0x80 | ((cp >> 12) & 0x3F));
            result += (char)(0x80 | ((cp >> 6) & 0x3F));
            result += (char)(0x80 | (cp & 0x3F));
        }
    }
    return result;
}

// Encode a UTF-8 string as punycode (for a single label, no xn-- prefix)
static std::string encodeLabel(const std::string& utf8) {
    // Decode UTF-8 to codepoints
    std::vector<uint32_t> input;
    for (size_t i = 0; i < utf8.size(); ) {
        unsigned char c = utf8[i];
        uint32_t cp;
        if      (c < 0x80)  { cp = c; i += 1; }
        else if (c < 0xE0)  { cp = (c & 0x1F) << 6  | (utf8[i+1] & 0x3F); i += 2; }
        else if (c < 0xF0)  { cp = (c & 0x0F) << 12 | (utf8[i+1] & 0x3F) << 6 | (utf8[i+2] & 0x3F); i += 3; }
        else                { cp = (c & 0x07) << 18 | (utf8[i+1] & 0x3F) << 12 | (utf8[i+2] & 0x3F) << 6 | (utf8[i+3] & 0x3F); i += 4; }
        input.push_back(cp);
    }

    std::string output;
    uint32_t n    = INITIAL_N;
    uint32_t delta = 0;
    uint32_t bias  = INITIAL_BIAS;
    uint32_t h, b = 0;

    for (uint32_t cp : input) {
        if (cp < 128) { output += (char)cp; ++b; }
    }
    h = b;
    if (b > 0) output += DELIMITER;

    while (h < input.size()) {
        uint32_t m = UINT32_MAX;
        for (uint32_t cp : input) if (cp >= n && cp < m) m = cp;
        if (m - n > (UINT32_MAX - delta) / (h + 1)) return utf8;
        delta += (m - n) * (h + 1);
        n = m;

        for (uint32_t cp : input) {
            if (cp < n) { if (++delta == 0) return utf8; }
            if (cp == n) {
                uint32_t q = delta;
                for (uint32_t k = BASE; ; k += BASE) {
                    uint32_t t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
                    if (q < t) break;
                    output += encodeDigit(t + (q - t) % (BASE - t));
                    q = (q - t) / (BASE - t);
                }
                output += encodeDigit(q);
                bias = adapt(delta, h + 1, h == b);
                delta = 0;
                ++h;
            }
        }
        ++delta; ++n;
    }
    return output;
}

// Convert a full domain name: each label that starts with "xn--" is decoded
std::string punycodeToUnicode(const std::string& domain) {
    if (domain.empty()) return domain;
    std::string result;
    result.reserve(domain.size());
    std::string label;
    bool hasXn = false;
    auto flushLabel = [&]() {
        if (label.size() >= 4 &&
            label[0] == 'x' && label[1] == 'n' && label[2] == '-' && label[3] == '-') {
            std::string decoded = decodeLabel(label.substr(4));
            result += decoded;
            hasXn = true;
        } else {
            result += label;
        }
        label.clear();
    };
    for (char ch : domain) {
        if (ch == '.') {
            flushLabel();
            result += '.';
        } else {
            label += (char)std::tolower((unsigned char)ch);
        }
    }
    flushLabel();
    return hasXn ? result : domain; // return original if nothing was decoded
}

// Convert a full domain name to punycode ACE form
std::string unicodeToPunycode(const std::string& domain) {
    std::string result;
    std::string label;
    bool needsEncoding = false;
    auto flushLabel = [&]() {
        bool hasNonASCII = false;
        for (unsigned char ch : label) if (ch >= 128) { hasNonASCII = true; break; }
        if (hasNonASCII) {
            result += "xn--";
            result += encodeLabel(label);
            needsEncoding = true;
        } else {
            result += label;
        }
        label.clear();
    };
    for (char ch : domain) {
        if (ch == '.') { flushLabel(); result += '.'; }
        else label += ch;
    }
    flushLabel();
    return result;
}

} // namespace punycode

// ──────────────────────────────── Tokenizer ──────────────────────────────────

ZoneTokenizer::ZoneTokenizer() : pos_(0), lineNum_(1) {}

void ZoneTokenizer::feed(const char* data, size_t len) {
    buf_.append(data, len);
}

void ZoneTokenizer::reset() {
    buf_.clear();
    pos_ = 0;
    lineNum_ = 1;
}

// Returns the remainder of the buffer that hasn't been consumed yet
std::string ZoneTokenizer::unconsumed() const {
    return buf_.substr(pos_);
}

void ZoneTokenizer::consumeConsumed() {
    buf_ = buf_.substr(pos_);
    pos_ = 0;
}

// Skip whitespace (not newlines)
void ZoneTokenizer::skipWS() {
    while (pos_ < buf_.size() && (buf_[pos_] == ' ' || buf_[pos_] == '\t'))
        ++pos_;
}

// Read a single token (handles quoted strings)
std::string ZoneTokenizer::readToken() {
    skipWS();
    if (pos_ >= buf_.size()) return "";
    char c = buf_[pos_];
    if (c == '"') {
        ++pos_;
        std::string tok;
        while (pos_ < buf_.size() && buf_[pos_] != '"') {
            if (buf_[pos_] == '\\') {
                ++pos_;
                if (pos_ < buf_.size()) tok += buf_[pos_++];
            } else {
                tok += buf_[pos_++];
            }
        }
        if (pos_ < buf_.size()) ++pos_; // closing "
        return tok;
    }
    if (c == '(' || c == ')' || c == '\n' || c == '\r' || c == ';')
        return "";
    std::string tok;
    while (pos_ < buf_.size()) {
        char ch = buf_[pos_];
        if (ch == ' ' || ch == '\t' || ch == '(' || ch == ')' ||
            ch == '\n' || ch == '\r' || ch == ';')
            break;
        tok += ch; ++pos_;
    }
    return tok;
}

// Read the rest of the line (for TXT / comments etc.)
std::string ZoneTokenizer::readToEOL() {
    skipWS();
    std::string line;
    while (pos_ < buf_.size() && buf_[pos_] != '\n' && buf_[pos_] != '\r') {
        line += buf_[pos_++];
    }
    // strip inline comment
    auto sc = line.find(';');
    if (sc != std::string::npos) line = line.substr(0, sc);
    // trim trailing spaces
    while (!line.empty() && (line.back() == ' ' || line.back() == '\t'))
        line.pop_back();
    return line;
}

// ─────────────────────────────── Zone Parser ─────────────────────────────────

ZoneParser::ZoneParser(bool convertIDN) : convertIDN_(convertIDN),
    defaultTTL_(3600), currentTTL_(3600), lineNum_(1) {}

void ZoneParser::reset() {
    tok_.reset();
    origin_.clear();
    lastName_.clear();
    defaultTTL_ = 3600;
    currentTTL_ = 3600;
    lineNum_ = 1;
}

static bool isDigit(char c) { return c >= '0' && c <= '9'; }

static bool caseInsensitiveEq(const std::string& a, const std::string& b) {
    if (a.size() != b.size()) return false;
    for (size_t i = 0; i < a.size(); ++i)
        if (std::tolower((unsigned char)a[i]) != std::tolower((unsigned char)b[i]))
            return false;
    return true;
}

// Expand a name relative to origin
std::string ZoneParser::expandName(const std::string& name) {
    if (name == "@") return origin_.empty() ? "." : origin_;
    if (name.empty()) return origin_.empty() ? "." : origin_;
    // Already absolute?
    if (name.back() == '.') {
        std::string n = name;
        if (convertIDN_) n = punycode::punycodeToUnicode(n);
        return n;
    }
    // Relative – append origin
    std::string full = name;
    if (!origin_.empty()) {
        full += "." + origin_;
    }
    if (full.back() != '.') full += ".";
    if (convertIDN_) full = punycode::punycodeToUnicode(full);
    return full;
}

// Parse a TTL string like "3600", "1h", "1d", "1w"
static uint32_t parseTTL(const std::string& s) {
    if (s.empty()) return 0;
    uint32_t total = 0, cur = 0;
    for (char c : s) {
        if (isDigit(c)) {
            cur = cur * 10 + (c - '0');
        } else {
            switch (std::tolower((unsigned char)c)) {
                case 's': total += cur; break;
                case 'm': total += cur * 60; break;
                case 'h': total += cur * 3600; break;
                case 'd': total += cur * 86400; break;
                case 'w': total += cur * 604800; break;
                default: total += cur; break;
            }
            cur = 0;
        }
    }
    return total + cur;
}

// Feed a chunk; returns parsed records so far
std::vector<ZoneRecord> ZoneParser::feed(const char* data, size_t len) {
    tok_.feed(data, len);
    std::vector<ZoneRecord> records;
    parseLines(records, false);
    tok_.consumeConsumed();
    return records;
}

// Flush remaining buffer at EOF
std::vector<ZoneRecord> ZoneParser::flush() {
    std::vector<ZoneRecord> records;
    parseLines(records, true);
    tok_.consumeConsumed();
    return records;
}

void ZoneParser::parseLines(std::vector<ZoneRecord>& records, bool eof) {
    auto& buf = tok_.buf_;
    auto& pos = tok_.pos_;

    while (pos < buf.size()) {
        // Skip blank lines and comments
        // Handle multi-line parenthesized groups by pre-processing

        // Skip leading whitespace and check for blank / comment line
        if (buf[pos] == '\n' || buf[pos] == '\r') {
            if (buf[pos] == '\r' && pos + 1 < buf.size() && buf[pos+1] == '\n') ++pos;
            ++pos; ++lineNum_;
            continue;
        }

        // Find end of logical line (handling parentheses)
        // We gather the full logical line first
        std::string logicalLine;
        bool inParen = false;
        bool inQuote = false;
        bool complete = false;

        size_t scanPos = pos;
        while (scanPos < buf.size()) {
            char c = buf[scanPos];
            if (!inQuote && !inParen && (c == '\n' || c == '\r')) {
                ++scanPos;
                if (c == '\r' && scanPos < buf.size() && buf[scanPos] == '\n') ++scanPos;
                complete = true;
                break;
            }
            if (!inQuote && c == ';' && !inParen) {
                // comment to EOL
                while (scanPos < buf.size() && buf[scanPos] != '\n' && buf[scanPos] != '\r')
                    ++scanPos;
                continue;
            }
            if (c == '"' && !inQuote) { inQuote = true; logicalLine += c; ++scanPos; continue; }
            if (c == '"' && inQuote)  { inQuote = false; logicalLine += c; ++scanPos; continue; }
            if (!inQuote && c == '(') { inParen = true; logicalLine += ' '; ++scanPos; continue; }
            if (!inQuote && c == ')') { inParen = false; logicalLine += ' '; ++scanPos; continue; }
            if (!inQuote && !inParen && c == ';') continue;
            // Replace newlines inside parens with spaces
            if ((c == '\n' || c == '\r') && inParen) {
                if (c == '\r' && scanPos + 1 < buf.size() && buf[scanPos+1] == '\n') ++scanPos;
                ++scanPos; ++lineNum_;
                logicalLine += ' ';
                continue;
            }
            logicalLine += c;
            ++scanPos;
        }

        if (!complete && !eof) {
            // Need more data
            break;
        }

        pos = scanPos;
        ++lineNum_;

        // Trim trailing whitespace
        while (!logicalLine.empty() && (logicalLine.back() == ' ' || logicalLine.back() == '\t'))
            logicalLine.pop_back();

        if (logicalLine.empty()) continue;

        // Inline comment already removed; now parse the logical line
        ZoneRecord rec = parseLine(logicalLine);
        if (rec.type == "SKIP" || rec.type.empty()) continue;
        records.push_back(std::move(rec));
    }
}

ZoneRecord ZoneParser::parseLine(const std::string& line) {
    ZoneRecord rec;
    rec.ttl = currentTTL_;

    // Tokenize the line
    size_t p = 0;
    auto skipWS = [&]() {
        while (p < line.size() && (line[p] == ' ' || line[p] == '\t')) ++p;
    };
    auto readTok = [&]() -> std::string {
        skipWS();
        if (p >= line.size()) return "";
        if (line[p] == '"') {
            ++p;
            std::string t;
            while (p < line.size() && line[p] != '"') {
                if (line[p] == '\\') { ++p; if (p < line.size()) t += line[p++]; }
                else t += line[p++];
            }
            if (p < line.size()) ++p;
            return t;
        }
        std::string t;
        while (p < line.size() && line[p] != ' ' && line[p] != '\t') {
            t += line[p++];
        }
        return t;
    };

    // Directive?
    if (!line.empty() && line[0] == '$') {
        std::string dir = readTok();
        std::string val = readTok();
        if (caseInsensitiveEq(dir, "$ORIGIN")) {
            origin_ = val;
            if (!origin_.empty() && origin_.back() != '.') origin_ += ".";
            if (convertIDN_) origin_ = punycode::punycodeToUnicode(origin_);
            lastName_ = "";
        } else if (caseInsensitiveEq(dir, "$TTL")) {
            defaultTTL_ = currentTTL_ = parseTTL(val);
        }
        rec.type = "SKIP";
        return rec;
    }

    // Determine NAME field
    // If line starts with whitespace → same name as last
    bool startsWithWS = (line[0] == ' ' || line[0] == '\t');
    std::string name;
    if (startsWithWS) {
        name = lastName_.empty() ? origin_ : lastName_;
    } else {
        name = readTok();
    }

    // Expand name
    if (name.empty() || name == "@") {
        name = origin_.empty() ? "." : origin_;
    } else if (name.back() != '.') {
        name = name + "." + (origin_.empty() ? "" : origin_);
        if (name.back() != '.') name += ".";
    }
    if (convertIDN_) name = punycode::punycodeToUnicode(name);
    lastName_ = name;
    rec.name = name;

    // Next token: TTL or class or type
    skipWS();
    std::string tok1 = readTok();
    std::string tok2, tok3;

    uint32_t ttl = 0;
    bool hasTTL = false;
    std::string cls;
    std::string type;

    // Determine if tok1 is TTL, CLASS or TYPE
    auto isClass = [](const std::string& s) {
        return caseInsensitiveEq(s, "IN") || caseInsensitiveEq(s, "CH") ||
               caseInsensitiveEq(s, "HS") || caseInsensitiveEq(s, "ANY");
    };
    auto isTTLStr = [](const std::string& s) -> bool {
        if (s.empty()) return false;
        if (isDigit(s[0])) return true;
        // like 1h, 2d, etc.
        return false;
    };
    if (isTTLStr(tok1)) {
        ttl = parseTTL(tok1);
        hasTTL = true;
        tok2 = readTok();
        if (isClass(tok2)) { cls = tok2; tok3 = readTok(); type = tok3; }
        else { type = tok2; }
    } else if (isClass(tok1)) {
        cls = tok1;
        tok2 = readTok();
        if (isTTLStr(tok2)) { ttl = parseTTL(tok2); hasTTL = true; type = readTok(); }
        else { type = tok2; }
    } else {
        type = tok1;
    }

    if (!hasTTL) ttl = currentTTL_;
    if (cls.empty()) cls = "IN";

    rec.ttl  = ttl;
    rec.cls  = cls;
    rec.type = toUpperType(type);

    // Read RDATA based on type
    skipWS();
    parseRdata(rec, line, p);

    return rec;
}

std::string ZoneParser::toUpperType(const std::string& s) {
    std::string u = s;
    std::transform(u.begin(), u.end(), u.begin(), ::toupper);
    return u;
}

void ZoneParser::parseRdata(ZoneRecord& rec, const std::string& line, size_t& p) {
    auto skipWS = [&]() {
        while (p < line.size() && (line[p] == ' ' || line[p] == '\t')) ++p;
    };
    auto readTok = [&]() -> std::string {
        skipWS();
        if (p >= line.size()) return "";
        if (line[p] == '"') {
            ++p;
            std::string t;
            while (p < line.size() && line[p] != '"') {
                if (line[p] == '\\') { ++p; if (p < line.size()) t += line[p++]; }
                else t += line[p++];
            }
            if (p < line.size()) ++p;
            return t;
        }
        std::string t;
        while (p < line.size() && line[p] != ' ' && line[p] != '\t') t += line[p++];
        return t;
    };
    auto readRest = [&]() -> std::string {
        skipWS();
        std::string r = line.substr(p);
        // strip trailing spaces
        while (!r.empty() && (r.back() == ' ' || r.back() == '\t')) r.pop_back();
        p = line.size();
        return r;
    };

    const std::string& type = rec.type;

    if (type == "A") {
        rec.rdata["address"] = readTok();
    } else if (type == "AAAA") {
        rec.rdata["address"] = readTok();
    } else if (type == "CNAME" || type == "PTR" || type == "NS" || type == "DNAME") {
        std::string t = readTok();
        rec.rdata["target"] = expandName(t);
    } else if (type == "MX") {
        rec.rdata["preference"] = readTok();
        std::string ex = readTok();
        rec.rdata["exchange"] = expandName(ex);
    } else if (type == "SOA") {
        rec.rdata["mname"]   = expandName(readTok());
        rec.rdata["rname"]   = expandName(readTok());
        rec.rdata["serial"]  = readTok();
        rec.rdata["refresh"] = readTok();
        rec.rdata["retry"]   = readTok();
        rec.rdata["expire"]  = readTok();
        rec.rdata["minimum"] = readTok();
    } else if (type == "TXT" || type == "SPF") {
        // Collect all quoted/unquoted strings and concatenate
        std::string full;
        while (p < line.size()) {
            skipWS();
            if (p >= line.size()) break;
            std::string part;
            if (line[p] == '"') {
                ++p;
                while (p < line.size() && line[p] != '"') {
                    if (line[p] == '\\') { ++p; if (p < line.size()) part += line[p++]; }
                    else part += line[p++];
                }
                if (p < line.size()) ++p;
            } else {
                while (p < line.size() && line[p] != ' ' && line[p] != '\t') part += line[p++];
            }
            full += part;
        }
        rec.rdata["data"] = full;
    } else if (type == "SRV") {
        rec.rdata["priority"] = readTok();
        rec.rdata["weight"]   = readTok();
        rec.rdata["port"]     = readTok();
        rec.rdata["target"]   = expandName(readTok());
    } else if (type == "CAA") {
        rec.rdata["flags"] = readTok();
        rec.rdata["tag"]   = readTok();
        // value may be quoted
        std::string val = readTok();
        rec.rdata["value"] = val;
    } else if (type == "NAPTR") {
        rec.rdata["order"]       = readTok();
        rec.rdata["preference"]  = readTok();
        rec.rdata["flags"]       = readTok();
        rec.rdata["service"]     = readTok();
        rec.rdata["regexp"]      = readTok();
        rec.rdata["replacement"] = expandName(readTok());
    } else if (type == "SSHFP") {
        rec.rdata["algorithm"]      = readTok();
        rec.rdata["fp_type"]        = readTok();
        rec.rdata["fingerprint"]    = readTok();
    } else if (type == "TLSA") {
        rec.rdata["usage"]        = readTok();
        rec.rdata["selector"]     = readTok();
        rec.rdata["matching_type"]= readTok();
        rec.rdata["certificate"]  = readRest();
    } else if (type == "DS") {
        rec.rdata["key_tag"]   = readTok();
        rec.rdata["algorithm"] = readTok();
        rec.rdata["digest_type"]= readTok();
        rec.rdata["digest"]    = readRest();
    } else if (type == "DNSKEY") {
        rec.rdata["flags"]     = readTok();
        rec.rdata["protocol"]  = readTok();
        rec.rdata["algorithm"] = readTok();
        rec.rdata["public_key"]= readRest();
    } else if (type == "NSEC") {
        rec.rdata["next_domain"] = expandName(readTok());
        rec.rdata["types"]       = readRest();
    } else if (type == "NSEC3") {
        rec.rdata["hash_algorithm"] = readTok();
        rec.rdata["flags"]          = readTok();
        rec.rdata["iterations"]     = readTok();
        rec.rdata["salt"]           = readTok();
        rec.rdata["next_hashed"]    = readTok();
        rec.rdata["types"]          = readRest();
    } else if (type == "RRSIG") {
        rec.rdata["type_covered"]  = readTok();
        rec.rdata["algorithm"]     = readTok();
        rec.rdata["labels"]        = readTok();
        rec.rdata["orig_ttl"]      = readTok();
        rec.rdata["sig_expiration"]= readTok();
        rec.rdata["sig_inception"] = readTok();
        rec.rdata["key_tag"]       = readTok();
        rec.rdata["signer_name"]   = expandName(readTok());
        rec.rdata["signature"]     = readRest();
    } else if (type == "HINFO") {
        rec.rdata["cpu"] = readTok();
        rec.rdata["os"]  = readTok();
    } else if (type == "URI") {
        rec.rdata["priority"] = readTok();
        rec.rdata["weight"]   = readTok();
        rec.rdata["target"]   = readTok();
    } else if (type == "SVCB" || type == "HTTPS") {
        rec.rdata["svc_priority"] = readTok();
        rec.rdata["target_name"]  = expandName(readTok());
        rec.rdata["svc_params"]   = readRest();
    } else if (type == "LOC") {
        rec.rdata["location"] = readRest();
    } else if (type == "RP") {
        rec.rdata["mbox"]   = expandName(readTok());
        rec.rdata["txtdname"]= expandName(readTok());
    } else if (type == "AFSDB") {
        rec.rdata["subtype"] = readTok();
        rec.rdata["hostname"]= expandName(readTok());
    } else if (type == "CERT") {
        rec.rdata["type"]      = readTok();
        rec.rdata["key_tag"]   = readTok();
        rec.rdata["algorithm"] = readTok();
        rec.rdata["certificate"]= readRest();
    } else if (type == "OPENPGPKEY") {
        rec.rdata["public_key"] = readRest();
    } else if (type == "ZONEMD") {
        rec.rdata["serial"]    = readTok();
        rec.rdata["scheme"]    = readTok();
        rec.rdata["algorithm"] = readTok();
        rec.rdata["digest"]    = readRest();
    } else if (type == "CDS") {
        rec.rdata["key_tag"]    = readTok();
        rec.rdata["algorithm"]  = readTok();
        rec.rdata["digest_type"]= readTok();
        rec.rdata["digest"]     = readRest();
    } else if (type == "CDNSKEY") {
        rec.rdata["flags"]     = readTok();
        rec.rdata["protocol"]  = readTok();
        rec.rdata["algorithm"] = readTok();
        rec.rdata["public_key"]= readRest();
    } else {
        // Unknown type — store raw rdata
        rec.rdata["raw"] = readRest();
    }
}

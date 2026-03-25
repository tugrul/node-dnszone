// node_binding.cc — NAPI bindings for Node.js Transform stream
// Wraps ZoneParser in a Transform-compatible C++ object that emits JS objects.

#include <napi.h>
#include "zone_parser.h"
#include <vector>
#include <string>

// ───────────────── Helper: ZoneRecord → Napi::Object ────────────────────────

static Napi::Object recordToJS(Napi::Env env, const ZoneRecord& rec) {
    auto obj = Napi::Object::New(env);
    obj.Set("name", Napi::String::New(env, rec.name));
    obj.Set("ttl",  Napi::Number::New(env, rec.ttl));
    obj.Set("class", Napi::String::New(env, rec.cls));
    obj.Set("type", Napi::String::New(env, rec.type));

    auto rdata = Napi::Object::New(env);
    for (auto& kv : rec.rdata) {
        rdata.Set(kv.first, Napi::String::New(env, kv.second));
    }
    obj.Set("rdata", rdata);
    return obj;
}

// ─────────────────── ZoneParserWrapper (wrapped object) ─────────────────────

class ZoneParserWrapper : public Napi::ObjectWrap<ZoneParserWrapper> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);

    ZoneParserWrapper(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<ZoneParserWrapper>(info),
          parser_(false)
    {
        bool convertIDN = false;
        if (info.Length() >= 1 && info[0].IsObject()) {
            Napi::Object opts = info[0].As<Napi::Object>();
            if (opts.Has("convertIDN") && opts.Get("convertIDN").IsBoolean()) {
                convertIDN = opts.Get("convertIDN").As<Napi::Boolean>().Value();
            }
        }
        parser_ = ZoneParser(convertIDN);
    }

    // write(chunk: Buffer|string) → ZoneRecord[]
    Napi::Value Write(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (info.Length() < 1) {
            Napi::TypeError::New(env, "Expected buffer or string").ThrowAsJavaScriptException();
            return env.Undefined();
        }
        std::vector<ZoneRecord> records;
        if (info[0].IsBuffer()) {
            auto buf = info[0].As<Napi::Buffer<char>>();
            records = parser_.feed(buf.Data(), buf.ByteLength());
        } else if (info[0].IsString()) {
            std::string s = info[0].As<Napi::String>().Utf8Value();
            records = parser_.feed(s.data(), s.size());
        } else {
            Napi::TypeError::New(env, "Expected buffer or string").ThrowAsJavaScriptException();
            return env.Undefined();
        }
        return toArray(env, records);
    }

    // flush() → ZoneRecord[]   (call at end-of-stream)
    Napi::Value Flush(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        auto records = parser_.flush();
        return toArray(env, records);
    }

    // reset() → void
    Napi::Value Reset(const Napi::CallbackInfo& info) {
        parser_.reset();
        return info.Env().Undefined();
    }

    static Napi::FunctionReference constructor;

private:
    ZoneParser parser_;

    Napi::Array toArray(Napi::Env env, const std::vector<ZoneRecord>& recs) {
        auto arr = Napi::Array::New(env, recs.size());
        for (size_t i = 0; i < recs.size(); ++i) {
            arr[i] = recordToJS(env, recs[i]);
        }
        return arr;
    }
};

Napi::FunctionReference ZoneParserWrapper::constructor;

Napi::Object ZoneParserWrapper::Init(Napi::Env env, Napi::Object exports) {
    auto func = DefineClass(env, "ZoneParserCore", {
        InstanceMethod("write", &ZoneParserWrapper::Write),
        InstanceMethod("flush", &ZoneParserWrapper::Flush),
        InstanceMethod("reset", &ZoneParserWrapper::Reset),
    });
    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();
    exports.Set("ZoneParserCore", func);
    return exports;
}

// ─────────────────────────── Module Init ────────────────────────────────────

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    ZoneParserWrapper::Init(env, exports);
    return exports;
}

NODE_API_MODULE(zone, Init)

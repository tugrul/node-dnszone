# dnszone

High-performance DNS zone file parser built as a **native Node.js C++ addon** (N-API).  
Reads zone file content from a stream and emits structured JavaScript objects — all parsing, tokenisation, name expansion, and optional IDN punycode→Unicode conversion happen entirely in C++ for maximum throughput.

```
100 000 A records → parsed in ~650 ms on a single core
```

Two flavours are provided so you can pick the one that fits your codebase:

| Flavour | Import | Runtime |
|---|---|---|
| Classic Node.js `Transform` stream | `require('dnszone')` | Node.js ≥ 16 |
| WHATWG `TransformStream` (Web Streams) | `require('dnszone/web')` | Node.js ≥ 18, Deno, Bun |

---

## Installation

```bash
npm install dnszone
```

The addon is compiled during `npm install` via `node-gyp`.  
Requirements: Node.js ≥ 16, Python 3, a C++17 compiler (`g++` / `clang++` / MSVC 2019+).

---

## Quick start

### Classic Node.js Transform stream

```js
const fs = require('fs');
const { ZoneTransform } = require('dnszone');

const transform = new ZoneTransform({ convertIDN: true });

fs.createReadStream('/var/named/db.example.com')
  .pipe(transform)
  .on('data', record => {
    console.log(record.name, record.type, record.rdata);
  })
  .on('end', () => console.log('done'));
```

### Async iteration (recommended)

```js
const fs = require('fs');
const { parseStream } = require('dnszone');

const readable = fs.createReadStream('/var/named/db.example.com');

for await (const record of parseStream(readable, { convertIDN: true })) {
  if (record.type === 'MX') {
    console.log(`MX ${record.rdata.preference} → ${record.rdata.exchange}`);
  }
}
```

### Web Streams (WHATWG TransformStream)

```js
const fs = require('fs');
const { createZoneTransformStream } = require('dnszone/web');

// Node.js ≥ 18: fs.createReadStream can be piped via .pipeThrough
const nodeReadable = fs.createReadStream('/var/named/db.example.com');
const webReadable  = ReadableStream.from(nodeReadable);  // Node 18+

const piped = webReadable.pipeThrough(
  createZoneTransformStream({ convertIDN: true })
);

for await (const record of piped) {
  console.log(record.name, record.type);
}
```

### Fetch + Web Streams (browser / edge runtime)

```js
import { createZoneTransformStream } from 'dnszone/web';

const response = await fetch('https://cdn.example.com/zones/db.example.com');
const stream = response.body.pipeThrough(createZoneTransformStream({ convertIDN: true }));

for await (const record of stream) {
  console.log(record);
}
```

### Synchronous one-shot parse

Both flavours export a `parseSync` convenience function for smaller files that fit in memory:

```js
const { parseSync } = require('dnszone');          // or 'dnszone/web'
const fs = require('fs');

const records = parseSync(fs.readFileSync('/var/named/db.example.com'));
const soaRecord = records.find(r => r.type === 'SOA');
console.log(soaRecord);
```

---

## API reference

### `dnszone` (classic Node.js stream)

#### `new ZoneTransform(options?)`

A Node.js `Transform` stream.

- **Writable side**: accepts `Buffer | string` chunks (raw zone file bytes)
- **Readable side**: object mode — emits `ZoneRecord` objects

| Option | Type | Default | Description |
|---|---|---|---|
| `convertIDN` | `boolean` | `false` | Decode `xn--` punycode labels to Unicode in names and target fields |
| `highWaterMark` | `number` | — | Passed to `Transform` constructor |

```js
const t = new ZoneTransform({ convertIDN: true });
readable.pipe(t);
t.on('data', rec => console.log(rec));
```

---

#### `parseStream(readable, options?) → AsyncGenerator<ZoneRecord>`

Convenience wrapper. Pipes `readable` through a `ZoneTransform` and yields records.

```js
for await (const rec of parseStream(fs.createReadStream('zone.txt'))) {
  process(rec);
}
```

---

#### `parseSync(content, options?) → ZoneRecord[]`

Parse an entire zone file synchronously.

- `content` — `string | Buffer`
- Returns an array of `ZoneRecord` objects

---

### `dnszone/web` (WHATWG TransformStream)

#### `createZoneTransformStream(options?) → TransformStream`

Returns a WHATWG `TransformStream` whose readable side emits `ZoneRecord` objects.

| Option | Type | Default | Description |
|---|---|---|---|
| `convertIDN` | `boolean` | `false` | Decode punycode labels to Unicode |
| `TransformStream` | `class` | `globalThis.TransformStream` | Override for polyfills / older Node.js |

```js
const ts = createZoneTransformStream({ convertIDN: true });
const out = someWebReadableStream.pipeThrough(ts);
```

**Polyfill example (Node.js 16/17):**

```js
const { TransformStream } = require('web-streams-polyfill');
const ts = createZoneTransformStream({ convertIDN: true, TransformStream });
```

---

#### `parseSync(content, options?) → ZoneRecord[]`

Same as the node-stream flavour but accepts `string | Uint8Array | Buffer`.

---

## ZoneRecord schema

Every record emitted by the stream has this shape:

```ts
interface ZoneRecord {
  name:  string;   // Fully-qualified owner name, always ends with "."
  ttl:   number;   // TTL in seconds (number, not string)
  class: string;   // DNS class, usually "IN"
  type:  string;   // Record type in UPPER CASE, e.g. "A", "MX", "SOA"
  rdata: object;   // Type-specific fields (see below)
}
```

### RDATA fields by record type

| Type | RDATA fields |
|---|---|
| `A` | `address` |
| `AAAA` | `address` |
| `CNAME` `PTR` `NS` `DNAME` | `target` |
| `MX` | `preference`, `exchange` |
| `SOA` | `mname`, `rname`, `serial`, `refresh`, `retry`, `expire`, `minimum` |
| `TXT` `SPF` | `data` (all strings concatenated) |
| `SRV` | `priority`, `weight`, `port`, `target` |
| `CAA` | `flags`, `tag`, `value` |
| `NAPTR` | `order`, `preference`, `flags`, `service`, `regexp`, `replacement` |
| `SSHFP` | `algorithm`, `fp_type`, `fingerprint` |
| `TLSA` | `usage`, `selector`, `matching_type`, `certificate` |
| `DS` `CDS` | `key_tag`, `algorithm`, `digest_type`, `digest` |
| `DNSKEY` `CDNSKEY` | `flags`, `protocol`, `algorithm`, `public_key` |
| `NSEC` | `next_domain`, `types` |
| `NSEC3` | `hash_algorithm`, `flags`, `iterations`, `salt`, `next_hashed`, `types` |
| `RRSIG` | `type_covered`, `algorithm`, `labels`, `orig_ttl`, `sig_expiration`, `sig_inception`, `key_tag`, `signer_name`, `signature` |
| `HINFO` | `cpu`, `os` |
| `URI` | `priority`, `weight`, `target` |
| `HTTPS` `SVCB` | `svc_priority`, `target_name`, `svc_params` |
| `LOC` | `location` (raw string) |
| `RP` | `mbox`, `txtdname` |
| `AFSDB` | `subtype`, `hostname` |
| `CERT` | `type`, `key_tag`, `algorithm`, `certificate` |
| `OPENPGPKEY` | `public_key` |
| `ZONEMD` | `serial`, `scheme`, `algorithm`, `digest` |
| Unknown | `raw` |

All field values are strings (numbers remain as strings to preserve precision for large serials). The `ttl` field on the record itself is always a JavaScript `number`.

---

## IDN / Punycode support

Pass `{ convertIDN: true }` to automatically decode internationalized domain name labels in ACE form (`xn--…`) back to their Unicode representation.

```js
// Zone file contains:  xn--o9je3hr65l74c16c.com.  (Japan "例となる名前.com")
const records = parseSync(zone, { convertIDN: true });
console.log(records[0].name);  // → "例となる名前.com."
```

With `convertIDN: false` (default), names are returned exactly as they appear in the zone file.

The punycode implementation is self-contained in the C++ addon — no external ICU or libidn dependency is required.

---

## Zone file directives

| Directive | Support |
|---|---|
| `$ORIGIN` | ✅ Sets the default origin for relative names |
| `$TTL` | ✅ Sets the default TTL for subsequent records |
| `( … )` | ✅ Multi-line grouping (SOA, DNSKEY, etc.) |
| `;` comments | ✅ Inline and full-line |
| `@` shorthand | ✅ Expands to current `$ORIGIN` |
| Continuation (leading whitespace → same name) | ✅ |
| TTL qualifiers (`s` `m` `h` `d` `w`) | ✅ e.g. `1h30m` = 5400 s |

---

## TypeScript

Type definitions are included in `types.d.ts` and referenced automatically.

```ts
import { ZoneTransform, parseSync, ZoneRecord, SOARdata } from 'dnszone';
import { createZoneTransformStream } from 'dnszone/web';

const records: ZoneRecord[] = parseSync(zoneContent);
const soa = records.find((r): r is ZoneRecord<'SOA'> => r.type === 'SOA');
if (soa) {
  const rd: SOARdata = soa.rdata;
  console.log(rd.mname, rd.serial);
}
```

---

## Building from source

```bash
git clone https://github.com/your-org/node-dnszone.git
cd dnszone
npm install
npm run build   # runs node-gyp configure build
npm test
```

On systems where Node.js headers aren't in the default location:

```bash
npm run build -- --nodedir=/path/to/node
```

---

## Architecture

```
zone file bytes (stream chunks)
        │
        ▼
┌───────────────────────────────────────────┐
│             C++ Addon (N-API)             │
│                                           │
│  ZoneTokenizer  ──▶  ZoneParser           │
│  (buffer mgmt)       (RFC 1035 / 2782 /   │
│                       4034 / 6844 / …)    │
│                            │              │
│                       punycode::          │
│                   punycodeToUnicode()     │
│                   (self-contained impl)   │
└───────────────────────────┬───────────────┘
                            │  ZoneRecord[]  (returned to JS per chunk)
                            ▼
        ┌───────────────────────────────────┐
        │         JavaScript layer          │
        │                                   │
        │  ZoneTransform (Node stream)      │
        │  createZoneTransformStream (Web)  │
        │  parseSync / parseStream          │
        └───────────────────────────────────┘
```

The C++ layer does **everything**: buffering across chunk boundaries, parenthesis grouping, comment stripping, name expansion, TTL parsing (with time-unit suffixes), and per-type RDATA field extraction. The JavaScript layer is a thin adapter that wraps the N-API object and connects it to your choice of streaming API.

---

## License

MIT

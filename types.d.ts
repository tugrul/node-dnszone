/**
 * dnszone — TypeScript type definitions
 *
 * Supports both Node.js classic Transform streams and Web Streams (WHATWG).
 */

// ──────────────────────────── DNS Record Types ────────────────────────────────

/** Raw RDATA fields for an A record */
export interface ARdata {
    address: string;         // IPv4 address, e.g. "93.184.216.34"
}

/** Raw RDATA fields for an AAAA record */
export interface AAAARdata {
    address: string;         // IPv6 address, e.g. "2606:2800:220:1:248:1893:25c8:1946"
}

/** CNAME / PTR / NS / DNAME – single target name */
export interface TargetRdata {
    target: string;          // Fully-qualified target name
}

/** MX record */
export interface MXRdata {
    preference: string;      // Preference value (numeric string)
    exchange:   string;      // Mail exchange FQDN
}

/** SOA record */
export interface SOARdata {
    mname:   string;         // Primary nameserver FQDN
    rname:   string;         // Responsible mailbox (FQDN with first dot as @)
    serial:  string;         // Zone serial number
    refresh: string;         // Refresh interval (seconds)
    retry:   string;         // Retry interval (seconds)
    expire:  string;         // Expire interval (seconds)
    minimum: string;         // Negative TTL / minimum TTL (seconds)
}

/** TXT / SPF record */
export interface TXTRdata {
    data: string;            // Concatenated text strings (quotes removed)
}

/** SRV record */
export interface SRVRdata {
    priority: string;
    weight:   string;
    port:     string;
    target:   string;
}

/** CAA record */
export interface CAARdata {
    flags: string;
    tag:   string;           // e.g. "issue", "issuewild", "iodef"
    value: string;           // CA identity or URL
}

/** NAPTR record */
export interface NAPTRRdata {
    order:       string;
    preference:  string;
    flags:       string;
    service:     string;
    regexp:      string;
    replacement: string;
}

/** SSHFP record */
export interface SSHFPRdata {
    algorithm:   string;     // 1=RSA, 2=DSA, 3=ECDSA, 4=Ed25519
    fp_type:     string;     // 1=SHA-1, 2=SHA-256
    fingerprint: string;     // Hex-encoded fingerprint
}

/** TLSA record */
export interface TLSARdata {
    usage:         string;
    selector:      string;
    matching_type: string;
    certificate:   string;   // Hex-encoded
}

/** DS record */
export interface DSRdata {
    key_tag:     string;
    algorithm:   string;
    digest_type: string;
    digest:      string;     // Hex-encoded
}

/** DNSKEY record */
export interface DNSKEYRdata {
    flags:      string;
    protocol:   string;
    algorithm:  string;
    public_key: string;      // Base64-encoded
}

/** NSEC record */
export interface NSECRdata {
    next_domain: string;
    types:       string;     // Space-separated type bitmap, e.g. "A AAAA MX"
}

/** NSEC3 record */
export interface NSEC3Rdata {
    hash_algorithm: string;
    flags:          string;
    iterations:     string;
    salt:           string;
    next_hashed:    string;
    types:          string;
}

/** RRSIG record */
export interface RRSIGRdata {
    type_covered:  string;
    algorithm:     string;
    labels:        string;
    orig_ttl:      string;
    sig_expiration: string;
    sig_inception:  string;
    key_tag:       string;
    signer_name:   string;
    signature:     string;
}

/** HINFO record */
export interface HINFORdata {
    cpu: string;
    os:  string;
}

/** URI record */
export interface URIRdata {
    priority: string;
    weight:   string;
    target:   string;
}

/** SVCB / HTTPS record */
export interface SVCBRdata {
    svc_priority: string;
    target_name:  string;
    svc_params:   string;
}

/** LOC record */
export interface LOCRdata {
    location: string;        // Raw LOC RDATA string
}

/** RP record */
export interface RPRdata {
    mbox:    string;
    txtdname: string;
}

/** AFSDB record */
export interface AFSDBRdata {
    subtype:  string;
    hostname: string;
}

/** CERT record */
export interface CERTRdata {
    type:        string;
    key_tag:     string;
    algorithm:   string;
    certificate: string;
}

/** OPENPGPKEY record */
export interface OPENPGPKEYRdata {
    public_key: string;
}

/** ZONEMD record */
export interface ZONEMDRdata {
    serial:    string;
    scheme:    string;
    algorithm: string;
    digest:    string;
}

/** CDS record */
export interface CDSRdata {
    key_tag:     string;
    algorithm:   string;
    digest_type: string;
    digest:      string;
}

/** CDNSKEY record */
export interface CDNSKEYRdata {
    flags:      string;
    protocol:   string;
    algorithm:  string;
    public_key: string;
}

/** Unknown / generic record type */
export interface UnknownRdata {
    raw: string;
}

// ──────────────────── Discriminated union of RDATA by type ───────────────────

export type RdataByType = {
    A:          ARdata;
    AAAA:       AAAARdata;
    CNAME:      TargetRdata;
    PTR:        TargetRdata;
    NS:         TargetRdata;
    DNAME:      TargetRdata;
    MX:         MXRdata;
    SOA:        SOARdata;
    TXT:        TXTRdata;
    SPF:        TXTRdata;
    SRV:        SRVRdata;
    CAA:        CAARdata;
    NAPTR:      NAPTRRdata;
    SSHFP:      SSHFPRdata;
    TLSA:       TLSARdata;
    DS:         DSRdata;
    DNSKEY:     DNSKEYRdata;
    NSEC:       NSECRdata;
    NSEC3:      NSEC3Rdata;
    RRSIG:      RRSIGRdata;
    HINFO:      HINFORdata;
    URI:        URIRdata;
    SVCB:       SVCBRdata;
    HTTPS:      SVCBRdata;
    LOC:        LOCRdata;
    RP:         RPRdata;
    AFSDB:      AFSDBRdata;
    CERT:       CERTRdata;
    OPENPGPKEY: OPENPGPKEYRdata;
    ZONEMD:     ZONEMDRdata;
    CDS:        CDSRdata;
    CDNSKEY:    CDNSKEYRdata;
};

export type KnownRecordType = keyof RdataByType;

// ─────────────────────────── ZoneRecord ──────────────────────────────────────

/**
 * A fully-parsed DNS resource record emitted by the stream.
 *
 * The `rdata` field is typed per-type via a conditional type, falling back
 * to `UnknownRdata` for unrecognised record types.
 */
export interface ZoneRecord<T extends string = string> {
    /** Owner name, always fully-qualified (ends with ".").
     *  If `convertIDN` was enabled, punycode labels are decoded to Unicode. */
    name:  string;

    /** TTL in seconds */
    ttl:   number;

    /** DNS class, usually "IN" */
    class: string;

    /** Record type in upper case, e.g. "A", "MX", "SOA" */
    type:  T;

    /** Type-specific RDATA fields */
    rdata: T extends KnownRecordType ? RdataByType[T] : UnknownRdata;
}

// ──────────────────────── Stream options ─────────────────────────────────────

export interface ZoneStreamOptions {
    /**
     * When `true`, punycode-encoded labels (xn--…) in owner names and
     * RDATA target fields are decoded to their Unicode equivalents.
     * @default false
     */
    convertIDN?: boolean;
}

// ──────────────── Node.js classic Transform stream exports ───────────────────

import type { Transform, TransformOptions } from 'stream';

export interface ZoneTransformOptions extends ZoneStreamOptions {
    /** Pass-through Node.js Transform stream options (except readableObjectMode,
     *  which is always `true`). */
    highWaterMark?: number;
    encoding?: BufferEncoding;
    allowHalfOpen?: boolean;
    readableObjectMode?: never;    // always true — do not set
    writableObjectMode?: boolean;
}

/**
 * A Node.js Duplex Transform stream.
 *
 * Writable side accepts `Buffer | string` chunks (zone file bytes).
 * Readable side emits `ZoneRecord` objects in object mode.
 *
 * @example
 * ```ts
 * import { ZoneTransform } from 'dnszone';
 *
 * const t = new ZoneTransform({ convertIDN: true });
 * fs.createReadStream('db.example.com').pipe(t);
 * for await (const record of t) console.log(record);
 * ```
 */
export declare class ZoneTransform extends Transform {
    constructor(options?: ZoneTransformOptions);
}

/**
 * Async-generator adapter: pipe any Readable through a ZoneTransform and
 * yield ZoneRecord objects.
 *
 * @example
 * ```ts
 * import { parseStream } from 'dnszone';
 * const r = fs.createReadStream('zone.txt');
 * for await (const rec of parseStream(r, { convertIDN: true })) {
 *   console.log(rec.name, rec.type, rec.rdata);
 * }
 * ```
 */
export declare function parseStream(
    readable: NodeJS.ReadableStream,
    options?: ZoneStreamOptions
): AsyncGenerator<ZoneRecord>;

/**
 * Synchronous convenience function: parse an entire zone file in one call.
 * Suitable for moderately-sized files that fit comfortably in memory.
 *
 * @example
 * ```ts
 * import { parseSync } from 'dnszone';
 * const records = parseSync(fs.readFileSync('zone.txt'));
 * ```
 */
export declare function parseSync(
    content: string | Buffer,
    options?: ZoneStreamOptions
): ZoneRecord[];

// ──────────────────────── Web Streams exports ─────────────────────────────────

export interface WebZoneStreamOptions extends ZoneStreamOptions {
    /**
     * Override the `TransformStream` class to use.
     * Useful for environments that do not have a built-in implementation
     * (Node.js < 18) or for testing with a polyfill.
     * @default globalThis.TransformStream
     */
    TransformStream?: typeof TransformStream;
}

/**
 * Create a WHATWG `TransformStream` that converts DNS zone file chunks
 * into `ZoneRecord` objects.
 *
 * The readable side is in object mode (non-standard extension that most
 * WHATWG-compatible runtimes tolerate; works natively in Node.js ≥ 18).
 *
 * @example
 * ```ts
 * import { createZoneTransformStream } from 'dnszone/web';
 *
 * const res = await fetch('/zones/db.example.com');
 * const stream = res.body!
 *   .pipeThrough(createZoneTransformStream({ convertIDN: true }));
 *
 * for await (const record of stream) {
 *   console.log(record.name, record.type);
 * }
 * ```
 */
export declare function createZoneTransformStream(
    options?: WebZoneStreamOptions
): TransformStream<BufferSource | string, ZoneRecord>;

/**
 * Synchronous convenience function (Web Streams flavour).
 */
export declare function parseSync(
    content: string | Uint8Array | Buffer,
    options?: ZoneStreamOptions
): ZoneRecord[];

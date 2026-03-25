'use strict';

const { Readable } = require('stream');
const { ZoneTransform, parseStream, parseSync } = require('../index');
const { createZoneTransformStream, parseSync: parseSyncWeb } = require('../web');

// ─────────────────────────────── fixtures ────────────────────────────────────

const ZONE = `
$ORIGIN example.com.
$TTL 3600

@   IN  SOA ns1.example.com. hostmaster.example.com. (
        2024010101 3600 900 604800 300 )

@       IN  NS  ns1.example.com.
@       IN  NS  ns2.example.com.

@           IN  A     93.184.216.34
www         IN  A     93.184.216.34
ipv6        IN  AAAA  2606:2800:220:1:248:1893:25c8:1946

mail        IN  CNAME smtp.example.com.
ftp         IN  CNAME www.example.com.

@           IN  MX  10  mail1.example.com.
@           IN  MX  20  mail2.example.com.

@           IN  TXT "v=spf1 include:_spf.example.com ~all"
_dmarc      IN  TXT "v=DMARC1; p=reject; rua=mailto:dmarc@example.com"
@           IN  SPF "v=spf1 mx -all"

_sip._tcp   IN  SRV  10 20 5060 sip.example.com.
_http._tcp  IN  SRV  0  0  80   www.example.com.

@           IN  CAA  0 issue "letsencrypt.org"
@           IN  CAA  0 iodef  "mailto:security@example.com"

34          IN  PTR  www.example.com.

server1     IN  HINFO "INTEL-386" "UNIX"

@           IN  LOC  37 46 29.744 N 122 25 9.816 W 32m 1m 10000m 10m

sip         IN  NAPTR 100 10 "U" "SIP+D2U" "!^.*$!sip:info@example.com!" .

_http._tcp  IN  URI 10 1 "https://example.com/path"

@           IN  RP  admin.example.com. info.example.com.

@           IN  AFSDB  1 afs.example.com.

ns1         IN  SSHFP  1 1 dd465c09cfa51fb45020cc83316fff21b9ec74ac

example.com. IN DS 12345 8 2 49FD46E6C4B45C55D4AC69CBD3CD34AC1AFE51

example.com. IN DNSKEY 256 3 8 AwEAAat3bkRyGGQ5PNUXG3hChIEHOYze7YaP1ZFB

_443._tcp.www IN TLSA 3 1 1 abcdef1234567890abcdef1234567890

@           IN  NSEC  www.example.com. A NS SOA MX TXT

www         IN  HTTPS 1 . alpn=h2,h3

_dns._udp   IN  SVCB  1 dns.example.com. port=853

@           IN  CERT  PGP 0 0 AABBCCDD==

example.com. IN  ZONEMD  2024010101 1 1 AABBCCDDEEFF==

sub         IN  A     10.0.0.1
sub.deep    IN  A     10.0.0.2
`;

const IDN_ZONE = `
$ORIGIN xn--nxasmq6b.com.
$TTL 300
@   IN  SOA  xn--nxasmq6b.com. hostmaster.xn--nxasmq6b.com. 1 3600 900 604800 300
@   IN  NS   xn--nxasmq6b.com.
@   IN  A    1.2.3.4
www IN  CNAME xn--nxasmq6b.com.
`;

// ──────────────────────────── helpers ────────────────────────────────────────

function rec(records, type, namePrefix) {
    return records.find(r =>
        r.type === type && (!namePrefix || r.name.toLowerCase().startsWith(namePrefix.toLowerCase()))
    );
}
function recs(records, type) { return records.filter(r => r.type === type); }

// Parse once; share across the whole describe block
let records;
beforeAll(() => { records = parseSync(ZONE); });

// ─────────────────────────────── tests ───────────────────────────────────────

describe('parseSync — record shape', () => {
    it('returns a non-empty array', () => {
        expect(Array.isArray(records)).toBe(true);
        expect(records.length).toBeGreaterThan(20);
    });

    it('every record has name / ttl / class / type / rdata', () => {
        for (const r of records) {
            expect(typeof r.name).toBe('string');
            expect(typeof r.ttl).toBe('number');
            expect(typeof r.class).toBe('string');
            expect(typeof r.type).toBe('string');
            expect(typeof r.rdata).toBe('object');
        }
    });
});

describe('parseSync — SOA', () => {
    let soa;
    beforeAll(() => { soa = rec(records, 'SOA'); });

    it('is present',                  () => expect(soa).toBeDefined());
    it('mname is correct',            () => expect(soa.rdata.mname).toBe('ns1.example.com.'));
    it('rname is correct',            () => expect(soa.rdata.rname).toBe('hostmaster.example.com.'));
    it('serial is correct',           () => expect(soa.rdata.serial).toBe('2024010101'));
    it('refresh / retry / expire / minimum present', () => {
        expect(soa.rdata.refresh).toBe('3600');
        expect(soa.rdata.retry).toBe('900');
        expect(soa.rdata.expire).toBe('604800');
        expect(soa.rdata.minimum).toBe('300');
    });
    it('ttl is a number',             () => expect(typeof soa.ttl).toBe('number'));
    it('class is IN',                 () => expect(soa.class).toBe('IN'));
});

describe('parseSync — NS', () => {
    it('two NS records',              () => expect(recs(records, 'NS')).toHaveLength(2));
    it('target ends with dot',        () => expect(recs(records, 'NS')[0].rdata.target).toMatch(/\.$/));
});

describe('parseSync — A / AAAA', () => {
    it('www A record present',        () => expect(rec(records, 'A', 'www')).toBeDefined());
    it('www address correct',         () => expect(rec(records, 'A', 'www').rdata.address).toBe('93.184.216.34'));
    it('AAAA record present',         () => expect(rec(records, 'AAAA')).toBeDefined());
    it('AAAA address contains colon', () => expect(rec(records, 'AAAA').rdata.address).toContain(':'));
});

describe('parseSync — CNAME', () => {
    it('mail CNAME present',          () => expect(rec(records, 'CNAME', 'mail')).toBeDefined());
    it('target is FQDN',              () => expect(rec(records, 'CNAME', 'mail').rdata.target).toMatch(/\.$/));
});

describe('parseSync — MX', () => {
    it('two MX records',              () => expect(recs(records, 'MX')).toHaveLength(2));
    it('first preference is 10',      () => expect(recs(records, 'MX')[0].rdata.preference).toBe('10'));
    it('exchange is FQDN',            () => expect(recs(records, 'MX')[0].rdata.exchange).toMatch(/\.$/));
});

describe('parseSync — TXT / SPF', () => {
    it('TXT record present',          () => expect(rec(records, 'TXT')).toBeDefined());
    it('TXT data contains spf1',      () => expect(rec(records, 'TXT').rdata.data).toContain('spf1'));
    it('SPF record present',          () => expect(rec(records, 'SPF')).toBeDefined());
});

describe('parseSync — SRV', () => {
    it('two SRV records',             () => expect(recs(records, 'SRV')).toHaveLength(2));
    it('priority is 10',              () => expect(recs(records, 'SRV')[0].rdata.priority).toBe('10'));
    it('port is 5060',                () => expect(recs(records, 'SRV')[0].rdata.port).toBe('5060'));
    it('target is FQDN',              () => expect(recs(records, 'SRV')[0].rdata.target).toMatch(/\.$/));
});

describe('parseSync — CAA', () => {
    it('two CAA records',             () => expect(recs(records, 'CAA')).toHaveLength(2));
    it('first tag is issue',          () => expect(recs(records, 'CAA')[0].rdata.tag).toBe('issue'));
    it('value contains letsencrypt',  () => expect(recs(records, 'CAA')[0].rdata.value).toContain('letsencrypt'));
});

describe('parseSync — PTR', () => {
    it('PTR present',                 () => expect(rec(records, 'PTR')).toBeDefined());
    it('target is FQDN',              () => expect(rec(records, 'PTR').rdata.target).toMatch(/\.$/));
});

describe('parseSync — HINFO', () => {
    it('HINFO present',               () => expect(rec(records, 'HINFO')).toBeDefined());
    it('cpu contains INTEL',          () => expect(rec(records, 'HINFO').rdata.cpu).toContain('INTEL'));
});

describe('parseSync — NAPTR', () => {
    it('NAPTR present',               () => expect(rec(records, 'NAPTR')).toBeDefined());
    it('order is 100',                () => expect(rec(records, 'NAPTR').rdata.order).toBe('100'));
    it('service is SIP+D2U',          () => expect(rec(records, 'NAPTR').rdata.service).toBe('SIP+D2U'));
});

describe('parseSync — SSHFP', () => {
    it('SSHFP present',               () => expect(rec(records, 'SSHFP')).toBeDefined());
    it('algorithm is 1',              () => expect(rec(records, 'SSHFP').rdata.algorithm).toBe('1'));
    it('fingerprint non-empty',       () => expect(rec(records, 'SSHFP').rdata.fingerprint.length).toBeGreaterThan(0));
});

describe('parseSync — DS', () => {
    it('DS present',                  () => expect(rec(records, 'DS')).toBeDefined());
    it('key_tag is 12345',            () => expect(rec(records, 'DS').rdata.key_tag).toBe('12345'));
    it('algorithm is 8',              () => expect(rec(records, 'DS').rdata.algorithm).toBe('8'));
});

describe('parseSync — DNSKEY', () => {
    it('DNSKEY present',              () => expect(rec(records, 'DNSKEY')).toBeDefined());
    it('flags is 256',                () => expect(rec(records, 'DNSKEY').rdata.flags).toBe('256'));
    it('public_key non-empty',        () => expect(rec(records, 'DNSKEY').rdata.public_key.length).toBeGreaterThan(0));
});

describe('parseSync — TLSA', () => {
    it('TLSA present',                () => expect(rec(records, 'TLSA')).toBeDefined());
    it('usage is 3',                  () => expect(rec(records, 'TLSA').rdata.usage).toBe('3'));
    it('selector is 1',               () => expect(rec(records, 'TLSA').rdata.selector).toBe('1'));
});

describe('parseSync — NSEC', () => {
    it('NSEC present',                () => expect(rec(records, 'NSEC')).toBeDefined());
    it('types bitmap contains SOA',   () => expect(rec(records, 'NSEC').rdata.types).toContain('SOA'));
});

describe('parseSync — HTTPS / SVCB', () => {
    it('HTTPS present',               () => expect(rec(records, 'HTTPS')).toBeDefined());
    it('HTTPS svc_priority is 1',     () => expect(rec(records, 'HTTPS').rdata.svc_priority).toBe('1'));
    it('SVCB present',                () => expect(rec(records, 'SVCB')).toBeDefined());
});

describe('parseSync — URI / RP / AFSDB / CERT / ZONEMD', () => {
    it('URI present',                 () => expect(rec(records, 'URI')).toBeDefined());
    it('URI target is URL',           () => expect(rec(records, 'URI').rdata.target).toContain('https://'));
    it('RP present',                  () => expect(rec(records, 'RP')).toBeDefined());
    it('AFSDB present',               () => expect(rec(records, 'AFSDB')).toBeDefined());
    it('CERT present',                () => expect(rec(records, 'CERT')).toBeDefined());
    it('ZONEMD present',              () => expect(rec(records, 'ZONEMD')).toBeDefined());
    it('ZONEMD serial matches zone',  () => expect(rec(records, 'ZONEMD').rdata.serial).toBe('2024010101'));
});

describe('parseSync — name handling', () => {
    it('relative name is expanded to FQDN', () => {
        const names = records.filter(r => r.type === 'A').map(r => r.name);
        expect(names.some(n => n.startsWith('sub.example.com'))).toBe(true);
    });
    it('all owner names end with a dot', () => {
        for (const r of records) {
            expect(r.name).toMatch(/\.$/, `name "${r.name}" does not end with dot`);
        }
    });
});

// ──────────────────────────── IDN / Punycode ─────────────────────────────────

describe('IDN punycode conversion', () => {
    it('convertIDN:true decodes xn-- labels', () => {
        const rr = parseSync(IDN_ZONE, { convertIDN: true });
        const soa = rec(rr, 'SOA');
        expect(soa).toBeDefined();
        expect(soa.name.toLowerCase()).not.toContain('xn--');
    });

    it('convertIDN:false keeps punycode intact', () => {
        const rr = parseSync(IDN_ZONE, { convertIDN: false });
        const soa = rec(rr, 'SOA');
        expect(soa.name.toLowerCase()).toContain('xn--');
    });

    it('IDN CNAME target is also decoded', () => {
        const rr = parseSync(IDN_ZONE, { convertIDN: true });
        const cname = rec(rr, 'CNAME');
        expect(cname).toBeDefined();
        expect(cname.rdata.target.toLowerCase()).not.toContain('xn--');
    });
});

// ─────────────────────────── Edge cases ──────────────────────────────────────

describe('edge cases', () => {
    it('empty string returns empty array', () => {
        expect(parseSync('')).toEqual([]);
    });

    it('only comments returns empty array', () => {
        expect(parseSync('; comment\n; another\n')).toEqual([]);
    });

    it('multi-line SOA via parentheses', () => {
        const zone = '$ORIGIN test.com.\n@ IN SOA ns1.test.com. admin.test.com. (\n2024 3600 900 604800 300 )\n';
        const r = parseSync(zone);
        expect(rec(r, 'SOA').rdata.serial).toBe('2024');
    });

    it('$TTL directive sets default TTL', () => {
        const r = parseSync('$ORIGIN t.com.\n$TTL 7200\n@ IN A 1.2.3.4\n');
        expect(r[0].ttl).toBe(7200);
    });

    it('per-record TTL overrides $TTL', () => {
        const r = parseSync('$ORIGIN t.com.\n$TTL 3600\n@ 60 IN A 1.2.3.4\n');
        expect(r[0].ttl).toBe(60);
    });

    it('TTL with compound time units (1h30m = 5400)', () => {
        const r = parseSync('$ORIGIN t.com.\n@ 1h30m IN A 1.2.3.4\n');
        expect(r[0].ttl).toBe(5400);
    });

    it('multiple TXT strings are concatenated', () => {
        const r = parseSync('$ORIGIN t.com.\n@ IN TXT "part1" "part2" "part3"\n');
        expect(r[0].rdata.data).toBe('part1part2part3');
    });

    it('Buffer input is accepted', () => {
        const r = parseSync(Buffer.from('$ORIGIN t.com.\n@ IN A 9.9.9.9\n'));
        expect(r).toHaveLength(1);
        expect(r[0].rdata.address).toBe('9.9.9.9');
    });

    it('unknown record type falls back to raw rdata', () => {
        const r = parseSync('$ORIGIN t.com.\n@ IN TYPE12345 somepayload\n');
        expect(r).toHaveLength(1);
        expect(r[0].rdata).toHaveProperty('raw');
    });

    it('@ expands to $ORIGIN', () => {
        const r = parseSync('$ORIGIN apex.com.\n@ IN A 5.5.5.5\n');
        expect(r[0].name).toBe('apex.com.');
    });

    it('leading-whitespace continuation reuses last name', () => {
        const zone = '$ORIGIN t.com.\nhost IN A 1.1.1.1\n     IN A 2.2.2.2\n';
        const r = parseSync(zone);
        expect(r).toHaveLength(2);
        expect(r[0].name).toBe(r[1].name);
    });
});

// ──────────────── Classic Node.js Transform stream ───────────────────────────

describe('ZoneTransform (Node.js stream)', () => {
    it('pipe + async iteration yields all records', async () => {
        const readable = Readable.from([ZONE]);
        const transform = new ZoneTransform();
        readable.pipe(transform);
        const out = [];
        for await (const r of transform) out.push(r);
        expect(out.length).toBeGreaterThan(20);
    });

    it('works correctly with 100-byte chunks', async () => {
        const chunks = [];
        for (let i = 0; i < ZONE.length; i += 100) chunks.push(ZONE.slice(i, i + 100));
        const readable = Readable.from(chunks);
        const transform = new ZoneTransform();
        readable.pipe(transform);
        const out = [];
        for await (const r of transform) out.push(r);
        expect(out.length).toBeGreaterThan(20);
    });

    it('emits correctly shaped objects', async () => {
        const readable = Readable.from([ZONE]);
        const transform = new ZoneTransform();
        readable.pipe(transform);
        for await (const r of transform) {
            expect(typeof r.name).toBe('string');
            expect(typeof r.ttl).toBe('number');
            expect(typeof r.type).toBe('string');
            expect(typeof r.rdata).toBe('object');
        }
    });

    it('convertIDN option is forwarded correctly', async () => {
        const readable = Readable.from([IDN_ZONE]);
        const transform = new ZoneTransform({ convertIDN: true });
        readable.pipe(transform);
        const out = [];
        for await (const r of transform) out.push(r);
        expect(out.length).toBeGreaterThan(0);
        expect(out[0].name.toLowerCase()).not.toContain('xn--');
    });

    it('same record count as parseSync', async () => {
        const readable = Readable.from([ZONE]);
        const transform = new ZoneTransform();
        readable.pipe(transform);
        const out = [];
        for await (const r of transform) out.push(r);
        expect(out.length).toBe(records.length);
    });
});

// ─────────────────── parseStream async generator ─────────────────────────────

describe('parseStream', () => {
    it('yields all records', async () => {
        const out = [];
        for await (const r of parseStream(Readable.from([ZONE]))) out.push(r);
        expect(out.length).toBeGreaterThan(20);
    });

    it('same count as parseSync', async () => {
        const out = [];
        for await (const r of parseStream(Readable.from([ZONE]))) out.push(r);
        expect(out.length).toBe(records.length);
    });

    it('convertIDN option forwarded', async () => {
        const out = [];
        for await (const r of parseStream(Readable.from([IDN_ZONE]), { convertIDN: true })) out.push(r);
        expect(out[0].name.toLowerCase()).not.toContain('xn--');
    });
});

// ──────────────────────── Web TransformStream ────────────────────────────────

describe('createZoneTransformStream (Web Streams)', () => {
    it('full buffer via pipeThrough', async () => {
        const src = new ReadableStream({
            start(ctrl) { ctrl.enqueue(Buffer.from(ZONE)); ctrl.close(); }
        });
        const out = [];
        for await (const r of src.pipeThrough(createZoneTransformStream())) out.push(r);
        expect(out.length).toBeGreaterThan(20);
    });

    it('50-byte chunks via pipeThrough', async () => {
        let offset = 0;
        const src = new ReadableStream({
            pull(ctrl) {
                if (offset >= ZONE.length) { ctrl.close(); return; }
                ctrl.enqueue(Buffer.from(ZONE.slice(offset, offset + 50)));
                offset += 50;
            }
        });
        const out = [];
        for await (const r of src.pipeThrough(createZoneTransformStream())) out.push(r);
        expect(out.length).toBeGreaterThan(20);
    });

    it('same record count as parseSync', async () => {
        const src = new ReadableStream({
            start(ctrl) { ctrl.enqueue(Buffer.from(ZONE)); ctrl.close(); }
        });
        const out = [];
        for await (const r of src.pipeThrough(createZoneTransformStream())) out.push(r);
        expect(out.length).toBe(records.length);
    });

    it('convertIDN option decoded correctly', async () => {
        const src = new ReadableStream({
            start(ctrl) { ctrl.enqueue(Buffer.from(IDN_ZONE)); ctrl.close(); }
        });
        const out = [];
        for await (const r of src.pipeThrough(createZoneTransformStream({ convertIDN: true }))) out.push(r);
        expect(out.length).toBeGreaterThan(0);
        expect(out[0].name.toLowerCase()).not.toContain('xn--');
    });

    it('Uint8Array chunks accepted', async () => {
        const src = new ReadableStream({
            start(ctrl) {
                ctrl.enqueue(new TextEncoder().encode(ZONE));
                ctrl.close();
            }
        });
        const out = [];
        for await (const r of src.pipeThrough(createZoneTransformStream())) out.push(r);
        expect(out.length).toBeGreaterThan(20);
    });
});

describe('parseSync — web flavour', () => {
    it('same record count as node flavour', () => {
        expect(parseSyncWeb(ZONE).length).toBe(records.length);
    });

    it('accepts Uint8Array input', () => {
        const r = parseSyncWeb(new TextEncoder().encode('$ORIGIN t.com.\n@ IN A 1.2.3.4\n'));
        expect(r).toHaveLength(1);
        expect(r[0].rdata.address).toBe('1.2.3.4');
    });
});

// ──────────────────────────── Performance ────────────────────────────────────

describe('performance', () => {
    it('parses 100 000 A records in under 2 s', () => {
        let zone = '$ORIGIN perf.test.\n$TTL 300\n';
        for (let i = 0; i < 100_000; i++) {
            zone += `host${i} IN A 10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}\n`;
        }
        const t0 = Date.now();
        const r = parseSync(zone);
        const ms = Date.now() - t0;
        expect(r).toHaveLength(100_000);
        expect(ms).toBeLessThan(2000);
        console.log(`  → 100 000 records in ${ms} ms`);
    });
});

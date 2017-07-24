
const { Writable } = require('stream');
const util = require('util');

function DnsZone(options) {
    if (!(this instanceof DnsZone))
    return new DnsZone(options);
    Writable.call(this, options);

    this.rgLine = /^(@|[0-9a-zA-Z\.\-]+)(?:(\s+\d+)?(\s+IN|CS|CH|HS)?|(\s+IN|CS|CH|HS)?(\s+\d+)?|)\s+(A|AAAA|NS|MD|MF|CNAME|DNAME|DNSKEY|DS|KEY|SOA|MB|MG|MR|NULL|WKS|PTR|HINFO|MINFO|MX|TXT|NAPTR|NSEC|RRSIG|SPF|SRV|TXT|URI)\s+(.+)$/;
    this.rgDirective = /^\$([A-Z]+)\s+(.+)$/;
    this.lines = [];

    this.on('line', this._onLine);
    this.on('rr', this._onResourceRecord);
}

DnsZone.prototype._checkDirective = function(line) {
    if (line.charAt(0) !== '$') {
        return false;
    }
    
    var parts = this.rgDirective.exec(line);
    this.emit('directive', parts[1], parts[2]);

    return true;
};

DnsZone.prototype._onLine = function(line) {

    if (this._checkDirective(line.trim())) {
        return;
    }

    var parts = this.rgLine.exec(line);
    
    if (!parts) {
        return;
    }
    
    var ttl = null, cls = null;
    
    for (var i = 2; i < 6; i++) {
        if (typeof parts[i] === 'undefined') {
            continue;
        }

        if (/\d+$/.test(parts[i])) {
            ttl = parseInt(parts[i].trim(), 10);
        } else if (/IN|CS|CH|HS$/.test(parts[i])) {
            cls = parts[i].trim();
        }
    }
    
    this.emit('rr', {
        domainName: parts[1],
        type: parts[6],
        data: parts[7],
        class: cls,
        ttl: ttl
    }, line);
};

DnsZone.prototype._onResourceRecord = function(rr, line) {
    var parts;
    
    if (/^NS$/i.test(rr.type)) {
        this.emit('ns', rr.data, rr, line);
        return;
    }

    if (/^A$/i.test(rr.type)) {
        this.emit('a', rr.data, rr, line);
        return;
    }
    
    if (/^AAAA$/i.test(rr.type)) {
        this.emit('aaaa', rr.data, rr, line);
        return;
    }

    if (/^CNAME$/i.test(rr.type)) {
        this.emit('cname', rr.data, rr, line);
        return;
    }

    if (/^DNAME$/i.test(rr.type)) {
        this.emit('dname', rr.data, rr, line);
        return;
    }

    if (/^DNSKEY$/i.test(rr.type) && (parts = /^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(rr.data))) {
        this.emit('dnskey', {
            flags: parts[1],
            protocol: parts[2],
            algorithm: parts[3],
            publicKey: parts[4].replace(/\s+/g, '')
        }, rr, line);
        return;
    }

    if (/^RRSIG$/i.test(rr.type) && (parts = /^([a-zA-Z0-9]+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([0-9a-zA-Z\.\-]+)\s+(.+)$/.exec(rr.data))) {
        this.emit('rrsig', {
            typeCovered: parts[1],
            algorithm: parts[2],
            labels: parts[3],
            originalTtl: parts[4],
            signatureExpiration: parts[5],
            signatureInception: parts[6],
            keyTag: parts[7],
            signersName: parts[8],
            signature: parts[9].replace(/\s+/g, '')
        }, rr, line);
        return;
    }

    if (/^SOA$/i.test(rr.type) && (parts = /^([0-9a-zA-Z\.\-]+)\s+([0-9a-zA-Z\.\-]+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+$/.exec(rr.data))) {
        this.emit('soa', {
            nameServer: parts[1],
            emailAddress: parts[2],
            serialNumber: parts[3],
            refresh: parts[4],
            retry: parts[5],
            expiry: parts[6],
            nxdomain: parts[7]
        }, rr, line);
        return;
    }

    if (/^DS$/i.test(rr.type) && (parts = /^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(rr.data))) {
        this.emit('ds', {
            keyTag: parts[1],
            algorithm: parts[2],
            digestType: parts[3],
            digest: parts[4].replace(/\s+/g, '')
        }, rr, line);
        return;
    }

    this.emit('unknown', rr);
};

DnsZone.prototype._write = function(chunk, encoding, callback) {
    var index = 0, prevIndex = 0;

    var multiLine;

    while ((index = chunk.indexOf('\n', prevIndex)) !== -1) {
        var line = chunk.slice(prevIndex, prevIndex = index + 1);

        var commentIndex = line.indexOf(';');

        if (commentIndex !== -1) {
            var commentBefore = line.slice(0, commentIndex);
            var comment = line.slice(commentIndex);
            this.emit('comment', comment.toString(), commentBefore.toString());

            if (commentBefore.length === 0) {
                continue;
            }

            line = Buffer.concat([commentBefore, Buffer.from('\n')]);
        }

        if ((line.indexOf('(') !== -1) || (this.lines.length > 0)) {
            this.lines.push(line);

            if (line.indexOf(')') !== -1) {
                this.emit('line', Buffer.concat(this.lines).toString().replace(/\(|\)|\n/g, ' '));
                this.lines = [];
            }

            continue;
        }

        this.emit('line', line.toString().replace(/\n/g, ''));
    }

    callback();
};


util.inherits(DnsZone, Writable);

module.exports = DnsZone;

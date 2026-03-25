'use strict';
/**
 * dnszone — Classic Node.js Transform Stream flavour
 *
 * Usage:
 *   const { ZoneTransform } = require('dnszone');
 *   const transform = new ZoneTransform({ convertIDN: true });
 *   fs.createReadStream('db.example.com')
 *     .pipe(transform)
 *     .on('data', record => console.log(record))
 *     .on('end', () => console.log('done'));
 */

const { Transform } = require('stream');
const { ZoneParserCore } = require('bindings')('dnszone.node');

class ZoneTransform extends Transform {
    /**
     * @param {object} [options]
     * @param {boolean} [options.convertIDN=false]  Convert punycode labels to Unicode
     * @param {object}  [options.transform]          Node.js Transform stream options
     */
    constructor(options = {}) {
        const { convertIDN = false, ...streamOpts } = options;
        super({ ...streamOpts, readableObjectMode: true });
        this._core = new ZoneParserCore({ convertIDN });
    }

    _transform(chunk, _encoding, callback) {
        try {
            const records = this._core.write(
                Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            );
            for (const rec of records) this.push(rec);
            callback();
        } catch (err) {
            callback(err);
        }
    }

    _flush(callback) {
        try {
            const records = this._core.flush();
            for (const rec of records) this.push(rec);
            callback();
        } catch (err) {
            callback(err);
        }
    }
}

/**
 * Convenience async-generator adapter — iterate records with for-await-of
 * over any Readable (including ZoneTransform itself).
 *
 * @param {import('stream').Readable} readable
 * @param {object} [options]
 * @param {boolean} [options.convertIDN=false]
 * @yields {import('./types').ZoneRecord}
 */
async function* parseStream(readable, options = {}) {
    const transform = new ZoneTransform(options);
    readable.pipe(transform);
    for await (const record of transform) {
        yield record;
    }
}

/**
 * Parse a complete zone file string / Buffer all at once.
 *
 * @param {string|Buffer} content
 * @param {object} [options]
 * @param {boolean} [options.convertIDN=false]
 * @returns {import('./types').ZoneRecord[]}
 */
function parseSync(content, options = {}) {
    const { convertIDN = false } = options;
    const core = new ZoneParserCore({ convertIDN });
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const records = [...core.write(buf), ...core.flush()];
    return records;
}

module.exports = { ZoneTransform, parseStream, parseSync };

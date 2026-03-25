'use strict';
/**
 * dnszone — Web Streams API (WHATWG TransformStream) flavour
 *
 * Usage:
 *   const { createZoneTransformStream } = require('dnszone/web');
 *
 *   const response = await fetch('https://example.com/db.example.com');
 *   const stream = response.body
 *     .pipeThrough(new TextDecoderStream())          // optional, works with Uint8Array too
 *     .pipeThrough(createZoneTransformStream({ convertIDN: true }));
 *
 *   for await (const record of stream) {
 *     console.log(record);
 *   }
 *
 * Node.js ≥ 18 ships a built-in implementation of the Web Streams API.
 * Node.js ≥ 16 ships it behind --experimental-global-fetch.
 * For older Node.js, install the `web-streams-polyfill` package and pass it
 * via the `TransformStream` option.
 */

const { ZoneParserCore } = require('../build/Release/dnszone');

/**
 * Create a WHATWG TransformStream that converts DNS zone file chunks
 * into structured ZoneRecord objects.
 *
 * @param {object} [options]
 * @param {boolean} [options.convertIDN=false]   Convert punycode labels to Unicode
 * @param {typeof TransformStream} [options.TransformStream]  Override the TransformStream class
 *        (useful for polyfills or environments without built-in Web Streams)
 * @returns {TransformStream}
 */
function createZoneTransformStream(options = {}) {
    const {
        convertIDN = false,
        TransformStream: TSClass = globalThis.TransformStream,
    } = options;

    if (!TSClass) {
        throw new Error(
            'TransformStream is not available in this environment. ' +
            'Pass `TransformStream` in the options or use Node.js ≥ 18.'
        );
    }

    const core = new ZoneParserCore({ convertIDN });

    return new TSClass({
        transform(chunk, controller) {
            let buf;
            if (typeof chunk === 'string') {
                buf = Buffer.from(chunk);
            } else if (chunk instanceof Uint8Array || Buffer.isBuffer(chunk)) {
                buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
            } else {
                controller.error(new TypeError('Unsupported chunk type: expected string or Uint8Array'));
                return;
            }
            const records = core.write(buf);
            for (const rec of records) {
                controller.enqueue(rec);
            }
        },
        flush(controller) {
            const records = core.flush();
            for (const rec of records) {
                controller.enqueue(rec);
            }
        },
    });
}

/**
 * Parse a complete zone file string / Buffer / Uint8Array all at once
 * using the Web Streams path internally.
 *
 * @param {string|Uint8Array|Buffer} content
 * @param {object} [options]
 * @param {boolean} [options.convertIDN=false]
 * @returns {import('./types').ZoneRecord[]}
 */
function parseSync(content, options = {}) {
    const { convertIDN = false } = options;
    const core = new ZoneParserCore({ convertIDN });
    let buf;
    if (typeof content === 'string') buf = Buffer.from(content);
    else if (Buffer.isBuffer(content)) buf = content;
    else buf = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
    return [...core.write(buf), ...core.flush()];
}

module.exports = { createZoneTransformStream, parseSync };

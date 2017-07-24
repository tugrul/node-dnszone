# node-dnszone
Parse big dns zone data stream

```javascript
var fs = require('fs');
var zlib = require('zlib');
var Aline = require('aline');
var DnsZone = require('dnszone');

var stream = fs.createReadStream('org.zone.gz');
var unzip = stream.pipe(zlib.createGunzip());
var aline = unzip.pipe(new Aline());
var dnsZone = aline.pipe(new DnsZone());


dnsZone.on('comment', function(comment, data) {
    console.log('comment data:', comment.toString());
});

dnsZone.on('soa', function(data, rr) {
    console.log('soa:', rr.domainName, data);
});

dnsZone.on('a', function(data, rr){
    console.log('a:', rr.domainName, data);
});

dnsZone.on('ns', function(data, rr){
    console.log('ns:', rr.domainName, data);
});
```
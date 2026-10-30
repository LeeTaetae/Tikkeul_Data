const fs = require('node:fs');
const crypto = require('node:crypto');
const filename = process.argv[2] || 'android/app/debug.keystore';
if (!fs.existsSync(filename)) {
  console.error('Debug keystore not found. Run npm run native:prebuild -- --platform android first.');
  process.exit(1);
}
const bytes = fs.readFileSync(filename);
let offset = 0;
const u4 = () => { const value = bytes.readUInt32BE(offset); offset += 4; return value; };
const utf = () => { const length = bytes.readUInt16BE(offset); offset += 2; const value = bytes.toString('utf8', offset, offset + length); offset += length; return value; };
if (u4() !== 0xfeedfeed) {
  console.error('Expected a JKS debug keystore. Export its public certificate with keytool for other formats.');
  process.exit(1);
}
const version = u4();
const count = u4();
for (let entry = 0; entry < count; entry++) {
  const type = u4();
  const alias = utf();
  offset += 8; // creation time
  let certificateCount = 1;
  if (type === 1) {
    const encryptedKeyLength = u4();
    offset += encryptedKeyLength; // Never decrypt or print private key data.
    certificateCount = u4();
  } else if (type !== 2) throw new Error('Unsupported JKS entry');
  for (let index = 0; index < certificateCount; index++) {
    if (version >= 2) utf();
    const length = u4();
    const certificate = bytes.subarray(offset, offset + length);
    offset += length;
    if (alias === 'androiddebugkey' && index === 0) {
      const x509 = new crypto.X509Certificate(certificate);
      console.log('Android package: com.tikkeuldata.app');
      console.log('Local debug key hash: ' + crypto.createHash('sha1').update(x509.raw).digest('base64'));
      console.log('Register the actual signing key hash separately for EAS or distribution builds.');
      process.exit(0);
    }
  }
}
console.error('androiddebugkey certificate not found.');
process.exitCode = 1;

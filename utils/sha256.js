function rightRotate(value, amount) {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256(ascii) {
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = 'length';
  let i;
  let j;
  let result = '';

  const words = [];
  const asciiBitLength = ascii[lengthProperty] * 8;

  const hash = [];
  const k = [];
  let primeCounter = 0;
  const isComposite = {};

  for (let candidate = 2; primeCounter < 64; candidate += 1) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      primeCounter += 1;
    }
  }

  ascii += '\x80';
  while ((ascii[lengthProperty] % 64) - 56) {
    ascii += '\x00';
  }

  for (i = 0; i < ascii[lengthProperty]; i += 1) {
    j = ascii.charCodeAt(i);
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }

  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength;

  for (j = 0; j < words[lengthProperty]; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);

    for (i = 0; i < 64; i += 1) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const a = hash[0];
      const e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

      hash.unshift((temp1 + temp2) | 0);
      hash[4] = (hash[4] + temp1) | 0;
      hash.pop();
    }

    for (i = 0; i < 8; i += 1) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (i = 0; i < 8; i += 1) {
    for (j = 3; j + 1; j -= 1) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16 ? 0 : '') + b.toString(16));
    }
  }
  return result;
}

function hexToBinary(hex) {
  let output = '';
  for (let index = 0; index < hex.length; index += 2) {
    output += String.fromCharCode(parseInt(hex.substr(index, 2), 16));
  }
  return output;
}

function xorPad(input, padByte) {
  let output = '';
  for (let index = 0; index < input.length; index += 1) {
    output += String.fromCharCode(input.charCodeAt(index) ^ padByte);
  }
  return output;
}

function hmacSha256(key, message) {
  const blockSize = 64;
  let normalizedKey = key;

  if (normalizedKey.length > blockSize) {
    normalizedKey = hexToBinary(sha256(normalizedKey));
  }

  while (normalizedKey.length < blockSize) {
    normalizedKey += '\x00';
  }

  const inner = xorPad(normalizedKey, 0x36) + message;
  const innerHashBinary = hexToBinary(sha256(inner));
  const outer = xorPad(normalizedKey, 0x5c) + innerHashBinary;
  return sha256(outer);
}

module.exports = {
  sha256,
  hmacSha256
};

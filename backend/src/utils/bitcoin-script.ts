const opcodes = {
  OP_FALSE: 0,
  OP_0: 0,
  OP_PUSHDATA1: 76,
  OP_PUSHDATA2: 77,
  OP_PUSHDATA4: 78,
  OP_1NEGATE: 79,
  OP_PUSHNUM_NEG1: 79,
  OP_RESERVED: 80,
  OP_TRUE: 81,
  OP_1: 81,
  OP_2: 82,
  OP_3: 83,
  OP_4: 84,
  OP_5: 85,
  OP_6: 86,
  OP_7: 87,
  OP_8: 88,
  OP_9: 89,
  OP_10: 90,
  OP_11: 91,
  OP_12: 92,
  OP_13: 93,
  OP_14: 94,
  OP_15: 95,
  OP_16: 96,
  OP_PUSHNUM_1: 81,
  OP_PUSHNUM_2: 82,
  OP_PUSHNUM_3: 83,
  OP_PUSHNUM_4: 84,
  OP_PUSHNUM_5: 85,
  OP_PUSHNUM_6: 86,
  OP_PUSHNUM_7: 87,
  OP_PUSHNUM_8: 88,
  OP_PUSHNUM_9: 89,
  OP_PUSHNUM_10: 90,
  OP_PUSHNUM_11: 91,
  OP_PUSHNUM_12: 92,
  OP_PUSHNUM_13: 93,
  OP_PUSHNUM_14: 94,
  OP_PUSHNUM_15: 95,
  OP_PUSHNUM_16: 96,
  OP_NOP: 97,
  OP_VER: 98,
  OP_IF: 99,
  OP_NOTIF: 100,
  OP_VERIF: 101,
  OP_VERNOTIF: 102,
  OP_ELSE: 103,
  OP_ENDIF: 104,
  OP_VERIFY: 105,
  OP_RETURN: 106,
  OP_TOALTSTACK: 107,
  OP_FROMALTSTACK: 108,
  OP_2DROP: 109,
  OP_2DUP: 110,
  OP_3DUP: 111,
  OP_2OVER: 112,
  OP_2ROT: 113,
  OP_2SWAP: 114,
  OP_IFDUP: 115,
  OP_DEPTH: 116,
  OP_DROP: 117,
  OP_DUP: 118,
  OP_NIP: 119,
  OP_OVER: 120,
  OP_PICK: 121,
  OP_ROLL: 122,
  OP_ROT: 123,
  OP_SWAP: 124,
  OP_TUCK: 125,
  OP_CAT: 126,
  OP_SUBSTR: 127,
  OP_LEFT: 128,
  OP_RIGHT: 129,
  OP_SIZE: 130,
  OP_INVERT: 131,
  OP_AND: 132,
  OP_OR: 133,
  OP_XOR: 134,
  OP_EQUAL: 135,
  OP_EQUALVERIFY: 136,
  OP_RESERVED1: 137,
  OP_RESERVED2: 138,
  OP_1ADD: 139,
  OP_1SUB: 140,
  OP_2MUL: 141,
  OP_2DIV: 142,
  OP_NEGATE: 143,
  OP_ABS: 144,
  OP_NOT: 145,
  OP_0NOTEQUAL: 146,
  OP_ADD: 147,
  OP_SUB: 148,
  OP_MUL: 149,
  OP_DIV: 150,
  OP_MOD: 151,
  OP_LSHIFT: 152,
  OP_RSHIFT: 153,
  OP_BOOLAND: 154,
  OP_BOOLOR: 155,
  OP_NUMEQUAL: 156,
  OP_NUMEQUALVERIFY: 157,
  OP_NUMNOTEQUAL: 158,
  OP_LESSTHAN: 159,
  OP_GREATERTHAN: 160,
  OP_LESSTHANOREQUAL: 161,
  OP_GREATERTHANOREQUAL: 162,
  OP_MIN: 163,
  OP_MAX: 164,
  OP_WITHIN: 165,
  OP_RIPEMD160: 166,
  OP_SHA1: 167,
  OP_SHA256: 168,
  OP_HASH160: 169,
  OP_HASH256: 170,
  OP_CODESEPARATOR: 171,
  OP_CHECKSIG: 172,
  OP_CHECKSIGVERIFY: 173,
  OP_CHECKMULTISIG: 174,
  OP_CHECKMULTISIGVERIFY: 175,
  OP_NOP1: 176,
  OP_NOP2: 177,
  OP_CHECKLOCKTIMEVERIFY: 177,
  OP_CLTV: 177,
  OP_NOP3: 178,
  OP_CHECKSEQUENCEVERIFY: 178,
  OP_CSV: 178,
  OP_NOP4: 179,
  OP_NOP5: 180,
  OP_NOP6: 181,
  OP_NOP7: 182,
  OP_NOP8: 183,
  OP_NOP9: 184,
  OP_NOP10: 185,
  OP_CHECKSIGADD: 186,
  OP_PUBKEYHASH: 253,
  OP_PUBKEY: 254,
  OP_INVALIDOPCODE: 255,
};
// add unused opcodes
for (let i = 187; i <= 255; i++) {
  opcodes[`OP_RETURN_${i}`] = i;
}

export { opcodes };

/** extracts m and n from a multisig script (asm), returns nothing if it is not a multisig script */
export function parseMultisigScript(script: string): void | { m: number, n: number } {
  if (!script?.length) {
    return;
  }
  const ops = script.split(' ');
  if (ops.length < 3 || ops.pop() !== 'OP_CHECKMULTISIG') {
    return;
  }
  const opN = ops.pop();
  if (!opN) {
    return;
  }
  if (opN !== 'OP_0' && !opN.startsWith('OP_PUSHNUM_')) {
    return;
  }
  const n = parseInt(opN.match(/[0-9]+/)?.[0] || '', 10);
  if (ops.length < n * 2 + 1) {
    return;
  }
  // pop n public keys
  for (let i = 0; i < n; i++) {
    if (!/^0((2|3)\w{64}|4\w{128})$/.test(ops.pop() || '')) {
      return;
    }
    if (!/^OP_PUSHBYTES_(33|65)$/.test(ops.pop() || '')) {
      return;
    }
  }
  const opM = ops.pop();
  if (!opM) {
    return;
  }
  if (opM !== 'OP_0' && !opM.startsWith('OP_PUSHNUM_')) {
    return;
  }
  const m = parseInt(opM.match(/[0-9]+/)?.[0] || '', 10);

  if (ops.length) {
    return;
  }

  return { m, n };
}

export function getVarIntLength(n: number): number {
  if (n < 0xfd) {
    return 1;
  } else if (n <= 0xffff) {
    return 3;
  } else if (n <= 0xffffffff) {
    return 5;
  } else {
    return 9;
  }
}

/**
 * The miner's self-declared tag from a coinbase, for when no known pool matches.
 *
 * Blocks are attributed by matching the coinbase against a curated list of pools.
 * That list is a canonicalisation aid: it maps the many tags and payout addresses
 * of one pool onto a single identity, and supplies an icon. It is not where the
 * identity comes from. The coinbase carries it, which is why parseDATUMTemplateCreator
 * above can read miner names straight out of one.
 *
 * On a chain whose miners are mostly solo and self-named, the curated list matches
 * nothing and every block reads "Unknown" while the coinbase plainly says who mined
 * it. Observed on BLAKE2b mainnet: Knots, PyBLOCK-LOTTO-BLAKE2b, PlebMiner,
 * ghost_of_nobody, Mustard Seed, MIISSBLUEE.
 *
 * `headline` is dropped when present. On a chain that requires a phrase in every
 * coinbase, that phrase is in every block and identifies nobody.
 *
 * Returns null when nothing readable is left, so the caller keeps saying Unknown
 * rather than showing punctuation.
 */
/**
 * The phrase this chain's consensus requires in every coinbase.
 *
 * It is in every block by rule, so it identifies nobody and must not be mistaken
 * for a miner's tag. Named here rather than in config because it is a property of
 * the chain this fork follows, not a deployment choice.
 */
export const CONSENSUS_COINBASE_HEADLINE = '8-30 NYPost Deride And Conquer';

/**
 * The name to show for a block: the matched pool, or failing that whatever the
 * miner called itself in the coinbase.
 *
 * Only fills in for the unknown pool, so a real pool match always wins and keeps
 * its canonical name and icon.
 *
 * The block's pool_id is untouched, and still points at the unknown pool. That is
 * deliberate: pool statistics group by id, and a self-declared tag is not a pool
 * identity. Anyone counting hashrate share still sees these as unattributed, while
 * anyone reading the block list sees who mined it.
 */
export function displayMinerName(poolName: string, coinbaseRaw: string | undefined): string {
  if (poolName !== 'Unknown' || !coinbaseRaw) {
    return poolName;
  }
  return parseCoinbaseMinerTag(coinbaseRaw, CONSENSUS_COINBASE_HEADLINE) ?? poolName;
}

export function parseCoinbaseMinerTag(coinbaseRaw: string, headline?: string): string | null {
  if (!coinbaseRaw || coinbaseRaw.length < 4) {
    return null;
  }
  const bytes: number[] = [];
  for (let c = 0; c < coinbaseRaw.length; c += 2) {
    bytes.push(parseInt(coinbaseRaw.slice(c, c + 2), 16));
  }

  // Skip the BIP34 height push, exactly as parseDATUMTemplateCreator does.
  let tagLengthByte = 1 + bytes[0];
  if (tagLengthByte >= bytes.length) {
    return null;
  }
  let tagsLength = bytes[tagLengthByte];
  if (tagsLength === 0x4c) {
    tagLengthByte += 1;
    tagsLength = bytes[tagLengthByte];
  }
  const tagStart = tagLengthByte + 1;
  const tagString = String.fromCharCode(...bytes.slice(tagStart, tagStart + tagsLength));

  // The push often holds more than one field, separated by a non-printable byte.
  // Split on any run of them and consider each field on its own.
  const candidates = tagString
    .split(/[\x00-\x1f\x7f]+/)
    .map((field) => field.trim())
    .filter((field) => field.length > 0);

  const normalizedHeadline = headline ? headline.trim().toLowerCase() : null;
  for (const field of candidates) {
    if (normalizedHeadline && field.toLowerCase().includes(normalizedHeadline)) {
      continue;
    }
    // A pool prefixes its tag with a slash by convention (/AntPool/); a solo miner
    // usually does not. Either way the slashes are punctuation, not part of a name.
    const name = field.replace(/^\/+|\/+$/g, '').trim();
    // Two characters of something printable, or it is extranonce noise that
    // happened to fall in the ASCII range.
    if (name.length >= 2 && /[a-zA-Z0-9]/.test(name)) {
      return name.length > 40 ? name.slice(0, 40) : name;
    }
  }
  return null;
}

/** Extracts miner names from a DATUM coinbase transaction */
export function parseDATUMTemplateCreator(coinbaseRaw: string): string[] | null {
  const bytes: number[] = [];
  for (let c = 0; c < coinbaseRaw.length; c += 2) {
      bytes.push(parseInt(coinbaseRaw.slice(c, c + 2), 16));
  }

  // Skip block height
  let tagLengthByte = 1 + bytes[0];

  let tagsLength = bytes[tagLengthByte];
  if (tagsLength == 0x4c) {
    tagLengthByte += 1;
    tagsLength = bytes[tagLengthByte];
  }

  const tagStart = tagLengthByte + 1;
  const tags = bytes.slice(tagStart, tagStart + tagsLength);
  let tagString = String.fromCharCode(...tags);
  tagString = tagString.replace('\x00', '');

  return tagString.split('\x0f').map((name) => name.replace(/[^a-zA-Z0-9 ]/g, ''));
}
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 26-char ULID: 48-bit timestamp + 80 bits of randomness, Crockford base32. */
export function ulid(now: number = Date.now()): string {
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[now % 32] + time;
    now = Math.floor(now / 32);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let rand = '';
  for (const b of bytes) rand += ALPHABET[b % 32];
  return time + rand;
}

export const newPageId = () => 'pg_' + ulid();
export const newBlockId = () => 'b_' + ulid();
export const newNotebookId = () => 'nb_' + ulid();
export const newImageId = () => 'im_' + ulid();
export const newAssetName = (ext: string) => ulid() + '.' + ext;

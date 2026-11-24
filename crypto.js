// All encryption happens in the browser. Supabase only ever stores ciphertext.
//
// Share link secret (16 random bytes, after '#', never sent to any server)
//   -> HKDF 'mermaid/share-id' -> share id (32 hex, sent to server)
//   -> HKDF 'mermaid/enc'      -> AES-256-GCM key (never sent)
// Ciphertext format: base64url(12-byte random IV || AES-GCM ciphertext+tag).

const te = new TextEncoder()
const td = new TextDecoder()

function b64uEncode(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64uDecode(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4))
  return Uint8Array.from(s, c => c.charCodeAt(0))
}

const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

async function hkdf(ikm, info, bits = 256) {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const out = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode(info) }, base, bits)
  return new Uint8Array(out)
}

export const newSecret = () => b64uEncode(crypto.getRandomValues(new Uint8Array(16)))

export async function deriveShare(secret) {
  const ikm = b64uDecode(secret)
  if (ikm.length !== 16) throw new Error('bad link')
  const raw = await hkdf(ikm, 'mermaid/enc')
  return {
    id: toHex(await hkdf(ikm, 'mermaid/share-id', 128)),
    key: await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']),
  }
}

export async function encryptText(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(text)))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv); out.set(ct, 12)
  return b64uEncode(out)
}

export async function decryptText(key, str) {
  const bytes = b64uDecode(str)
  return td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)))
}

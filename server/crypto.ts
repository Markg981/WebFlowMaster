import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

// We must ensure the key is exactly 32 bytes (256 bits)
function getEncryptionKey(): Buffer {
  const keyString = process.env.ENCRYPTION_KEY;
  if (!keyString) {
    throw new Error('ENCRYPTION_KEY is missing in environment variables. Please add a 32-byte hex string to .env');
  }
  
  // If it's a 64-character hex string (which we generated), parse it as hex
  if (keyString.length === 64 && /^[0-9a-fA-F]+$/.test(keyString)) {
    return Buffer.from(keyString, 'hex');
  }
  
  // Otherwise, if it's some other string, we hash it to ensure it's exactly 32 bytes
  return crypto.createHash('sha256').update(keyString).digest();
}

export function encryptSecret(text: string): { encryptedValue: string, iv: string, authTag: string } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16); // 16 bytes is standard for GCM
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return {
    encryptedValue: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

export function decryptSecret(encryptedValue: string, ivHex: string, authTagHex: string): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedValue, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

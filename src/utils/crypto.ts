import { createHash } from 'crypto';

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

export { sha256 };

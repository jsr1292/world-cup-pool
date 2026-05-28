import { randomBytes } from 'crypto';

export function errCode(): string {
	return `ERR_${randomBytes(4).toString('hex').toUpperCase()}`;
}

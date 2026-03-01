import { randomInt } from 'crypto';
import { sleep } from './sleep';

const retry = async <T>(fn: () => Promise<T>, maxAttempts = 5, baseDelayMs = 60_000): Promise<T> => {
    let lastError!: Error;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err as Error;
            if (attempt < maxAttempts - 1) {
                const delay = baseDelayMs * 2 ** attempt + randomInt(0, 5_001);
                await sleep(delay);
            }
        }
    }

    throw lastError;
};

export { retry };

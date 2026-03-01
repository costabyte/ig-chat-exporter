import { randomInt } from 'crypto';

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const jitter = (minMs: number, maxMs: number): Promise<void> => sleep(randomInt(minMs, maxMs + 1));

export { sleep, jitter };

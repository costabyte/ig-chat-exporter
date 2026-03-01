import { jitter } from './sleep';
import type { RateLimitPreset } from '../export/schema';

interface PresetConfig {
    pageDelayMs: [number, number];
    threadDelayMs: [number, number];
    cooldownEvery: number;
    cooldownMs: [number, number];
    retryBaseMs: number;
}

const PRESETS: Record<RateLimitPreset, PresetConfig> = {
    safe: {
        pageDelayMs: [3_000, 8_000],
        threadDelayMs: [15_000, 30_000],
        cooldownEvery: 20,
        cooldownMs: [90_000, 150_000],
        retryBaseMs: 60_000,
    },
    fast: {
        pageDelayMs: [1_500, 4_000],
        threadDelayMs: [8_000, 15_000],
        cooldownEvery: 20,
        cooldownMs: [45_000, 75_000],
        retryBaseMs: 30_000,
    },
};

class RateLimiter {
    private requestCount = 0;
    private readonly config: PresetConfig;

    constructor(preset: RateLimitPreset) {
        this.config = PRESETS[preset];
    }

    get retryBaseMs(): number {
        return this.config.retryBaseMs;
    }

    async afterPage(): Promise<void> {
        this.requestCount++;
        if (this.requestCount % this.config.cooldownEvery === 0) {
            await jitter(...this.config.cooldownMs);
        } else {
            await jitter(...this.config.pageDelayMs);
        }
    }

    afterThread(): Promise<void> {
        return jitter(...this.config.threadDelayMs);
    }
}

export { RateLimiter };

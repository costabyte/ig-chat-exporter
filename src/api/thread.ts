import { IgApiClient } from 'instagram-private-api';
import { readFile, rename, unlink, writeFile } from 'fs/promises';
import * as path from 'path';
import type { Checkpoint, RawMessage } from '../export/schema';
import type { RateLimiter } from '../utils/rate-limiter';
import { retry } from '../utils/retry';

const checkpointPath = (outputDir: string, threadId: string): string =>
    path.join(outputDir, `${threadId}.checkpoint.json`);

const loadCheckpoint = async (outputDir: string, threadId: string): Promise<Checkpoint | null> => {
    try {
        return JSON.parse(await readFile(checkpointPath(outputDir, threadId), 'utf-8')) as Checkpoint;
    } catch {
        return null;
    }
};

const saveCheckpoint = async (outputDir: string, cp: Checkpoint): Promise<void> => {
    const dest = checkpointPath(outputDir, cp.threadId);
    const tmp = dest + '.tmp';
    await writeFile(tmp, JSON.stringify(cp));
    await rename(tmp, dest);
};

const removeCheckpoint = async (outputDir: string, threadId: string): Promise<void> => {
    try {
        await unlink(checkpointPath(outputDir, threadId));
    } catch {}
};

const fetchMessages = async (
    ig: IgApiClient,
    threadId: string,
    outputDir: string,
    limiter: RateLimiter,
    stopping: { value: boolean },
    knownIds?: Set<string>,
    onProgress?: (fetched: number) => void,
): Promise<RawMessage[]> => {
    const checkpoint = await loadCheckpoint(outputDir, threadId);
    const messages: RawMessage[] = checkpoint?.messages ?? [];
    const cursor = checkpoint?.cursor ?? undefined;

    const feed = ig.feed.directThread({
        thread_id: threadId,
        oldest_cursor: cursor ?? '',
    } as Parameters<typeof ig.feed.directThread>[0]);

    let hitKnown = false;

    do {
        const page = await retry(() => feed.items(), 5, limiter.retryBaseMs);

        for (const item of page) {
            const raw = item as unknown as RawMessage;
            if (knownIds?.has(raw.item_id)) {
                hitKnown = true;
                break;
            }
            messages.push(raw);
        }

        onProgress?.(messages.length);

        // keep the feed's cursor for the next page
        const nextCursor = feed.isMoreAvailable()
            ? ((feed as unknown as { cursor: string | undefined }).cursor ?? null)
            : null;

        await saveCheckpoint(outputDir, {
            threadId,
            cursor: nextCursor,
            messages: messages,
            savedAt: new Date().toISOString(),
        });

        if (hitKnown || stopping.value) break;

        if (feed.isMoreAvailable()) {
            await limiter.afterPage();
        }
    } while (feed.isMoreAvailable());

    messages.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

    if (!stopping.value) {
        await removeCheckpoint(outputDir, threadId);
    }

    return messages;
};

export { fetchMessages, loadCheckpoint };

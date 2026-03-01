import { IgApiClient } from 'instagram-private-api';
import type { RawMessage, ThreadItem } from '../export/schema';

const listThreads = async (ig: IgApiClient): Promise<ThreadItem[]> => {
    const feed = ig.feed.directInbox();
    const threads: ThreadItem[] = [];

    do {
        const page = await feed.items();
        for (const t of page) {
            threads.push({
                summary: {
                    threadId: t.thread_id,
                    threadV2Id: t.thread_v2_id,
                    title: t.thread_title,
                    isGroup: t.is_group,
                    participantCount: (t.users?.length ?? 0) + 1,
                    lastActivityAt: new Date(Number(t.last_activity_at) / 1000).toISOString(),
                    oldestCursor: t.oldest_cursor,
                },
                raw: t as unknown as RawMessage,
            });
        }
    } while (feed.isMoreAvailable());

    return threads;
};

export { listThreads };

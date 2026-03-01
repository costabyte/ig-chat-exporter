import 'dotenv/config';
import * as p from '@clack/prompts';
import { mkdir, readFile } from 'fs/promises';
import * as pathMod from 'path';
import axios from 'axios';
import type { IgApiClient } from 'instagram-private-api';
import type { Client } from './auth/session';
import { initClient } from './auth/session';
import { listThreads } from './api/inbox';
import { fetchMessages } from './api/thread';
import { downloadMedia, extractMedia } from './api/media';
import { makeUserMap, toMessage } from './export/serializer';
import { saveArchive } from './export/writer';
import { wizard } from './tui/wizard';
import { RateLimiter } from './utils/rate-limiter';
import { retry } from './utils/retry';
import { sha256 } from './utils/crypto';
import type { Archive, MediaAsset, Message, Participant, RawMessage, UserRef } from './export/schema';

const stopping = { value: false };

const parseUsers = (thread: RawMessage): Participant[] => {
    const users = (thread.users as Array<Record<string, unknown>>) ?? [];
    const inviter = thread.inviter as Record<string, unknown> | undefined;
    const all = inviter ? [inviter, ...users] : users;

    return all.map(u => ({
        user_id: String(u.pk ?? u.id ?? ''),
        username: String(u.username ?? ''),
        full_name: String(u.full_name ?? ''),
        is_verified: Boolean(u.is_verified),
        is_private: Boolean(u.is_private),
        profile_pic: null,
    }));
};

const downloadProfilePic = async (
    ig: IgApiClient,
    participant: Participant,
    limiter: RateLimiter,
    encodeBase64: boolean,
): Promise<MediaAsset | null> => {
    try {
        await limiter.afterPage();

        const userInfo = await ig.user.info(Number(participant.user_id));
        const hdPic = userInfo.hd_profile_pic_url_info;
        const url = hdPic?.url;
        if (!url) return null;

        const response = await axios.get<ArrayBuffer>(url, {
            responseType: 'arraybuffer',
            timeout: 60_000,
            headers: { 'User-Agent': ig.state.appUserAgent },
            maxContentLength: 50 * 1024 * 1024,
        });

        const buffer = Buffer.from(response.data);
        const asset: MediaAsset = {
            type: 'image',
            url,
            mime: 'image/jpeg',
            width: hdPic?.width ?? 0,
            height: hdPic?.height ?? 0,
            size: buffer.length,
            sha256: sha256(buffer),
            data: buffer.toString('base64'),
            downloaded_at: Date.now(),
        };
        return encodeBase64 ? asset : { ...asset, data: '' };
    } catch {
        return null;
    }
};

const loadExisting = async (outputDir: string, threadId: string): Promise<Message[]> => {
    try {
        const archivePath = pathMod.join(outputDir, threadId, 'archive.json');
        const data = JSON.parse(await readFile(archivePath, 'utf-8')) as Archive;
        return data.messages ?? [];
    } catch {
        return [];
    }
};

const archiveThread = async (
    { ig, username, userId }: Client,
    threadRaw: RawMessage,
    outputDir: string,
    limiter: RateLimiter,
    downloadMediaEnabled: boolean,
    encodeBase64: boolean,
): Promise<string> => {
    const threadId = threadRaw.thread_id as string;
    const participants = parseUsers(threadRaw);

    // add the scraper user to participants if not already present
    const selfInList = participants.some(p => p.user_id === userId);

    if (!selfInList && userId) {
        participants.push({
            user_id: userId,
            username,
            full_name: '',
            is_verified: false,
            is_private: false,
            profile_pic: null,
        });
    }

    const userMap = makeUserMap(participants);

    const existing = await loadExisting(outputDir, threadId);
    const knownIds = new Set(existing.map(m => m.item_id));

    p.log.step(`Fetching messages for "${threadRaw.thread_title as string}"...`);
    if (knownIds.size > 0) {
        p.log.info(`${knownIds.size} existing messages found, fetching new ones...`);
    }

    const rawMessages = await fetchMessages(
        ig,
        threadId,
        outputDir,
        limiter,
        stopping,
        knownIds.size > 0 ? knownIds : undefined,
        count => p.log.info(`${count} messages fetched`),
    );

    if (stopping.value) {
        p.log.warn('Stopping — checkpoint saved, will resume next run');
        return '';
    }

    p.log.step(`Processing ${rawMessages.length} new messages...`);

    const messages: Message[] = [];
    for (const item of rawMessages) {
        let media = null;

        if (downloadMediaEnabled) {
            const meta = extractMedia(item);
            if (meta) {
                try {
                    const asset = await retry(() => downloadMedia(ig, meta), 3, 5_000);
                    media = encodeBase64 ? asset : { ...asset, data: '' };
                } catch {
                    p.log.warn(`Could not download media for item ${item.item_id}`);
                }
            }
        }

        messages.push(toMessage(item, userMap, media));
    }

    if (downloadMediaEnabled) {
        p.log.step(
            `Downloading HD profile pictures for ${participants.length} participant(s)\nThis requires one API call each, so it may take a moment`,
        );
        for (const participant of participants) {
            participant.profile_pic = await downloadProfilePic(ig, participant, limiter, encodeBase64);
        }
    }

    // merge with existing messages and dedupe by item_id
    const merged = new Map<string, Message>();
    for (const m of existing) merged.set(m.item_id, m);
    for (const m of messages) merged.set(m.item_id, m);

    const allMessages = [...merged.values()].sort((a, b) => a.timestamp - b.timestamp);

    const adminIds = ((threadRaw.admin_user_ids as string[]) ?? []).map(String);
    const admins: UserRef[] = adminIds.map(id => ({
        user_id: id,
        username: userMap.get(id) ?? 'unknown',
    }));
    const timestamps = allMessages.map(m => m.timestamp).filter(Boolean);

    const archive: Archive = {
        exported_at: Date.now(),
        exported_by: { user_id: userId, username },
        thread: {
            thread_id: threadId,
            thread_v2_id: String(threadRaw.thread_v2_id ?? ''),
            thread_title: String(threadRaw.thread_title ?? ''),
            is_group: Boolean(threadRaw.is_group),
            participants,
            admins,
            total_messages: allMessages.length,
            oldest_message: timestamps.length ? Math.min(...timestamps) : null,
            newest_message: timestamps.length ? Math.max(...timestamps) : null,
        },
        messages: allMessages,
    };

    return saveArchive(archive, outputDir);
};

const main = async (): Promise<void> => {
    process.on('SIGINT', () => {
        stopping.value = true;
        p.log.warn('\nFinishing current page and saving checkpoint');
    });

    const { config, client, threads } = await wizard(
        step1 => initClient(step1.sessionFile, step1.cookieFile),
        listThreads,
    );
    await mkdir(config.outputDir, { recursive: true });

    const limiter = new RateLimiter(config.rateLimitPreset);

    for (let i = 0; i < threads.length; i++) {
        if (stopping.value) break;

        const dest = await archiveThread(
            client,
            threads[i].raw,
            config.outputDir,
            limiter,
            config.downloadMedia,
            config.encodeBase64,
        );

        if (dest) {
            p.log.success(`Saved: ${dest}`);
        }

        if (stopping.value) break;

        if (i < threads.length - 1) {
            p.log.info('Waiting before next thread');
            await limiter.afterThread();
        }
    }

    if (!stopping.value) {
        p.outro('Archive complete');
    }
};

main().catch(err => {
    const e = err as Error & { response?: { statusCode?: number; body?: unknown } };
    p.log.error(e.message);
    if (e.response) {
        p.log.error(`HTTP ${e.response.statusCode ?? '?'}: ${JSON.stringify(e.response.body)}`);
    }
    process.exit(1);
});

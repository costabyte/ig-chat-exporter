import * as p from '@clack/prompts';
import * as path from 'path';
import type { IgApiClient } from 'instagram-private-api';
import type { Client } from '../auth/session';
import type { RunConfig, ThreadItem } from '../export/schema';

interface WizardStep1 {
    sessionFile: string;
    cookieFile: string;
    outputDir: string;
    rateLimitPreset: 'safe' | 'fast';
    downloadMedia: boolean;
    encodeBase64: boolean;
}

const cancel = (): void => {
    p.cancel('Cancelled');
    process.exit(0);
};

const guard = (val: unknown): void => {
    if (p.isCancel(val)) cancel();
};

const configPrompts = async (): Promise<WizardStep1> => {
    p.intro('ig-chat-exporter - an Instagram DM archiver');

    const sessionFile = await p.text({
        message: 'Session file path:',
        placeholder: './session.json',
        initialValue: process.env.IG_SESSION_FILE ?? './session.json',
    });
    guard(sessionFile);

    const cookieFile = await p.text({
        message: 'Cookie file path:',
        placeholder: './cookies.json',
        initialValue: process.env.IG_COOKIE_FILE ?? './cookies.json',
    });
    guard(cookieFile);

    const outputDir = await p.text({
        message: 'Output directory:',
        placeholder: './archives',
        initialValue: process.env.IG_OUTPUT_DIR ?? './archives',
    });
    guard(outputDir);

    const rateLimitPreset = await p.select({
        message: 'Rate limit preset:',
        options: [
            { value: 'safe', label: 'Safe', hint: '3–8s between pages, recommended' },
            { value: 'fast', label: 'Fast', hint: '1.5–4s between pages, higher risk' },
        ],
    });
    guard(rateLimitPreset);

    const downloadMedia = await p.confirm({
        message: 'Download media (images, video, audio)?',
        initialValue: true,
    });
    guard(downloadMedia);

    let encodeBase64 = false;
    if (downloadMedia) {
        const b64 = await p.confirm({
            message: 'Embed media as Base64 in archive.json?',
            initialValue: true,
        });
        guard(b64);
        encodeBase64 = b64 as boolean;
    }

    return {
        sessionFile: path.resolve(sessionFile as string),
        cookieFile: path.resolve(cookieFile as string),
        outputDir: path.resolve(outputDir as string),
        rateLimitPreset: rateLimitPreset as 'safe' | 'fast',
        downloadMedia: downloadMedia as boolean,
        encodeBase64,
    };
};

const selectThreads = async (
    items: ThreadItem[],
    step1: WizardStep1,
): Promise<{ config: RunConfig; selected: ThreadItem[] }> => {
    const options = items.map(i => ({
        value: i.summary.threadId,
        label: i.summary.title || '(no title)',
        hint: i.summary.isGroup ? `group · ${i.summary.participantCount} members` : 'direct',
    }));

    const selected = await p.multiselect({
        message: 'Select threads to archive:',
        options,
        required: true,
    });
    guard(selected);

    const threadIds = selected as string[];

    const confirmed = await p.confirm({
        message: `Archive ${threadIds.length} thread(s) to ${step1.outputDir}?`,
        initialValue: true,
    });
    guard(confirmed);

    if (!confirmed) cancel();

    const selectedItems = items.filter(i => threadIds.includes(i.summary.threadId));
    return { config: { ...step1, threadIds }, selected: selectedItems };
};

const wizard = async (
    authenticate: (step1: WizardStep1) => Promise<Client>,
    fetchThreads: (ig: IgApiClient) => Promise<ThreadItem[]>,
): Promise<{ config: RunConfig; client: Client; threads: ThreadItem[] }> => {
    const step1 = await configPrompts();

    p.log.step('Authenticating...');
    const client = await authenticate(step1);

    p.log.step('Fetching inbox...');
    const items = await fetchThreads(client.ig);

    p.log.info(`Found ${items.length} conversation(s)`);

    const { config, selected } = await selectThreads(items, step1);

    return { config, client, threads: selected };
};

export { wizard };

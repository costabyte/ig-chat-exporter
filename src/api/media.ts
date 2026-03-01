import axios from 'axios';
import type { IgApiClient } from 'instagram-private-api';
import type { MediaAsset, RawMessage } from '../export/schema';
import { sha256 } from '../utils/crypto';

interface MediaMeta {
    url: string;
    type: MediaAsset['type'];
    mimeType: string;
    width: number | null;
    height: number | null;
    durationMs: number | null;
}

const extractMedia = (item: RawMessage): MediaMeta | null => {
    const t = item.item_type;

    if (t === 'media' || t === 'configure_photo') {
        const m = item.media as Record<string, unknown> | undefined;
        const candidates = (m?.image_versions2 as Record<string, unknown> | undefined)?.candidates as
            | Array<Record<string, unknown>>
            | undefined;
        const vids = m?.video_versions as Array<Record<string, unknown>> | undefined;

        if (vids && vids.length > 0) {
            return {
                url: vids[0].url as string,
                type: 'video',
                mimeType: 'video/mp4',
                width: (vids[0].width as number) ?? null,
                height: (vids[0].height as number) ?? null,
                durationMs: null,
            };
        }

        if (candidates && candidates.length > 0) {
            return {
                url: candidates[0].url as string,
                type: 'image',
                mimeType: 'image/jpeg',
                width: (candidates[0].width as number) ?? null,
                height: (candidates[0].height as number) ?? null,
                durationMs: null,
            };
        }

        return null;
    }

    if (t === 'voice_media') {
        const audio = ((item.voice_media as Record<string, unknown>)?.media as Record<string, unknown>)?.audio as
            | Record<string, unknown>
            | undefined;
        if (!audio?.audio_src) return null;

        return {
            url: audio.audio_src as string,
            type: 'audio',
            mimeType: 'audio/mpeg',
            width: null,
            height: null,
            durationMs: (audio.duration as number) ?? null,
        };
    }

    if (t === 'animated_media') {
        const img = ((item.animated_media as Record<string, unknown>)?.images as Record<string, unknown>)
            ?.fixed_height as Record<string, unknown> | undefined;
        if (!img?.url) return null;

        return {
            url: img.url as string,
            type: 'gif',
            mimeType: 'image/gif',
            width: (img.width as number) ?? null,
            height: (img.height as number) ?? null,
            durationMs: null,
        };
    }

    if (t === 'raven_media') {
        const vm = item.visual_media as Record<string, unknown> | undefined;
        const candidates = ((vm?.media as Record<string, unknown>)?.image_versions2 as Record<string, unknown>)
            ?.candidates as Array<Record<string, unknown>> | undefined;
        if (!candidates?.length) return null;

        return {
            url: candidates[0].url as string,
            type: 'raven',
            mimeType: 'image/jpeg',
            width: (candidates[0].width as number) ?? null,
            height: (candidates[0].height as number) ?? null,
            durationMs: null,
        };
    }

    if (t === 'media_share') {
        const m = item.media_share as Record<string, unknown> | undefined;
        const candidates = (m?.image_versions2 as Record<string, unknown>)?.candidates as
            | Array<Record<string, unknown>>
            | undefined;
        if (!candidates?.length) return null;

        return {
            url: candidates[0].url as string,
            type: 'image',
            mimeType: 'image/jpeg',
            width: (candidates[0].width as number) ?? null,
            height: (candidates[0].height as number) ?? null,
            durationMs: null,
        };
    }

    if (t === 'reel_share' || t === 'story_share') {
        const rs = item[t] as Record<string, unknown> | undefined;
        const candidates = ((rs?.media as Record<string, unknown>)?.image_versions2 as Record<string, unknown>)
            ?.candidates as Array<Record<string, unknown>> | undefined;
        if (!candidates?.length) return null;

        return {
            url: candidates[0].url as string,
            type: 'image',
            mimeType: 'image/jpeg',
            width: (candidates[0].width as number) ?? null,
            height: (candidates[0].height as number) ?? null,
            durationMs: null,
        };
    }

    if (t === 'generic_xma' || t === 'xma_media_share' || t === 'xma_story_share' || t === 'xma_clip') {
        const arr = item[t] as Array<Record<string, unknown>> | undefined;
        if (!arr?.length) return null;
        const xma = arr[0];

        // prefer image_versions2.candidates[0] (full quality image) over preview_url_info (thumbnail)
        const candidates = (xma.image_versions2 as Record<string, unknown> | undefined)?.candidates as
            | Array<Record<string, unknown>>
            | undefined;
        if (candidates?.length) {
            return {
                url: candidates[0].url as string,
                type: 'image',
                mimeType: 'image/jpeg',
                width: (candidates[0].width as number) ?? null,
                height: (candidates[0].height as number) ?? null,
                durationMs: null,
            };
        }

        // try playable_url_info before preview
        if (t === 'xma_clip') {
            const playable = xma.playable_url_info as Record<string, unknown> | undefined;
            if (playable?.url) {
                return {
                    url: playable.url as string,
                    type: 'video',
                    mimeType: 'video/mp4',
                    width: null,
                    height: null,
                    durationMs: null,
                };
            }
        }

        // fallback to preview_url_info
        const preview = xma.preview_url_info as Record<string, unknown> | undefined;
        if (preview?.url) {
            return {
                url: preview.url as string,
                type: 'image',
                mimeType: 'image/jpeg',
                width: null,
                height: null,
                durationMs: null,
            };
        }

        return null;
    }

    return null;
};

const downloadMedia = async (ig: IgApiClient, meta: MediaMeta): Promise<MediaAsset> => {
    const response = await axios.get<ArrayBuffer>(meta.url, {
        responseType: 'arraybuffer',
        timeout: 60_000,
        headers: { 'User-Agent': ig.state.appUserAgent },
        maxContentLength: 200 * 1024 * 1024,
    });

    const buffer = Buffer.from(response.data);

    const base = {
        type: meta.type,
        url: meta.url,
        mime: meta.mimeType,
        size: buffer.length,
        sha256: sha256(buffer),
        data: buffer.toString('base64'),
        downloaded_at: Date.now(),
    };

    if (meta.type === 'audio') {
        return { ...base, type: 'audio', duration: meta.durationMs };
    }

    if (meta.type === 'video') {
        return {
            ...base,
            type: 'video',
            width: meta.width ?? 0,
            height: meta.height ?? 0,
            duration: meta.durationMs,
        };
    }

    return {
        ...base,
        type: meta.type,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
    } as MediaAsset;
};

export { extractMedia, downloadMedia };
export type { MediaMeta };

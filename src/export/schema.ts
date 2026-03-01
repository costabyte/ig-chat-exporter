export type RateLimitPreset = 'safe' | 'fast';

export interface RunConfig {
    sessionFile: string;
    outputDir: string;
    threadIds: string[];
    downloadMedia: boolean;
    encodeBase64: boolean;
    rateLimitPreset: RateLimitPreset;
    cookieFile: string;
}

export interface ThreadSummary {
    threadId: string;
    threadV2Id: string;
    title: string;
    isGroup: boolean;
    participantCount: number;
    lastActivityAt: string;
    oldestCursor: string | undefined;
}

export interface ThreadItem {
    summary: ThreadSummary;
    raw: RawMessage;
}

export interface Checkpoint {
    threadId: string;
    cursor: string | null;
    messages: RawMessage[];
    savedAt: string;
}

export interface RawMessage {
    item_id: string;
    user_id: string;
    timestamp: string;
    item_type: string;

    [key: string]: unknown;
}

export interface UserRef {
    user_id: string;
    username: string;
}

export interface Participant extends UserRef {
    full_name: string;
    is_verified: boolean;
    is_private: boolean;
    profile_pic: MediaAsset | null;
}

export interface Reaction {
    emoji: string;
    user: UserRef;
    timestamp: number;
}

interface MediaBase {
    type: string;
    url: string;
    mime: string;
    size: number;
    sha256: string;
    data: string;
    downloaded_at: number;
}

export interface ImageMedia extends MediaBase {
    type: 'image' | 'sticker' | 'gif' | 'raven';
    width: number;
    height: number;
}

export interface VideoMedia extends MediaBase {
    type: 'video';
    width: number;
    height: number;
    duration: number | null;
}

export interface AudioMedia extends MediaBase {
    type: 'audio';
    duration: number | null;
}

export type MediaAsset = ImageMedia | VideoMedia | AudioMedia;

export interface PollOption {
    id: string;
    title: string;
    votes: number;
    voters: UserRef[];
}

export interface Poll {
    id: string;
    question: string;
    options: PollOption[];
}

export interface Message {
    item_id: string;
    user: UserRef;
    timestamp: number;
    item_type: string;
    text?: string;
    reactions: Reaction[];
    media?: MediaAsset;
    link?: string;
    poll?: Poll;
    raw: Record<string, unknown>;
}

export interface Archive {
    exported_at: number;
    exported_by: UserRef;
    thread: {
        thread_id: string;
        thread_v2_id: string;
        thread_title: string;
        is_group: boolean;
        participants: Participant[];
        admins: UserRef[];
        total_messages: number;
        oldest_message: number | null;
        newest_message: number | null;
    };
    messages: Message[];
}

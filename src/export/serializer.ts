import type { MediaAsset, Message, Participant, Poll, RawMessage, Reaction, UserRef } from './schema';

const usToMs = (us: string): number => Math.floor(Number(us) / 1000);

const toReactions = (item: RawMessage, userMap: Map<string, string>): Reaction[] => {
    const reactions = item.reactions as
        | { emojis?: Array<{ sender_id: string; timestamp: string; emoji: string }> }
        | undefined;

    return (reactions?.emojis ?? []).map(r => ({
        emoji: r.emoji,
        user: { user_id: String(r.sender_id), username: userMap.get(String(r.sender_id)) ?? 'unknown' },
        timestamp: Math.floor(Number(r.timestamp) / 1000),
    }));
};

// instagram API returns proper vote counts in list_item_total_votes_count but only a subset of voter IDs in list_item_voter_igids
// the mismatch between votes and voters.length is probably an upstream API limitation
const toPoll = (item: RawMessage, userMap: Map<string, string>): Poll | null => {
    const arr = item.direct_group_poll_v1 as Array<Record<string, unknown>> | undefined;
    if (!arr?.length) return null;

    const poll = arr[0];
    const id = String(poll.list_items_id ?? '');
    const question = String(poll.list_items_description_text ?? '');

    const options = [];

    for (let i = 1; ; i++) {
        const titleKey = `list_item_title_text_${i}`;
        if (!(titleKey in poll)) break;

        const voterIds = ((poll[`list_item_voter_igids_${i}`] as string[]) ?? []).map(String);
        options.push({
            id: String(poll[`list_item_id_${i}`] ?? ''),
            title: String(poll[titleKey] ?? ''),
            votes: (poll[`list_item_total_votes_count_${i}`] as number) ?? 0,
            voters: voterIds.map(vid => ({ user_id: vid, username: userMap.get(vid) ?? 'unknown' })),
        });
    }

    return { id, question, options };
};

const toMessage = (item: RawMessage, userMap: Map<string, string>, media: MediaAsset | null): Message => {
    const timestamp = usToMs(String(item.timestamp));

    const link =
        (((item.link as Record<string, unknown> | undefined)?.link_context as Record<string, unknown> | undefined)
            ?.link_url as string | null) ?? null;

    let text = (item.text as string | undefined) ?? undefined;

    if (item.item_type === 'action_log') {
        const actionLog = item.action_log as { description?: string } | undefined;
        text = actionLog?.description ?? undefined;
    }

    const user: UserRef = {
        user_id: String(item.user_id),
        username: userMap.get(String(item.user_id)) ?? 'unknown',
    };

    const poll = item.item_type === 'direct_group_poll_v1' ? toPoll(item, userMap) : null;

    return {
        item_id: item.item_id,
        user,
        timestamp: timestamp,
        item_type: item.item_type,
        ...(text != null && { text }),
        reactions: toReactions(item, userMap),
        ...(media != null && { media }),
        ...(link != null && { link }),
        ...(poll != null && { poll }),
        raw: item as Record<string, unknown>,
    };
};

const makeUserMap = (participants: Participant[]): Map<string, string> =>
    new Map(participants.map(p => [p.user_id, p.username]));

export { toMessage, makeUserMap };

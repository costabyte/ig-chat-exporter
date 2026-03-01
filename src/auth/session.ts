import { IgApiClient } from 'instagram-private-api';
import { readFile, writeFile } from 'fs/promises';
import * as path from 'path';

interface Client {
    ig: IgApiClient;
    username: string;
    userId: string;
}

// cookie-editor extension export format
interface BrowserCookie {
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite?: string;
    hostOnly?: boolean;
    expirationDate?: number;
}

// convert cookie-editor JSON array to tough-cookie object
const cookiesToJar = (cookies: BrowserCookie[]): object => ({
    storeType: 'MemoryCookieStore',
    rejectPublicSuffixes: true,
    cookies: cookies.map(c => ({
        key: c.name,
        value: c.value,
        domain: c.domain.replace(/^\./, ''),
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        hostOnly: c.hostOnly ?? !c.domain.startsWith('.'),
        sameSite: (c.sameSite ?? 'none').toLowerCase(),
        expires: c.expirationDate ? new Date(c.expirationDate * 1000).toISOString() : 'Infinity',
        creation: new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
    })),
});

const parseCookies = async (cookieFile: string): Promise<object> => {
    const raw = JSON.parse(await readFile(cookieFile, 'utf-8')) as unknown;

    // has a version string, so it's a tough-cookie jar
    if (typeof raw === 'object' && raw !== null && 'version' in raw) return raw as object;

    // has an array of {name, value, domain, etc.}, so it's a cookie-editor export
    if (Array.isArray(raw)) return cookiesToJar(raw as BrowserCookie[]);

    throw new Error(`Unrecognised cookie file format in "${cookieFile}"`);
};

const autosave = (ig: IgApiClient, sessionFile: string): void => {
    ig.request.end$.subscribe(async () => {
        const state = await ig.state.serialize();
        delete state.constants;
        await writeFile(sessionFile, JSON.stringify(state));
    });
};

// patch the library's outdated constants with new values
// special thanks to instagrapi project
const NEW_CONSTANTS = {
    APP_VERSION: '385.0.0.47.74',
    APP_VERSION_CODE: '378906843',
    BLOKS_VERSION_ID: 'a8973d49a9cc6a6f65a4997c10216ce2a06f65a517010e64885e92029bb19221',
};

const patchConstants = (ig: IgApiClient): void => {
    const state = ig.state as unknown as Record<string, unknown>;
    const constants = state.constants as Record<string, unknown>;
    Object.assign(constants, NEW_CONSTANTS);
};

const initClient = async (sessionFile: string, cookieFile: string): Promise<Client> => {
    const ig = new IgApiClient();
    patchConstants(ig);
    autosave(ig, sessionFile);

    ig.state.generateDevice(path.basename(sessionFile));
    const jar = await parseCookies(cookieFile);
    await ig.state.deserializeCookieJar(jar as unknown as string);

    // sync ig_did cookie to uuid so X-IG-Device-ID matches the session's device fingerprint
    const igDid = ig.state.extractCookie('ig_did');
    if (igDid) (ig.state as unknown as Record<string, unknown>).uuid = igDid.value;

    // the mobile API requires an Authorization: Bearer IGT:2:<base64> header in addition to cookies
    // without it instagram returns 400 "User not authorized to perform this request"
    const sessionId = ig.state.extractCookie('sessionid')?.value ?? '';
    const dsUserId = ig.state.extractCookie('ds_user_id')?.value ?? '';
    if (!sessionId || !dsUserId) {
        throw new Error('Your cookie file is missing sessionid or ds_user_id. Please reexport your Instagram cookies.');
    }
    const payload = Buffer.from(
        JSON.stringify({ ds_user_id: dsUserId, sessionid: sessionId, should_use_header_over_cookie: '1' }),
    ).toString('base64');
    (ig.state as unknown as Record<string, unknown>).authorization = `Bearer IGT:2:${payload}`;

    const userInfo = await ig.user.info(Number(dsUserId));
    return { ig, username: userInfo.username, userId: dsUserId };
};

export { initClient };
export type { Client };

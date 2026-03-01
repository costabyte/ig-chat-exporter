import { mkdir, rename, writeFile } from 'fs/promises';
import * as path from 'path';
import type { Archive } from './schema';

const saveArchive = async (archive: Archive, outputDir: string): Promise<string> => {
    const threadDir = path.join(outputDir, archive.thread.thread_id);
    await mkdir(threadDir, { recursive: true });

    const dest = path.join(threadDir, 'archive.json');
    const tmp = dest + '.tmp';

    await writeFile(tmp, JSON.stringify(archive, null, 2), 'utf-8');
    await rename(tmp, dest);

    return dest;
};

export { saveArchive };

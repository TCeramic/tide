// src/core/media/metadata.ts
// 从音频文件读标签：标题、歌手、专辑、封面、内嵌歌词（USLT / LYRICS）。
import { parseBlob } from 'music-metadata';

export interface AudioFileMetadata {
    title: string | null;
    artist: string | null;
    album: string | null;
    duration: number | null;
    cover: Blob | null;
    /** 内嵌的歌词文本（可能是 LRC，也可能是纯文本）。 */
    embeddedLyrics: string | null;
}

const EMPTY: AudioFileMetadata = {
    title: null, artist: null, album: null, duration: null, cover: null, embeddedLyrics: null,
};

export const readAudioMetadata = async (file: Blob): Promise<AudioFileMetadata> => {
    try {
        const metadata = await parseBlob(file, { skipCovers: false, duration: false });
        const { common, format } = metadata;
        const picture = common.picture?.[0];
        const lyrics = common.lyrics
            ?.map(tag => tag.text ?? tag.syncText?.map(entry => entry.text).join('\n') ?? '')
            .find(text => text.trim().length > 0) ?? null;
        return {
            title: common.title ?? null,
            artist: common.artist ?? common.artists?.join(' / ') ?? null,
            album: common.album ?? null,
            duration: format.duration ?? null,
            cover: picture ? new Blob([picture.data as BlobPart], { type: picture.format || 'image/jpeg' }) : null,
            embeddedLyrics: lyrics,
        };
    } catch {
        return EMPTY;
    }
};

// src/project/fileKinds.ts
// 拖进来的文件是什么：按 MIME 与扩展名分类（.lrc 之类的 file.type 常常是空的，扩展名优先）。
import { LYRIC_FILE_ACCEPT } from '@/core/lyrics/load';
import { LUMI_EXTENSION } from './archive';
import { IMAGE_ACCEPT, VIDEO_ACCEPT } from './assets';
import { FONT_FILE_ACCEPT } from './fonts';

export type FileKind = 'project' | 'audio' | 'lyrics' | 'image' | 'video' | 'font' | 'unknown';

const AUDIO_EXTENSIONS = ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'weba', 'aif', 'aiff', 'wma'];

const extensionsOf = (accept: string) => accept.split(',').filter(item => item.startsWith('.')).map(item => item.slice(1).toLowerCase());
const mimesOf = (accept: string) => accept.split(',').filter(item => item.includes('/'));

const LYRIC_EXTENSIONS = extensionsOf(LYRIC_FILE_ACCEPT);
const FONT_EXTENSIONS = extensionsOf(FONT_FILE_ACCEPT);
const IMAGE_MIMES = mimesOf(IMAGE_ACCEPT);
const VIDEO_MIMES = mimesOf(VIDEO_ACCEPT);

const extensionOf = (name: string) => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

export const classifyFile = (file: Pick<File, 'name' | 'type'>): FileKind => {
    const extension = extensionOf(file.name);
    const type = file.type.toLowerCase();
    if (extension === LUMI_EXTENSION) return 'project';
    if (LYRIC_EXTENSIONS.includes(extension)) return 'lyrics';
    if (FONT_EXTENSIONS.includes(extension) || type.startsWith('font/')) return 'font';
    if (type.startsWith('audio/') || AUDIO_EXTENSIONS.includes(extension)) return 'audio';
    if (IMAGE_MIMES.includes(type)) return 'image';
    if (VIDEO_MIMES.includes(type)) return 'video';
    return 'unknown';
};

// src/app/appCommands.ts
// 应用级命令。菜单、命令面板、快捷键都用这里的 id。
import { removeAssetClip } from '@/project/assets';
import { LYRIC_FILE_ACCEPT } from '@/core/lyrics/load';
import {
    exportProjectFile,
    flushAutosave,
    importAudioFile,
    importCoverFile,
    importLyricsFile,
    importProjectFile,
    newProject,
} from '@/project/actions';
import { newId } from '@/project/defaults';
import { useSession } from '@/project/session';
import { updateProject, useProjectStore } from '@/project/store';
import { listPacks, onPacksChanged } from '@/packs/registry';
import { currentSelection, pickParagraphPack, pickParagraphTransition, pickShotComponent, pickShotStyle } from './arrangeActions';
import { downloadBlob, pickFile } from './download';
import { openExportDialog } from './export/ExportDialog';
import { log } from './output';
import { clock, pause, seek, togglePlay, togglePreviewMute, usePlayback } from './playback';
import { togglePreviewFullscreen } from './previewFullscreen';
import { openWizard } from './wizard/wizardStore';
import { requestScriptImport } from './script/scriptImport';
import { scriptEnv } from '@/script/env';
import { printScript } from '@/script/print';
import { registerCommands, type Command } from './workbench/commands';
import {
    openCommandPalette,
    openEditorTab,
    setLayout,
    showPanelView,
    toggleSideView,
    useLayout,
} from './workbench/layout';
import type { MenuDefinition } from './workbench/MenuBar';
import { showQuickPick } from './workbench/QuickPick';
import { currentLanguage, LANGUAGES, setLanguage, t } from '@/i18n';
import { packLabel } from '@/i18n/catalog';
import type { ParseKeys } from 'i18next';

const nudge = (delta: number) => seek(Math.min(usePlayback.getState().duration, clock.get() + delta));

// 标题、类别、菜单名都在显示时才取文字，切换界面语言后跟着变。
const category = (key: keyof typeof import('@/i18n/locales/zh/commands.json')['categories']) => () => t(`commands:categories.${key}`);
const title = (key: ParseKeys<'commands'>) => () => t(key, { ns: 'commands' });
const menu = (key: keyof typeof import('@/i18n/locales/zh/commands.json')['menus']) => () => t(`commands:menus.${key}`);

/** 选界面语言（语言名用各自的语言写）。 */
const pickLanguage = async () => {
    const current = currentLanguage();
    const picked = await showQuickPick(
        LANGUAGES.map(language => ({ label: language.label, value: language.code, picked: language.code === current })),
        { placeholder: t('commands:languagePlaceholder') },
    );
    if (picked) setLanguage(picked);
};

export const APP_COMMANDS: Command[] = [
    // 文件
    { id: 'project.wizard', category: category('project'), title: title('titles.project.wizard'), run: () => openWizard({ fresh: true }) },
    { id: 'project.new', category: category('project'), title: title('titles.project.new'), keybinding: 'Ctrl+Alt+N', global: true, run: () => newProject() },
    { id: 'project.open', category: category('project'), title: title('titles.project.open'), keybinding: 'Ctrl+O', global: true, run: () => openCommandPalette('') },
    {
        id: 'project.save', category: category('project'), title: title('titles.project.save'), keybinding: 'Ctrl+S', global: true,
        run: async () => {
            await flushAutosave();
            log(t('commands:saved'));
        },
    },
    {
        id: 'project.import', category: category('project'), title: title('titles.project.import'),
        run: async () => {
            const file = await pickFile('.lumi,application/zip');
            if (file) await importProjectFile(file);
        },
    },
    {
        id: 'project.export', category: category('project'), title: title('titles.project.export'), keybinding: 'Ctrl+Shift+S', global: true,
        run: async () => {
            const { blob, fileName } = await exportProjectFile();
            downloadBlob(blob, fileName);
        },
    },
    { id: 'export.video', category: category('file'), title: title('titles.export.video'), keybinding: 'Ctrl+E', global: true, run: () => openExportDialog() },
    {
        id: 'input.audio', category: category('song'), title: title('titles.input.audio'),
        run: async () => {
            const file = await pickFile('audio/*');
            if (file) await importAudioFile(file);
        },
    },
    {
        id: 'input.lyrics', category: category('song'), title: title('titles.input.lyrics'),
        run: async () => {
            const file = await pickFile(LYRIC_FILE_ACCEPT);
            if (file) await importLyricsFile(file);
        },
    },
    {
        id: 'input.translation', category: category('song'), title: title('titles.input.translation'),
        run: async () => {
            const file = await pickFile(LYRIC_FILE_ACCEPT);
            if (file) await importLyricsFile(file, 'translation');
        },
    },
    {
        id: 'input.cover', category: category('song'), title: title('titles.input.cover'),
        run: async () => {
            const file = await pickFile('image/*');
            if (file) await importCoverFile(file);
        },
    },

    {
        id: 'script.import', category: category('script'), title: title('titles.script.import'),
        run: async () => {
            const file = await pickFile('.lumiscript,.txt,.json,text/plain,application/json');
            if (!file) return;
            openEditorTab('script', true);
            requestScriptImport(file);
        },
    },
    {
        id: 'script.export', category: category('script'), title: title('titles.script.export'),
        run: () => {
            const project = useProjectStore.getState().project;
            const text = printScript(scriptEnv(project, useSession.getState().audioBuffer?.duration ?? null)).text;
            const name = (project.meta.title || project.name).replace(/[\\/:*?"<>|]+/g, '_') || 'lumisynth';
            downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${name}.lumiscript`);
        },
    },

    // 编辑
    {
        id: 'edit.undo', category: category('edit'), title: title('titles.edit.undo'), keybinding: 'Ctrl+Z',
        enabled: () => useProjectStore.getState().past.length > 0,
        run: () => useProjectStore.getState().undo(),
    },
    {
        id: 'edit.redo', category: category('edit'), title: title('titles.edit.redo'), keybinding: 'Ctrl+Shift+Z',
        enabled: () => useProjectStore.getState().future.length > 0,
        run: () => useProjectStore.getState().redo(),
    },
    {
        id: 'edit.redoAlt', category: category('edit'), title: title('titles.edit.redoAlt'), keybinding: 'Ctrl+Y',
        enabled: () => useProjectStore.getState().future.length > 0,
        run: () => useProjectStore.getState().redo(),
    },
    {
        id: 'arrange.reseed', category: category('arrange'), title: title('titles.arrange.reseed'),
        run: () => updateProject(p => ({ ...p, seed: newId().slice(0, 8) })),
    },
    {
        id: 'arrange.mix', category: category('arrange'), title: title('titles.arrange.mix'),
        run: () => updateProject(p => ({ ...p, direction: { ...p.direction, mode: 'mix' } })),
    },
    {
        // 对话框、右键菜单、命令面板开着时 Esc 只关掉它们（它们自己处理），不顺带清掉选择。
        id: 'selection.clear', category: category('edit'), title: title('titles.selection.clear'), keybinding: 'Escape',
        enabled: () => useSession.getState().selection.type !== 'none' && !document.querySelector('[role="dialog"], [role="menu"]'),
        run: () => useSession.setState({ selection: { type: 'none' } }),
    },
    {
        id: 'clip.delete', category: category('edit'), title: title('titles.clip.delete'), keybinding: 'Delete',
        enabled: () => useSession.getState().selection.type === 'clip',
        run: () => {
            const selection = useSession.getState().selection;
            if (selection.type !== 'clip') return;
            removeAssetClip(selection.clipId);
            useSession.setState({ selection: { type: 'none' } });
        },
    },
    {
        id: 'arrange.shotStyle', category: category('arrange'), title: title('titles.arrange.shotStyle'), keybinding: 'Alt+S',
        enabled: () => useSession.getState().selection.type === 'shot',
        run: () => { const { shot } = currentSelection(); if (shot) void pickShotStyle(shot); },
    },
    {
        id: 'arrange.shotTypography', category: category('arrange'), title: title('titles.arrange.shotTypography'), keybinding: 'Alt+T',
        enabled: () => useSession.getState().selection.type === 'shot',
        run: () => { const { shot } = currentSelection(); if (shot) void pickShotComponent(shot, 'typography'); },
    },
    {
        id: 'arrange.shotAccent', category: category('arrange'), title: title('titles.arrange.shotAccent'),
        enabled: () => useSession.getState().selection.type === 'shot',
        run: () => { const { shot } = currentSelection(); if (shot) void pickShotComponent(shot, 'accent'); },
    },
    {
        id: 'arrange.paragraphPack', category: category('arrange'), title: title('titles.arrange.paragraphPack'), keybinding: 'Alt+P',
        enabled: () => ['shot', 'paragraph'].includes(useSession.getState().selection.type),
        run: () => { const { paragraph } = currentSelection(); if (paragraph) void pickParagraphPack(paragraph); },
    },
    {
        id: 'arrange.paragraphTransition', category: category('arrange'), title: title('titles.arrange.paragraphTransition'),
        enabled: () => ['shot', 'paragraph'].includes(useSession.getState().selection.type),
        run: () => { const { paragraph } = currentSelection(); if (paragraph) void pickParagraphTransition(paragraph); },
    },
    {
        id: 'look.toggleVariant', category: category('look'), title: title('titles.look.toggleVariant'),
        run: () => updateProject(p => ({ ...p, theme: { ...p.theme, variant: p.theme.variant === 'dark' ? 'light' : 'dark' } })),
    },

    // 视图
    { id: 'workbench.commandPalette', category: category('view'), title: title('titles.workbench.commandPalette'), keybinding: 'Ctrl+Shift+P', global: true, run: () => openCommandPalette('>') },
    { id: 'workbench.commandPaletteF1', category: category('view'), title: title('titles.workbench.commandPaletteF1'), keybinding: 'F1', global: true, run: () => openCommandPalette('>') },
    {
        id: 'workbench.toggleSideBar', category: category('view'), title: title('titles.workbench.toggleSideBar'), keybinding: 'Ctrl+B', global: true,
        run: () => setLayout({ sideBarVisible: !useLayout.getState().sideBarVisible }),
    },
    {
        id: 'workbench.togglePanel', category: category('view'), title: title('titles.workbench.togglePanel'), keybinding: 'Ctrl+J', global: true,
        run: () => setLayout({ panelVisible: !useLayout.getState().panelVisible }),
    },
    {
        id: 'workbench.toggleAuxBar', category: category('view'), title: title('titles.workbench.toggleAuxBar'), keybinding: 'Ctrl+Alt+B', global: true,
        run: () => setLayout({ auxBarVisible: !useLayout.getState().auxBarVisible }),
    },
    { id: 'view.assets', category: category('view'), title: title('titles.view.assets'), keybinding: 'Ctrl+Shift+E', global: true, run: () => toggleSideView('assets') },
    { id: 'view.look', category: category('view'), title: title('titles.view.look'), keybinding: 'Ctrl+Shift+L', global: true, run: () => toggleSideView('look') },
    { id: 'view.assetLibrary', category: category('view'), title: title('titles.view.assetLibrary'), run: () => toggleSideView('assetLibrary') },
    { id: 'view.library', category: category('view'), title: title('titles.view.library'), keybinding: 'Ctrl+Shift+G', global: true, run: () => toggleSideView('library') },
    { id: 'view.ai', category: category('view'), title: title('titles.view.ai'), keybinding: 'Ctrl+Shift+A', global: true, run: () => toggleSideView('ai') },
    { id: 'view.libraryEditor', category: category('view'), title: title('titles.view.libraryEditor'), run: () => openEditorTab('library') },
    { id: 'view.libraryEditorSplit', category: category('view'), title: title('titles.view.libraryEditorSplit'), run: () => openEditorTab('library', true) },
    { id: 'view.script', category: category('view'), title: title('titles.view.script'), keybinding: 'Ctrl+Shift+K', global: true, run: () => openEditorTab('script', true) },
    { id: 'view.lyrics', category: category('view'), title: title('titles.view.lyrics'), keybinding: 'Ctrl+Shift+Y', global: true, run: () => openEditorTab('lyrics', true) },
    { id: 'view.themePark', category: category('view'), title: title('titles.view.themePark'), keybinding: 'Ctrl+Shift+H', global: true, run: () => openEditorTab('theme', true) },
    { id: 'view.settings', category: category('view'), title: title('titles.view.settings'), keybinding: 'Ctrl+,', global: true, run: () => openEditorTab('settings') },
    { id: 'view.storyboard', category: category('view'), title: title('titles.view.storyboard'), keybinding: 'Ctrl+Alt+O', global: true, run: () => openEditorTab('storyboard', false) },
    { id: 'view.outline', category: category('view'), title: title('titles.view.outline'), keybinding: 'Ctrl+Shift+O', global: true, run: () => toggleSideView('outline') },
    { id: 'view.agent', category: category('view'), title: title('titles.view.agent'), run: () => toggleSideView('agent') },
    { id: 'view.layoutMobile', category: category('view'), title: title('titles.view.layoutMobile'), run: () => setLayout({ uiMode: 'mobile' }) },
    { id: 'view.layoutDesktop', category: category('view'), title: title('titles.view.layoutDesktop'), run: () => setLayout({ uiMode: 'desktop' }) },
    { id: 'view.layoutAuto', category: category('view'), title: title('titles.view.layoutAuto'), run: () => setLayout({ uiMode: 'auto' }) },
    { id: 'workbench.language', category: category('view'), title: title('titles.workbench.language'), run: pickLanguage },
    { id: 'view.timeline', category: category('view'), title: title('titles.view.timeline'), run: () => showPanelView('timeline') },
    { id: 'view.problems', category: category('view'), title: title('titles.view.problems'), keybinding: 'Ctrl+Shift+M', global: true, run: () => showPanelView('problems') },
    { id: 'view.output', category: category('view'), title: title('titles.view.output'), keybinding: 'Ctrl+Shift+U', global: true, run: () => showPanelView('output') },

    // 播放
    { id: 'playback.toggle', category: category('playback'), title: title('titles.playback.toggle'), keybinding: 'Space', run: togglePlay },
    { id: 'playback.start', category: category('playback'), title: title('titles.playback.start'), keybinding: 'Home', run: () => { pause(); seek(0); } },
    { id: 'playback.back', category: category('playback'), title: title('titles.playback.back'), keybinding: 'ArrowLeft', run: () => nudge(-5) },
    { id: 'playback.forward', category: category('playback'), title: title('titles.playback.forward'), keybinding: 'ArrowRight', run: () => nudge(5) },
    { id: 'playback.backFine', category: category('playback'), title: title('titles.playback.backFine'), keybinding: 'Shift+ArrowLeft', run: () => nudge(-1 / 30) },
    { id: 'playback.forwardFine', category: category('playback'), title: title('titles.playback.forwardFine'), keybinding: 'Shift+ArrowRight', run: () => nudge(1 / 30) },
    { id: 'view.previewFullscreen', category: category('view'), title: title('titles.view.previewFullscreen'), keybinding: 'F', run: togglePreviewFullscreen },
    { id: 'playback.toggleMute', category: category('playback'), title: title('titles.playback.toggleMute'), keybinding: 'M', run: togglePreviewMute },
];

export const APP_MENUS: MenuDefinition[] = [
    {
        label: menu('file'),
        items: [
            'project.wizard', 'project.new', 'project.open', '-',
            '#song', 'input.audio', 'input.lyrics', 'input.translation', 'input.cover', '-',
            '#script', 'script.import', 'script.export', '-',
            '#project', 'project.save', 'project.import', 'project.export', '-',
            'export.video',
        ],
    },
    {
        label: menu('edit'),
        items: ['edit.undo', 'edit.redo', '-', 'clip.delete', '-', 'view.settings'],
    },
    {
        label: menu('arrange'),
        items: [
            'arrange.shotStyle', 'arrange.shotTypography', 'arrange.shotAccent', '-',
            'arrange.paragraphPack', 'arrange.paragraphTransition', '-',
            '#wholeSong', 'arrange.packs', 'arrange.mix', 'arrange.reseed', '-',
            '#look', 'look.toggleVariant', 'view.themePark', '-',
            'view.storyboard', 'view.script', 'view.outline',
        ],
    },
    {
        label: menu('view'),
        items: [
            'workbench.commandPalette', '-',
            '#sideBar', 'view.assets', 'view.outline', 'view.look', 'view.library', 'view.assetLibrary', 'view.ai', 'view.agent', '-',
            '#editor', 'view.storyboard', 'view.lyrics', 'view.script', 'view.themePark', 'view.libraryEditor', 'view.libraryEditorSplit', 'view.settings', '-',
            '#panel', 'view.timeline', 'view.problems', 'view.output', '-',
            '#layout', 'workbench.toggleSideBar', 'workbench.togglePanel', 'workbench.toggleAuxBar', 'view.previewFullscreen', 'view.layoutMobile', 'view.layoutAuto', '-',
            'workbench.language',
        ],
    },
    { label: menu('playback'), items: ['playback.toggle', 'playback.start', '-', 'playback.back', 'playback.forward', 'playback.backFine', 'playback.forwardFine', '-', 'playback.toggleMute'] },
];

/** 每个风格包一条「全曲使用 xx」命令；以后注册的包也会补上。 */
const packCommands = (): Command[] => listPacks().map(pack => ({
    id: `arrange.pack.${pack.id}`,
    category: category('arrange'),
    title: () => t('commands:titles.arrange.packUse', { pack: packLabel(pack.id) }),
    run: () => updateProject(p => ({ ...p, direction: { ...p.direction, mode: 'single', pack: pack.id } })),
}));

let registered = false;
export const registerAppCommands = () => {
    if (registered) return;
    registered = true;
    registerCommands(APP_COMMANDS);
    let unregisterPacks = registerCommands(packCommands());
    onPacksChanged(() => {
        unregisterPacks();
        unregisterPacks = registerCommands(packCommands());
    });
};

/** 菜单里的占位项 `arrange.packs` 展开成每个包一条。 */
export const expandMenuItems = (items: string[]) => items.flatMap(item => (
    item === 'arrange.packs' ? listPacks().map(pack => `arrange.pack.${pack.id}`) : [item]
));

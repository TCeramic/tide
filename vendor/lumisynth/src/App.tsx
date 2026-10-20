import { useEffect, useState } from 'react';
import { Bot, FolderOpen, Images, LayoutGrid, ListTree, Palette, Sparkles, TriangleAlert } from 'lucide-react';
import { APP_MENUS, registerAppCommands } from '@/app/appCommands';
import { AssetsPanel } from '@/app/AssetsPanel';
import { useEffectiveLyrics } from '@/app/DerivedProvider';
import { clock, syncPlaying, usePlayback } from '@/app/playback';
import { Preview } from '@/app/Preview';
import { StylePanel } from '@/app/StylePanel';
import { packLabel } from '@/i18n/catalog';
import { useTranslation } from 'react-i18next';
import { formatTime } from '@/app/Transport';
import { OutputView } from '@/app/views/OutputView';
import { AgentPanel } from '@/app/views/AgentPanel';
import { OutlineView } from '@/app/views/OutlineView';
import { LibraryView } from '@/app/views/LibraryView';
import { EditorArea } from '@/app/EditorArea';
import { MobileShell } from '@/app/mobile/MobileShell';
import { useIsMobileLayout } from '@/app/mobile/uiMode';
import { AiPanel } from '@/app/views/AiPanel';
import { installAgent } from '@/agent/install';
import { ExportDialog } from '@/app/export/ExportDialog';
import { Wizard } from '@/app/wizard/Wizard';
import { ProblemsList, useProblems } from '@/app/views/ProblemsView';
import { Timeline } from '@/app/timeline/Timeline';
import { Inspector } from '@/app/inspector/Inspector';
import { StyleLibrary } from '@/app/library/StyleLibrary';
import { installKeybindings } from '@/app/workbench/commands';
import type { StatusItem } from '@/app/workbench/StatusBar';
import { Workbench } from '@/app/workbench/Workbench';
import { bootstrapProject } from '@/project/actions';
import { useSession } from '@/project/session';
import { useProjectStore } from '@/project/store';

registerAppCommands();

function useStatusItems(): StatusItem[] {
    const project = useProjectStore(state => state.project);
    const status = useSession(state => state.status);
    const progress = useSession(state => state.analysisProgress);
    const time = usePlayback(state => state.time);
    const { format } = useEffectiveLyrics();
    const problems = useProblems();
    const { t } = useTranslation('workbench');
    const items: StatusItem[] = [
        { id: 'project', side: 'left', content: project.name, command: 'project.open', title: t('status.openProject') },
        {
            id: 'problems',
            side: 'left',
            content: <><TriangleAlert size={12} /> {problems.length}</>,
            command: 'view.problems',
            title: t('views.problems'),
        },
    ];
    if (progress !== null) items.push({ id: 'analysis', side: 'left', content: t('status.analyzing', { percent: Math.round(progress * 100) }) });
    else if (status) items.push({ id: 'status', side: 'left', content: status });
    items.push(
        { id: 'time', side: 'right', content: formatTime(time) },
        { id: 'format', side: 'right', content: format ? format.toUpperCase() : t('status.instrumental'), command: 'view.assets' },
        { id: 'pack', side: 'right', content: project.direction.mode === 'mix' ? t('status.mix') : packLabel(project.direction.pack), command: 'view.look' },
        { id: 'aspect', side: 'right', content: project.aspect, command: 'view.look' },
        { id: 'seed', side: 'right', content: `seed ${project.seed}`, command: 'arrange.reseed', title: t('status.reseed') },
    );
    return items;
}

function ProblemsPanel() {
    return <ProblemsList problems={useProblems()} />;
}

export function App() {
    const audioUrl = useSession(state => state.audioUrl);
    const [ready, setReady] = useState(false);
    const problems = useProblems();
    const statusItems = useStatusItems();
    const { t } = useTranslation('workbench');

    useEffect(() => {
        void bootstrapProject().finally(() => {
            setReady(true);
            installAgent();
        });
        return installKeybindings();
    }, []);

    const mobile = useIsMobileLayout();
    const preview = ready ? <Preview /> : <div className="flex-1" />;

    return (
        <>
            {mobile ? <MobileShell preview={preview} /> : <Workbench
                menus={APP_MENUS}
                sideViews={[
                    { id: 'assets', title: t('views.assets'), icon: FolderOpen, component: () => <AssetsPanel /> },
                    { id: 'outline', title: t('views.outline'), icon: ListTree, component: () => <OutlineView /> },
                    { id: 'look', title: t('views.look'), icon: Palette, component: () => <StylePanel /> },
                    { id: 'library', title: t('views.library'), icon: LayoutGrid, component: () => <StyleLibrary /> },
                    { id: 'assetLibrary', title: t('views.assetLibrary'), icon: Images, component: () => <LibraryView /> },
                    { id: 'ai', title: t('views.ai'), icon: Sparkles, component: () => <AiPanel /> },
                    { id: 'agent', title: t('views.agent'), icon: Bot, component: () => <AgentPanel /> },
                ]}
                panelViews={[
                    { id: 'timeline', title: t('views.timeline'), component: () => <Timeline /> },
                    { id: 'problems', title: t('views.problems'), badge: () => problems.length || null, component: () => <ProblemsPanel /> },
                    { id: 'output', title: t('views.output'), component: () => <OutputView /> },
                ]}
                auxTitle={t('views.inspector')}
                auxBar={<Inspector />}
                editor={<EditorArea preview={preview} />}
                statusItems={statusItems}
            />}
            <ExportDialog />
            <Wizard />
            <audio
                ref={element => clock.attachAudio(element)}
                src={audioUrl ?? undefined}
                onPlay={syncPlaying}
                onPause={syncPlaying}
                onEnded={syncPlaying}
            />
        </>
    );
}

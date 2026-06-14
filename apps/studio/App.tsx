import { useEffect } from 'react';
import { useEditorSelector } from '@/state/editorContext';
import WelcomeScreen from '@/features/projects/WelcomeScreen';
import Editor from '@/features/editor/Editor';
import { GlobalTooltipLayer, PwaUpdateToast } from '@/components';
import { isBackgroundJobActive } from '@/state/editor/services/backgroundJobs';
import { useBackgroundJobExecutor } from '@/state/editor/services/useBackgroundJobExecutor';

function App() {
  useBackgroundJobExecutor();

  const projectId = useEditorSelector((s) => s.projectId);
  const hasActiveBackgroundJobs = useEditorSelector((s) =>
    s.backgroundJobs.some(isBackgroundJobActive),
  );
  const hasActiveDerivedJobs = useEditorSelector((s) =>
    s.aiChats.some((chat) => chat.status === 'generating'),
  );

  useEffect(() => {
    if (!hasActiveBackgroundJobs && !hasActiveDerivedJobs) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasActiveBackgroundJobs, hasActiveDerivedJobs]);

  return (
    <>
      {projectId ? <Editor /> : <WelcomeScreen />}
      <PwaUpdateToast />
      <GlobalTooltipLayer />
    </>
  );
}

export default App;

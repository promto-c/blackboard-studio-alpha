import React, { useEffect } from 'react';
import { useEditorSelector } from '@/state/editorContext';
import WelcomeScreen from '@/features/projects/WelcomeScreen';
import Editor from '@/features/editor/Editor';
import { BackgroundJobsMonitor, GlobalTooltipLayer } from '@/components';
import { isBackgroundJobActive } from '@/state/editor/services/backgroundJobs';
import { useResumeComfyBackgroundJobs } from '@/effects/comfy/useResumeComfyBackgroundJobs';

const App: React.FC = () => {
  useResumeComfyBackgroundJobs();

  const projectId = useEditorSelector((s) => s.projectId);
  const hasActiveBackgroundJobs = useEditorSelector((s) =>
    s.backgroundJobs.some(isBackgroundJobActive),
  );
  const hasActiveDerivedJobs = useEditorSelector(
    (s) =>
      s.aiChats.some((chat) => chat.status === 'generating') ||
      s.isAiCurrentlyGenerating ||
      s.aiGenerationQueue.length > 0,
  );

  useEffect(() => {
    if (!hasActiveBackgroundJobs && !hasActiveDerivedJobs) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasActiveBackgroundJobs, hasActiveDerivedJobs]);

  return (
    <>
      {projectId ? <Editor /> : <WelcomeScreen />}
      {!projectId && <BackgroundJobsMonitor />}
      <GlobalTooltipLayer />
    </>
  );
};

export default App;

import React, { useCallback, useEffect, useRef } from 'react';
import { Slider as BaseSlider, type SliderProps as BaseSliderProps } from '@blackboard/ui';
import { useOptionalEditorActions } from '@/state/editorContext';

export type SliderProps = BaseSliderProps;

const createInteractionId = () => `slider_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const Slider: React.FC<SliderProps> = ({ onInteractionStart, onInteractionEnd, ...props }) => {
  const actions = useOptionalEditorActions() as {
    beginHistoryInteraction?: (id: string) => void;
    endHistoryInteraction?: (id?: string) => void;
  } | null;
  const interactionIdRef = useRef<string | null>(null);

  const handleInteractionStart = useCallback(() => {
    if (!interactionIdRef.current && actions?.beginHistoryInteraction) {
      const interactionId = createInteractionId();
      interactionIdRef.current = interactionId;
      actions.beginHistoryInteraction(interactionId);
    }
    onInteractionStart?.();
  }, [actions, onInteractionStart]);

  const handleInteractionEnd = useCallback(() => {
    const interactionId = interactionIdRef.current;
    if (interactionId && actions?.endHistoryInteraction) {
      actions.endHistoryInteraction(interactionId);
      interactionIdRef.current = null;
    }
    onInteractionEnd?.();
  }, [actions, onInteractionEnd]);

  useEffect(
    () => () => {
      const interactionId = interactionIdRef.current;
      if (interactionId && actions?.endHistoryInteraction) {
        actions.endHistoryInteraction(interactionId);
        interactionIdRef.current = null;
      }
    },
    [actions],
  );

  return (
    <BaseSlider
      {...props}
      onInteractionStart={handleInteractionStart}
      onInteractionEnd={handleInteractionEnd}
    />
  );
};

export default Slider;

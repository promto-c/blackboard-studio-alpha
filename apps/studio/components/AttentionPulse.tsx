import React, { useEffect, useState } from 'react';

const ATTENTION_PULSE_CLASS =
  'bg-cyan-200/[0.025] shadow-[0_0_22px_rgba(103,232,249,0.12)] ring-1 ring-cyan-200/30';

interface AttentionPulseProps extends React.HTMLAttributes<HTMLDivElement> {
  activeKey?: string | null;
  durationMs?: number;
}

const AttentionPulse: React.FC<AttentionPulseProps> = ({
  activeKey,
  durationMs = 1000,
  className = '',
  children,
  ...props
}) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!activeKey) {
      return;
    }

    setIsVisible(true);
    const timeoutId = window.setTimeout(() => setIsVisible(false), durationMs);
    return () => window.clearTimeout(timeoutId);
  }, [activeKey, durationMs]);

  return (
    <div
      {...props}
      className={`transition duration-300 ${className} ${isVisible ? ATTENTION_PULSE_CLASS : ''}`}
    >
      {children}
    </div>
  );
};

export default AttentionPulse;

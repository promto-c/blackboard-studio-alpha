import React from 'react';

interface SubPanelHeaderProps {
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  sticky?: boolean;
}

const SubPanelHeader: React.FC<SubPanelHeaderProps> = ({ title, meta, actions, sticky = true }) => {
  return (
    <div
      className={`${sticky ? 'sticky top-0' : ''} z-10 flex min-h-0 items-center gap-2 border-b border-white/10 bg-gray-900/70 px-2 py-1.5 backdrop-blur-md`}
    >
      <h3 className="min-w-0 truncate text-xs font-medium text-gray-300">{title}</h3>
      {meta ? <div className="min-w-0 flex-1">{meta}</div> : null}
      {actions ? <div className="ml-auto flex flex-shrink-0 items-center">{actions}</div> : null}
    </div>
  );
};

export default SubPanelHeader;

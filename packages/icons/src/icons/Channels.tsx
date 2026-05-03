import React from 'react';
import { ViewerSettings } from '@blackboard/types';

interface ChannelsProps {
  channel: ViewerSettings['channels'];
  className?: string;
}

export const Channels: React.FC<ChannelsProps> = ({ channel, className }) => {
  const red = '#F87171';
  const green = '#4ADE80';
  const blue = '#60A5FA';
  const alpha = '#D4D4D4'; // gray-300 for Alpha channel
  const muted = '#525252'; // gray-600 for inactive channels

  const rFill = channel === 'RGB' ? red : channel === 'R' ? red : channel === 'A' ? alpha : muted;
  const gFill =
    channel === 'RGB' ? green : channel === 'G' ? green : channel === 'A' ? alpha : muted;
  const bFill = channel === 'RGB' ? blue : channel === 'B' ? blue : channel === 'A' ? alpha : muted;

  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24">
      <circle cx="14.5" cy="14.5" r="5" fill={bFill} fillOpacity="0.75" />
      <circle cx="9.5" cy="14.5" r="5" fill={gFill} fillOpacity="0.75" />
      <circle cx="12" cy="9.5" r="5" fill={rFill} fillOpacity="0.75" />
    </svg>
  );
};

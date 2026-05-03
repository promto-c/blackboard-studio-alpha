import React from 'react';
import { Reset } from '@blackboard/icons';
import IconButton, { type IconButtonProps } from './IconButton';

export type ResetIconButtonProps = Omit<IconButtonProps, 'icon'>;

const ResetIconButton: React.FC<ResetIconButtonProps> = ({ ...props }) => (
  <IconButton {...props} icon={Reset} />
);

export default ResetIconButton;

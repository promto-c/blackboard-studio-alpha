import React from 'react';
import { Reset } from '@blackboard/icons';
import IconButton, { type IconButtonProps } from './IconButton';

export type ResetIconButtonProps = Omit<IconButtonProps, 'icon'>;

function ResetIconButton({ tooltip, iconClassName, ...rest }: ResetIconButtonProps) {
  return <IconButton icon={Reset} tooltip={tooltip} iconClassName={iconClassName} {...rest} />;
}

export default ResetIconButton;

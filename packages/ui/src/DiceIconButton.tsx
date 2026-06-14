import React from 'react';
import { Dice } from '@blackboard/icons';
import IconButton, { type IconButtonProps } from './IconButton';

export type DiceIconButtonProps = Omit<IconButtonProps, 'icon'>;

function DiceIconButton({ tooltip, iconClassName, ...rest }: DiceIconButtonProps) {
  return <IconButton icon={Dice} tooltip={tooltip} iconClassName={iconClassName} {...rest} />;
}

export default DiceIconButton;

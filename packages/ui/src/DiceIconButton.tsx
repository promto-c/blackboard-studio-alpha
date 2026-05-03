import React from 'react';
import { Dice } from '@blackboard/icons';
import IconButton, { type IconButtonProps } from './IconButton';

export type DiceIconButtonProps = Omit<IconButtonProps, 'icon'>;

const DiceIconButton: React.FC<DiceIconButtonProps> = (props) => (
  <IconButton {...props} icon={Dice} />
);

export default DiceIconButton;

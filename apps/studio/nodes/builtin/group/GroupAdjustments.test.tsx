// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlurMethod, NodeType, type AnyNode, type GroupNode } from '@blackboard/types';
import GroupAdjustments from './GroupAdjustments';

const mocks = vi.hoisted(() => ({
  flows: {} as Record<string, unknown>,
  updateNode: vi.fn(),
  exposeGroupInput: vi.fn(),
  removeGroupInput: vi.fn(),
  updateGroupChildField: vi.fn(),
}));

vi.mock('@/state/editorContext', () => ({
  useEditorSelector: (
    selector: (state: { flows: Record<string, unknown>; currentFrame: number }) => unknown,
  ) => selector({ flows: mocks.flows, currentFrame: 12 }),
  useEditorActions: () => ({
    updateNode: mocks.updateNode,
    exposeGroupInput: mocks.exposeGroupInput,
    removeGroupInput: mocks.removeGroupInput,
    updateGroupChildField: mocks.updateGroupChildField,
  }),
}));

const blurNode = {
  id: 'blur-1',
  name: 'Soft Blur',
  type: NodeType.BLUR,
  enabled: true,
  blur: { radius: 5, method: BlurMethod.GAUSSIAN },
} as AnyNode;

const createGroupNode = ({
  externalInputs = [],
  exposedFields = [],
}: {
  externalInputs?: GroupNode['externalInputs'];
  exposedFields?: GroupNode['exposedFields'];
} = {}): GroupNode => ({
  id: 'group-1',
  name: 'Look Dev',
  type: NodeType.GROUP,
  enabled: true,
  childFlowId: 'group-flow',
  externalInputs,
  exposedFields,
});

describe('GroupAdjustments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.flows = {
      'group-flow': {
        id: 'group-flow',
        name: 'Look Dev',
        nodes: [blurNode],
        edges: [],
      },
    };
  });

  it('picks editable fields from any child node as explicit Group props', () => {
    render(<GroupAdjustments node={createGroupNode() as AnyNode} />);

    expect(
      screen.getByText('Choose Fields to show controls from nodes inside this group.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fields, 0 of 2 shown' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show Radius from Soft Blur' }));

    expect(mocks.updateNode).toHaveBeenCalledWith(
      'group-1',
      {
        exposedFields: [
          {
            id: 'field_blur-1_blur.radius',
            targetNodeId: 'blur-1',
            targetPath: 'blur.radius',
          },
        ],
      },
      true,
    );
  });

  it('renders selected child fields as controls and updates the nested node', () => {
    const node = createGroupNode({
      exposedFields: [
        {
          id: 'field-blur-radius',
          targetNodeId: 'blur-1',
          targetPath: 'blur.radius',
        },
      ],
    });
    render(<GroupAdjustments node={node as AnyNode} />);

    fireEvent.input(screen.getByRole('slider', { name: 'Radius' }), {
      target: { value: '12.5' },
    });

    expect(mocks.updateGroupChildField).toHaveBeenCalledWith(
      'group-1',
      'blur-1',
      'blur.radius',
      12.5,
      true,
      true,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Fields, 1 of 2 shown' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide Radius from Soft Blur' }));
    expect(mocks.updateNode).toHaveBeenCalledWith('group-1', { exposedFields: [] }, true);
  });

  it('keeps graph input ports in a compact, separate Ports section', () => {
    render(<GroupAdjustments node={createGroupNode() as AnyNode} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ports, 0 of 1 shown' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show Main from Soft Blur' }));

    expect(mocks.exposeGroupInput).toHaveBeenCalledWith(
      'group-1',
      'blur-1',
      'pipe',
      'Soft Blur Main',
    );
  });

  it('renames and removes selected graph ports without port cards', () => {
    const node = createGroupNode({
      externalInputs: [
        {
          id: 'input-blur-pipe',
          label: 'Source image',
          entryNodeId: 'input-1',
          targetNodeId: 'blur-1',
          targetPort: 'pipe',
        },
      ],
    });
    render(<GroupAdjustments node={node as AnyNode} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ports' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Port label for Soft Blur Main' }), {
      target: { value: 'Plate' },
    });
    expect(mocks.updateNode).toHaveBeenCalledWith(
      'group-1',
      {
        externalInputs: [expect.objectContaining({ id: 'input-blur-pipe', label: 'Plate' })],
      },
      false,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove port Source image' }));
    expect(mocks.removeGroupInput).toHaveBeenCalledWith('group-1', 'input-blur-pipe');
  });
});

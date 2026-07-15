import { useState } from 'react';
import { NodeType, type AnyNode, type GroupExternalInput, type GroupNode } from '@blackboard/types';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { getInputPorts } from '@/nodes/helpers';
import { getRootFlow } from '@/state/editor/flowModel';
import { usesPipelineInput } from '@/utils/nodePredicates';
import * as Icons from '@blackboard/icons';
import { TextInput } from '@blackboard/ui';

type Candidate = {
  key: string;
  targetNodeId: string;
  targetPort: string;
  label: string;
};

const getInputPortsForNode = (node: AnyNode) => {
  const declaredPorts = getInputPorts(node);
  if (!usesPipelineInput(node.type)) return declaredPorts;

  return [
    {
      name: 'pipe',
      label: 'Main',
      type: 'texture' as const,
      required: false,
      description: 'Primary pipeline input.',
    },
    ...declaredPorts.filter((port) => port.name !== 'pipe'),
  ];
};

function GroupAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as GroupNode;
  const flows = useEditorSelector((state) => state.flows);
  const { updateNode, exposeGroupInput, removeGroupInput } = useEditorActions();
  const externalInputs = node.externalInputs ?? [];
  const childFlow = getRootFlow(flows, node.childFlowId);
  const childNodes = childFlow?.nodes.filter((child) => child.type !== NodeType.OUTPUT) ?? [];
  const exposedKeys = new Set(
    externalInputs.map((input) => `${input.targetNodeId}:${input.targetPort}`),
  );
  const candidates: Candidate[] = childNodes.flatMap((child) =>
    child.type === NodeType.INPUT
      ? []
      : getInputPortsForNode(child)
          .filter((port) => !exposedKeys.has(`${child.id}:${port.name}`))
          .map((port) => ({
            key: `${child.id}:${port.name}`,
            targetNodeId: child.id,
            targetPort: port.name,
            label: `${child.name} ${port.label}`,
          })),
  );
  const [selectedCandidateKey, setSelectedCandidateKey] = useState(candidates[0]?.key ?? '');
  const selectedCandidate =
    candidates.find((candidate) => candidate.key === selectedCandidateKey) ?? candidates[0] ?? null;

  const updateExternalInputs = (nextInputs: GroupExternalInput[], withHistory = true) => {
    updateNode(
      node.id,
      { externalInputs: nextInputs.length > 0 ? nextInputs : undefined },
      withHistory,
    );
  };

  const addInput = () => {
    if (!selectedCandidate) return;
    exposeGroupInput(
      node.id,
      selectedCandidate.targetNodeId,
      selectedCandidate.targetPort,
      selectedCandidate.label,
    );
    setSelectedCandidateKey('');
  };

  const renameInput = (inputId: string, label: string) => {
    updateExternalInputs(
      externalInputs.map((input) => (input.id === inputId ? { ...input, label } : input)),
      false,
    );
  };

  const removeInput = (inputId: string) => {
    removeGroupInput(node.id, inputId);
  };

  return (
    <div className="space-y-3 text-xs text-gray-300">
      <div className="rounded-md border border-white/10 bg-gray-950/40 p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase text-gray-500">
          <Icons.Link className="h-3.5 w-3.5" />
          Group Inputs
        </div>
        <div className="space-y-2">
          {externalInputs.length > 0 ? (
            externalInputs.map((input) => {
              const targetNode =
                childNodes.find((candidate) => candidate.id === input.targetNodeId)?.name ??
                input.targetNodeId;
              return (
                <div key={input.id} className="rounded border border-white/10 bg-white/[0.03] p-2">
                  <div className="flex items-center gap-2">
                    <TextInput
                      value={input.label}
                      onValueChange={(value) => renameInput(input.id, value)}
                      className="min-w-0 flex-1 bg-gray-950 px-2 py-1 !min-h-0 focus:border-primary-400"
                    />
                    <button
                      type="button"
                      onClick={() => removeInput(input.id)}
                      className="flex h-7 w-7 items-center justify-center rounded border border-transparent text-gray-500 hover:border-red-400/30 hover:bg-red-500/10 hover:text-red-200"
                      title="Remove exposed input"
                    >
                      <Icons.XMark className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-1 truncate text-[10px] text-gray-500">
                    {targetNode} / {input.targetPort}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded border border-dashed border-white/10 px-2 py-3 text-center text-[11px] text-gray-500">
              No inputs exposed
            </div>
          )}
        </div>
      </div>

      {candidates.length > 0 ? (
        <div className="flex gap-2">
          <select
            value={selectedCandidate?.key ?? ''}
            onChange={(event) => setSelectedCandidateKey(event.currentTarget.value)}
            className="min-w-0 flex-1 rounded border border-white/10 bg-gray-950 px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-primary-400"
          >
            {candidates.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {candidate.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addInput}
            className="inline-flex items-center gap-1 rounded border border-primary-400/30 bg-primary-500/10 px-2 py-1.5 text-xs font-semibold text-primary-100 hover:bg-primary-500/20"
          >
            <Icons.Plus className="h-3.5 w-3.5" />
            Expose
          </button>
        </div>
      ) : childNodes.length > 0 ? (
        <div className="text-[11px] text-gray-500">All available child inputs are exposed.</div>
      ) : null}

      <div className="text-[11px] leading-4 text-gray-500">
        Exposed inputs appear as ports on the group node and can be connected from the parent flow.
      </div>
    </div>
  );
}

export default GroupAdjustments;

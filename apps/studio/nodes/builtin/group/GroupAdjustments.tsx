import { NodeType, type AnyNode, type GroupNode } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { getImmutable } from '@blackboard/renderer';
import { CollapsibleSection, IconButton, TextInput } from '@blackboard/ui';
import { ExplicitFieldPicker, NodeFieldControl, type ExplicitFieldPickerField } from '@/components';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { getInputPorts, getNodeExposableFields } from '@/nodes/helpers';
import type { NodeExposableFieldDescriptor } from '@/nodes/NodeDefinition';
import { getRootFlow } from '@/state/editor/flowModel';
import { usesPipelineInput } from '@/utils/nodePredicates';

type GroupPortCandidate = {
  key: string;
  targetNodeId: string;
  targetNodeLabel: string;
  targetPort: string;
  targetPortLabel: string;
  defaultLabel: string;
  description?: string;
};

type GroupPropCandidate = {
  key: string;
  targetNodeId: string;
  targetNodeLabel: string;
  field: NodeExposableFieldDescriptor;
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

const getPortKey = (targetNodeId: string, targetPort: string) => `${targetNodeId}:${targetPort}`;

const getPropKey = (targetNodeId: string, targetPath: string) => `${targetNodeId}:${targetPath}`;

const getGroupPortCandidates = (childNodes: AnyNode[]): GroupPortCandidate[] =>
  childNodes.flatMap((child) =>
    child.type === NodeType.INPUT
      ? []
      : getInputPortsForNode(child).map((port) => ({
          key: getPortKey(child.id, port.name),
          targetNodeId: child.id,
          targetNodeLabel: child.name,
          targetPort: port.name,
          targetPortLabel: port.label,
          defaultLabel: `${child.name} ${port.label}`,
          description: port.description,
        })),
  );

const getGroupPropCandidates = (childNodes: AnyNode[]): GroupPropCandidate[] =>
  childNodes.flatMap((child) =>
    child.type === NodeType.INPUT
      ? []
      : getNodeExposableFields(child).map((field) => ({
          key: getPropKey(child.id, field.path),
          targetNodeId: child.id,
          targetNodeLabel: child.name,
          field,
        })),
  );

function GroupAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as GroupNode;
  const flows = useEditorSelector((state) => state.flows);
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const { updateNode, exposeGroupInput, removeGroupInput, updateGroupChildField } =
    useEditorActions();
  const childFlow = getRootFlow(flows, node.childFlowId);
  const childNodes = childFlow?.nodes.filter((child) => child.type !== NodeType.OUTPUT) ?? [];
  const childNodesById = new Map(childNodes.map((child) => [child.id, child]));

  const exposedFields = node.exposedFields ?? [];
  const propCandidates = getGroupPropCandidates(childNodes);
  const propCandidatesByKey = new Map(
    propCandidates.map((candidate) => [candidate.key, candidate]),
  );
  const exposedFieldsByKey = new Map(
    exposedFields.map((field) => [getPropKey(field.targetNodeId, field.targetPath), field]),
  );
  const selectedPropIds = new Set(exposedFieldsByKey.keys());
  const propPickerFields: ExplicitFieldPickerField[] = propCandidates.map((candidate) => ({
    id: candidate.key,
    label: candidate.field.label,
    group: candidate.targetNodeLabel,
    detail: candidate.field.section,
    searchText: `${candidate.field.path} ${candidate.field.description ?? ''}`,
  }));
  const stalePropPickerFields: ExplicitFieldPickerField[] = exposedFields
    .filter((field) => !propCandidatesByKey.has(getPropKey(field.targetNodeId, field.targetPath)))
    .map((field) => ({
      id: getPropKey(field.targetNodeId, field.targetPath),
      label: field.targetPath,
      group: childNodesById.get(field.targetNodeId)?.name ?? 'Unavailable node',
      detail: 'Unavailable',
      searchText: `${field.targetNodeId} ${field.targetPath}`,
    }));

  const toggleProp = (fieldId: string) => {
    const selectedField = exposedFieldsByKey.get(fieldId);
    const nextFields = selectedField
      ? exposedFields.filter((field) => field.id !== selectedField.id)
      : (() => {
          const candidate = propCandidatesByKey.get(fieldId);
          if (!candidate) return exposedFields;
          return [
            ...exposedFields,
            {
              id: `field_${candidate.targetNodeId}_${candidate.field.path}`,
              targetNodeId: candidate.targetNodeId,
              targetPath: candidate.field.path,
            },
          ];
        })();

    if (nextFields !== exposedFields) updateNode(node.id, { exposedFields: nextFields }, true);
  };

  const externalInputs = node.externalInputs ?? [];
  const portCandidates = getGroupPortCandidates(childNodes);
  const portCandidatesByKey = new Map(
    portCandidates.map((candidate) => [candidate.key, candidate]),
  );
  const externalInputsByKey = new Map(
    externalInputs.map((input) => [getPortKey(input.targetNodeId, input.targetPort), input]),
  );
  const selectedPortIds = new Set(externalInputsByKey.keys());
  const portPickerFields: ExplicitFieldPickerField[] = portCandidates.map((candidate) => ({
    id: candidate.key,
    label: candidate.targetPortLabel,
    selectedLabel: externalInputsByKey.get(candidate.key)?.label,
    group: candidate.targetNodeLabel,
    detail: candidate.targetPort,
    searchText: `${candidate.defaultLabel} ${candidate.description ?? ''}`,
  }));
  const stalePortPickerFields: ExplicitFieldPickerField[] = externalInputs
    .filter((input) => !portCandidatesByKey.has(getPortKey(input.targetNodeId, input.targetPort)))
    .map((input) => ({
      id: getPortKey(input.targetNodeId, input.targetPort),
      label: input.targetPort,
      selectedLabel: input.label,
      group: childNodesById.get(input.targetNodeId)?.name ?? 'Unavailable node',
      detail: 'Unavailable',
      searchText: `${input.targetNodeId} ${input.targetPort} ${input.label}`,
    }));

  const togglePort = (fieldId: string) => {
    const exposedInput = externalInputsByKey.get(fieldId);
    if (exposedInput) {
      removeGroupInput(node.id, exposedInput.id);
      return;
    }

    const candidate = portCandidatesByKey.get(fieldId);
    if (!candidate) return;
    exposeGroupInput(node.id, candidate.targetNodeId, candidate.targetPort, candidate.defaultLabel);
  };

  const renameInput = (inputId: string, label: string) => {
    updateNode(
      node.id,
      {
        externalInputs: externalInputs.map((input) =>
          input.id === inputId ? { ...input, label } : input,
        ),
      },
      false,
    );
  };

  const emptyPropsMessage =
    childNodes.length === 0
      ? 'Add nodes inside this group to make their fields available.'
      : 'No editable fields are available inside this group.';
  const emptyPortsMessage =
    childNodes.length === 0
      ? 'Add nodes inside this group to make their ports available.'
      : 'No compatible input ports are available inside this group.';

  return (
    <>
      <CollapsibleSection
        title="Props"
        defaultOpen
        action={
          <ExplicitFieldPicker
            fields={[...propPickerFields, ...stalePropPickerFields]}
            selectedFieldIds={selectedPropIds}
            onToggleField={toggleProp}
            totalLabel={`${propCandidates.length} available`}
            emptyMessage={emptyPropsMessage}
          />
        }
      >
        {exposedFields.length > 0 ? (
          <div className="space-y-2">
            {Array.from(
              exposedFields.reduce((groups, exposedField) => {
                const targetNode = childNodesById.get(exposedField.targetNodeId);
                const candidate = propCandidatesByKey.get(
                  getPropKey(exposedField.targetNodeId, exposedField.targetPath),
                );
                if (!targetNode || !candidate) return groups;
                const existing = groups.get(targetNode.id);
                const item = { exposedField, targetNode, candidate };
                if (existing) existing.push(item);
                else groups.set(targetNode.id, [item]);
                return groups;
              }, new Map<string, Array<{ exposedField: (typeof exposedFields)[number]; targetNode: AnyNode; candidate: GroupPropCandidate }>>()),
            ).map(([targetNodeId, items]) => (
              <div key={targetNodeId} className="space-y-1">
                <div className="truncate text-[10px] font-medium uppercase tracking-wider text-gray-500">
                  {items[0].targetNode.name}
                </div>
                {items.map(({ exposedField, targetNode, candidate }) => (
                  <NodeFieldControl
                    key={exposedField.id}
                    field={candidate.field}
                    value={getImmutable(targetNode, exposedField.targetPath)}
                    currentFrame={currentFrame}
                    onValueChange={(value) =>
                      updateGroupChildField(
                        node.id,
                        targetNode.id,
                        exposedField.targetPath,
                        value,
                        candidate.field.animatable ?? false,
                        true,
                      )
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] leading-4 text-gray-500">
            Choose Fields to show controls from nodes inside this group.
          </p>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Ports"
        defaultOpen={false}
        action={
          <ExplicitFieldPicker
            fields={[...portPickerFields, ...stalePortPickerFields]}
            selectedFieldIds={selectedPortIds}
            onToggleField={togglePort}
            triggerLabel="Ports"
            searchPlaceholder="Search ports..."
            totalLabel={`${portCandidates.length} available`}
            emptyMessage={emptyPortsMessage}
          />
        }
      >
        {externalInputs.length > 0 ? (
          <div className="space-y-2">
            {externalInputs.map((input) => {
              const candidate = portCandidatesByKey.get(
                getPortKey(input.targetNodeId, input.targetPort),
              );
              const targetNodeLabel =
                candidate?.targetNodeLabel ??
                childNodesById.get(input.targetNodeId)?.name ??
                'Port';
              const targetPortLabel = candidate?.targetPortLabel ?? input.targetPort;

              return (
                <div key={input.id} className="flex min-w-0 items-end gap-1.5">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-gray-500">
                      <span className="truncate">{targetNodeLabel}</span>
                      <span aria-hidden="true">/</span>
                      <span className="truncate">{targetPortLabel}</span>
                    </div>
                    <TextInput
                      aria-label={`Port label for ${targetNodeLabel} ${targetPortLabel}`}
                      value={input.label}
                      onValueChange={(value) => renameInput(input.id, value)}
                    />
                  </div>
                  <IconButton
                    icon={Icons.Trash}
                    tooltip={`Remove port ${input.label || targetPortLabel}`}
                    onClick={() => removeGroupInput(node.id, input.id)}
                    className="mb-0.5 hover:bg-red-500/10 hover:text-red-200"
                  />
                </div>
              );
            })}
          </div>
        ) : null}
      </CollapsibleSection>
    </>
  );
}

export default GroupAdjustments;

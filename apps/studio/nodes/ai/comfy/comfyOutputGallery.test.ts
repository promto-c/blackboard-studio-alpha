import { describe, expect, it } from 'vitest';
import type { BackgroundJob } from '@/state/editor/services/backgroundJobs';
import { getActiveComfyOutputJobs, getPendingComfyOutputSlots } from './comfyOutputGallery';

const createJob = (id: string, updates: Partial<BackgroundJob> = {}): BackgroundJob => ({
  id,
  type: 'comfy',
  title: id,
  status: 'queued',
  startedAt: 1,
  updatedAt: 1,
  source: {
    nodeId: 'node-1',
    projectId: 'project-1',
    branchId: 'branch-1',
    comfyRegionId: 'region-1',
    runIndex: 1,
    runCount: 1,
    completedCount: 0,
  },
  ...updates,
});

describe('Comfy output gallery jobs', () => {
  it('selects active Comfy jobs for the current node, project, and branch', () => {
    const jobs = [
      createJob('later', { startedAt: 20 }),
      createJob('earlier', { startedAt: 10 }),
      createJob('other-node', { source: { nodeId: 'node-2' } }),
      createJob('finished', { status: 'complete' }),
      createJob('render', { type: 'render' }),
    ];

    expect(
      getActiveComfyOutputJobs({
        jobs,
        nodeId: 'node-1',
        projectId: 'project-1',
        branchId: 'branch-1',
      }).map((job) => job.id),
    ).toEqual(['earlier', 'later']);
  });

  it('creates queued and generating placeholders only for the requested region', () => {
    const jobs = [
      createJob('batch', {
        status: 'running',
        detail: 'Running batch',
        source: {
          nodeId: 'node-1',
          comfyRegionId: 'region-1',
          runIndex: 2,
          runCount: 3,
          completedCount: 1,
        },
      }),
      createJob('other-region', {
        source: {
          nodeId: 'node-1',
          comfyRegionId: 'region-2',
          runIndex: 1,
          runCount: 1,
          completedCount: 0,
        },
      }),
    ];

    expect(getPendingComfyOutputSlots(jobs, 'region-1')).toEqual([
      {
        id: 'batch:2',
        label: 'Generating',
        detail: 'Run 2/3',
        active: true,
      },
      {
        id: 'batch:3',
        label: 'Queued 3',
        detail: 'Run 3/3',
        active: false,
      },
    ]);
  });
});

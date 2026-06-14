import type { MatchMoveNode, MatchMoveTrack, MatchMoveTrackSample } from '@blackboard/types';
import type { ViewportOverlayProps } from '@/nodes/NodeDefinition';
import {
  getMatchMoveLatestSampleAtOrBefore,
  getMatchMoveSampleAtFrame,
} from '@/utils/matchMoveTracking';

const getErrorColor = (sample: MatchMoveTrackSample | null, fallback: string): string => {
  if (!sample || sample.error === undefined || !Number.isFinite(sample.error)) return fallback;
  if (sample.error <= 1.5) return '#22c55e';
  if (sample.error <= 4) return '#eab308';
  return '#f97316';
};

const getTrailPoints = (track: MatchMoveTrack, frame: number, trailLength: number): string => {
  const startFrame = frame - Math.max(1, trailLength);
  return track.samples
    .filter(
      (sample) => sample.status !== 'failed' && sample.frame >= startFrame && sample.frame <= frame,
    )
    .sort((a, b) => a.frame - b.frame)
    .map((sample) => `${sample.x},${sample.y}`)
    .join(' ');
};

function MatchMoveOverlay({ node: anyNode, frame, zoom }: ViewportOverlayProps) {
  const node = anyNode as MatchMoveNode;
  if (!node.display.showFeatures && !node.display.showTrails) return null;

  const radius = Math.max(2.2 / Math.max(zoom, 0.2), 1.2);
  const strokeWidth = Math.max(1.2 / Math.max(zoom, 0.2), 0.75);

  return (
    <g className="pointer-events-none">
      {node.display.showTrails
        ? node.tracks.map((track) => {
            const points = getTrailPoints(track, frame, node.display.trailLength);
            if (!points.includes(' ')) return null;
            return (
              <polyline
                key={`${track.id}-trail`}
                points={points}
                fill="none"
                stroke={track.color}
                strokeOpacity={0.38}
                strokeWidth={strokeWidth}
                vectorEffect="non-scaling-stroke"
              />
            );
          })
        : null}

      {node.display.showFeatures
        ? node.tracks.map((track) => {
            const currentSample =
              getMatchMoveSampleAtFrame(track, frame) ??
              getMatchMoveLatestSampleAtOrBefore(track, frame);
            if (!currentSample) return null;
            const color = node.display.colorByError
              ? getErrorColor(currentSample, track.color)
              : track.color;
            return (
              <g key={track.id}>
                <line
                  x1={currentSample.x - radius * 2}
                  y1={currentSample.y}
                  x2={currentSample.x + radius * 2}
                  y2={currentSample.y}
                  stroke={color}
                  strokeWidth={strokeWidth}
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={currentSample.x}
                  y1={currentSample.y - radius * 2}
                  x2={currentSample.x}
                  y2={currentSample.y + radius * 2}
                  stroke={color}
                  strokeWidth={strokeWidth}
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={currentSample.x}
                  cy={currentSample.y}
                  r={radius}
                  fill="rgba(15,23,42,0.55)"
                  stroke={color}
                  strokeWidth={strokeWidth}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })
        : null}
    </g>
  );
}

export default MatchMoveOverlay;

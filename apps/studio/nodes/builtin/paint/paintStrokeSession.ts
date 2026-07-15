import type { PaintStrokePath, Point } from '@blackboard/types';

export interface PaintStrokeSessionOptions {
  brushSize: number;
  stabilization: number;
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const smoothingFactor = (cutoff: number, elapsedSeconds: number): number => {
  const tau = 1 / (2 * Math.PI * Math.max(0.0001, cutoff));
  return 1 / (1 + tau / elapsedSeconds);
};

const mixPoint = (from: Point, to: Point, amount: number): Point => ({
  x: from.x + (to.x - from.x) * amount,
  y: from.y + (to.y - from.y) * amount,
});

const evaluateQuadratic = (start: Point, control: Point, end: Point, amount: number): Point => {
  const inverse = 1 - amount;
  return {
    x: inverse * inverse * start.x + 2 * inverse * amount * control.x + amount * amount * end.x,
    y: inverse * inverse * start.y + 2 * inverse * amount * control.y + amount * amount * end.y,
  };
};

const appendQuadratic = (
  points: Point[],
  start: Point,
  control: Point,
  end: Point,
  spacing: number,
): void => {
  const firstLeg = distance(start, control);
  const secondLeg = distance(control, end);
  if (firstLeg + secondLeg <= 0.05) return;

  // A quadratic's derivative can be twice either control-polygon leg. This
  // bound keeps sparse pointer gaps densely sampled without an unbounded cost.
  const resolutionLength = Math.max(firstLeg + secondLeg, 2 * firstLeg, 2 * secondLeg);
  const segmentCount = clamp(Math.ceil(resolutionLength / spacing), 1, 4096);
  for (let index = 1; index <= segmentCount; index += 1) {
    const point = evaluateQuadratic(start, control, end, index / segmentCount);
    const previous = points[points.length - 1];
    if (distance(previous, point) > 0.05) points.push(point);
  }
};

/**
 * Causal One Euro point filter. It suppresses low-speed hand jitter while
 * increasing its cutoff during fast motion to avoid a rubber-band feel.
 */
class AdaptivePointFilter {
  private raw: Point;
  private filtered: Point;
  private derivative: Point = { x: 0, y: 0 };
  private timestamp: number;
  private readonly strength: number;

  public constructor(point: Point, timestamp: number, stabilization: number) {
    this.raw = { ...point };
    this.filtered = { ...point };
    this.timestamp = timestamp;
    this.strength = clamp(stabilization, 0, 100) / 100;
  }

  public add(point: Point, timestamp: number): Point {
    if (this.strength <= 0) {
      this.raw = { ...point };
      this.filtered = { ...point };
      this.timestamp = timestamp;
      return { ...point };
    }

    const elapsedSeconds = clamp((timestamp - this.timestamp) / 1000 || 1 / 120, 1 / 240, 1 / 15);
    const rawDerivative = {
      x: (point.x - this.raw.x) / elapsedSeconds,
      y: (point.y - this.raw.y) / elapsedSeconds,
    };
    const derivativeAlpha = smoothingFactor(1, elapsedSeconds);
    this.derivative = mixPoint(this.derivative, rawDerivative, derivativeAlpha);

    const speed = Math.hypot(this.derivative.x, this.derivative.y);
    const minCutoff = 0.6 + 12 * (1 - this.strength) ** 2;
    const beta = 0.002 + 0.018 * (1 - this.strength);
    const valueAlpha = smoothingFactor(minCutoff + beta * speed, elapsedSeconds);
    this.filtered = mixPoint(this.filtered, point, valueAlpha);
    this.raw = { ...point };
    this.timestamp = timestamp;
    return { ...this.filtered };
  }
}

const createPath = (points: readonly Point[]): PaintStrokePath => ({
  // Freehand controls are already smoothed and distance-resampled. Keeping one
  // interpolation mode for the whole gesture prevents a growing stroke from
  // reshaping when it crosses a spline control-count threshold.
  mode: 'polyline',
  points: points.map((point) => ({ ...point })),
});

/**
 * Streaming stroke builder with an immutable finalized prefix. New input may
 * move the live tail, but it never re-simplifies or rewrites earlier controls.
 */
export class PaintStrokeSession {
  private readonly filter: AdaptivePointFilter;
  private readonly controlSpacing: number;
  private readonly fixedPoints: Point[];
  private acceptedControl: Point;
  private filteredCandidate: Point;
  private rawTail: Point;
  private finished = false;

  public constructor(point: Point, timestamp: number, options: PaintStrokeSessionOptions) {
    this.filter = new AdaptivePointFilter(point, timestamp, options.stabilization);
    this.controlSpacing = clamp(options.brushSize * 0.075, 0.75, 5);
    this.fixedPoints = [{ ...point }];
    this.acceptedControl = { ...point };
    this.filteredCandidate = { ...point };
    this.rawTail = { ...point };
  }

  public add(point: Point, timestamp: number): PaintStrokePath {
    if (this.finished) return this.getPath();
    this.rawTail = { ...point };
    this.filteredCandidate = this.filter.add(point, timestamp);
    this.commitCandidateIfReady();
    return this.getPath();
  }

  public finish(point?: Point, timestamp?: number): PaintStrokePath {
    if (point && !this.finished) this.add(point, timestamp ?? performance.now());
    if (this.finished) return this.getPath();

    // Resolve the short stabilizer tail to the actual pointer-up position. The
    // same finalized curve is immediately committed, so preview and result agree.
    const start = this.fixedPoints[this.fixedPoints.length - 1];
    appendQuadratic(
      this.fixedPoints,
      start,
      this.acceptedControl,
      this.rawTail,
      this.controlSpacing,
    );
    this.acceptedControl = { ...this.rawTail };
    this.filteredCandidate = { ...this.rawTail };
    this.finished = true;
    return this.getPath();
  }

  public getPath(): PaintStrokePath {
    const points = this.fixedPoints.map((point) => ({ ...point }));
    if (!this.finished) {
      const start = points[points.length - 1];
      appendQuadratic(
        points,
        start,
        this.acceptedControl,
        this.filteredCandidate,
        this.controlSpacing,
      );
    }
    return createPath(points);
  }

  private commitCandidateIfReady(): void {
    if (distance(this.acceptedControl, this.filteredCandidate) < this.controlSpacing) return;

    const start = this.fixedPoints[this.fixedPoints.length - 1];
    const end = mixPoint(this.acceptedControl, this.filteredCandidate, 0.5);
    appendQuadratic(this.fixedPoints, start, this.acceptedControl, end, this.controlSpacing);
    this.acceptedControl = { ...this.filteredCandidate };
  }
}

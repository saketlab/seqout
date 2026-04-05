/**
 * LOESS (locally weighted scatterplot smoothing) for time series.
 *
 * Uses a tricube kernel with local linear regression.
 * Bandwidth controls the fraction of data used at each point (0-1).
 */
export function loess(
  xs: number[],
  ys: number[],
  bandwidth: number = 0.15,
): number[] {
  const n = xs.length;
  if (n === 0) return [];
  if (n <= 2) return [...ys];

  const k = Math.max(2, Math.ceil(bandwidth * n));
  const result: number[] = [];

  for (let i = 0; i < n; i++) {
    const xi = xs[i];

    // Find k nearest neighbors by x-distance
    const distances = xs.map((x, j) => ({ j, d: Math.abs(x - xi) }));
    distances.sort((a, b) => a.d - b.d);
    const neighbors = distances.slice(0, k);
    const maxDist = neighbors[neighbors.length - 1].d || 1;

    // Tricube kernel weights
    let sumW = 0;
    let sumWx = 0;
    let sumWy = 0;
    let sumWxx = 0;
    let sumWxy = 0;

    for (const { j, d } of neighbors) {
      const u = d / (maxDist * 1.001); // avoid exact 1
      const w = (1 - u * u * u) ** 3; // tricube
      const xj = xs[j];
      const yj = ys[j];
      sumW += w;
      sumWx += w * xj;
      sumWy += w * yj;
      sumWxx += w * xj * xj;
      sumWxy += w * xj * yj;
    }

    // Weighted linear regression: y = a + b*x
    const denom = sumW * sumWxx - sumWx * sumWx;
    if (Math.abs(denom) < 1e-10) {
      result.push(sumWy / sumW); // fallback to weighted mean
    } else {
      const b = (sumW * sumWxy - sumWx * sumWy) / denom;
      const a = (sumWy - b * sumWx) / sumW;
      result.push(a + b * xi);
    }
  }

  return result;
}

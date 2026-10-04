const cos = Array.from({ length: 8 }, (_, u) =>
  Array.from({ length: 32 }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / 64)),
);
export function perceptualHash(rgb: Uint8Array): bigint {
  const gray = Array.from(
    { length: 1024 },
    (_, i) => 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2],
  );
  const horizontal = Array.from({ length: 32 }, (_, y) =>
    cos.map((row) => row.reduce((sum, c, x) => sum + c * gray[y * 32 + x], 0)),
  );
  const dct = cos.flatMap((row) =>
    Array.from({ length: 8 }, (_, u) => row.reduce((sum, c, y) => sum + c * horizontal[y][u], 0)),
  );
  const sorted = dct.slice(1).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return dct.reduce(
    (hash, value, i) => (value > median && i !== 0 ? hash | (1n << BigInt(i)) : hash),
    0n,
  );
}
export function transformSquare(rgb: Uint8Array, mode: number): Uint8Array {
  const out = new Uint8Array(rgb.length);
  const n = Math.sqrt(rgb.length / 3);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let a = x,
        b = y;
      if (mode & 1) {
        [a, b] = [b, a];
      }
      if (mode & 2) {
        a = n - 1 - a;
      }
      if (mode & 4) {
        b = n - 1 - b;
      }
      for (let c = 0; c < 3; c++) {
        out[(y * n + x) * 3 + c] = rgb[(b * n + a) * 3 + c];
      }
    }
  }
  return out;
}
export function hamming(a: bigint, b: bigint) {
  let n = a ^ b,
    count = 0;
  while (n) {
    n &= n - 1n;
    count++;
  }
  return count;
}
export function thumbnailSimilarity(a: Uint8Array, b: Uint8Array) {
  let sumA = 0,
    sumB = 0,
    sumAA = 0,
    sumBB = 0,
    sumAB = 0,
    mae = 0;
  for (let i = 0; i < a.length; i++) {
    sumA += a[i];
    sumB += b[i];
    sumAA += a[i] * a[i];
    sumBB += b[i] * b[i];
    sumAB += a[i] * b[i];
    mae += Math.abs(a[i] - b[i]);
  }
  const n = a.length;
  return {
    mae: mae / n,
    correlation:
      (n * sumAB - sumA * sumB) / Math.sqrt((n * sumAA - sumA * sumA) * (n * sumBB - sumB * sumB)),
  };
}

export interface PerceptualPair {
  first: number;
  second: number;
  bits: number;
  mode: number;
  mae: number;
  correlation: number;
}
/** Conservative full-frame copy detector; thumbnails never become ANN features. Crops may escape detection. */
export function findNearDuplicates(thumbs: readonly Uint8Array[]): PerceptualPair[] {
  const hashes = thumbs.map(perceptualHash),
    buckets = new Map<string, number[]>();
  hashes.forEach((hash, i) => {
    for (let band = 0; band < 8; band++) {
      const key = `${band}:${Number((hash >> BigInt(band * 8)) & 255n)}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(i);
      buckets.set(key, bucket);
    }
  });
  const pairs: PerceptualPair[] = [];
  for (let i = 0; i < thumbs.length; i++) {
    const accepted = new Set<number>();
    for (let mode = 0; mode < 8; mode++) {
      const thumb = mode ? transformSquare(thumbs[i], mode) : thumbs[i],
        hash = mode ? perceptualHash(thumb) : hashes[i],
        votes = new Map<number, number>();
      for (let band = 0; band < 8; band++) {
        for (const j of buckets.get(`${band}:${Number((hash >> BigInt(band * 8)) & 255n)}`) ?? []) {
          if (j < i && !accepted.has(j)) {
            votes.set(j, (votes.get(j) ?? 0) + 1);
          }
        }
      }
      for (const [j, votesCount] of votes) {
        if (votesCount < 4) {
          continue;
        }
        const bits = hamming(hash, hashes[j]);
        if (bits > 4) {
          continue;
        }
        const similarity = thumbnailSimilarity(thumb, thumbs[j]);
        if (
          similarity.mae > 10 ||
          !Number.isFinite(similarity.correlation) ||
          similarity.correlation < 0.985
        ) {
          continue;
        }
        accepted.add(j);
        pairs.push({ first: j, second: i, bits, mode, ...similarity });
      }
    }
  }
  return pairs;
}

import earcut from "earcut";

/**
 * Only strip the last point if the ring is actually closed (first == last).
 * This prevents accidentally dropping a valid vertex when the ring is not closed.
 */
const stripClosingPoint = (ring) => {
  if (!Array.isArray(ring) || ring.length < 2) return ring;

  const [x0, y0] = ring[0];
  const [xN, yN] = ring[ring.length - 1];

  // Use == to tolerate string/number mix from some datasets; you can change to === if desired.
  if (x0 == xN && y0 == yN) return ring.slice(0, -1);
  return ring;
};

/**
 * Signed area * 2 for a ring of [x,y] points.
 * > 0 : CCW, < 0 : CW
 */
const signedArea2 = (ring) => {
  let a = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % n];
    a += x0 * y1 - x1 * y0;
  }
  return a;
};

const isCCW = (ring) => signedArea2(ring) > 0;

/**
 * Ensure ring winding:
 * - wantCCW = true  => ring will be CCW
 * - wantCCW = false => ring will be CW
 */
const ensureWinding = (ring, wantCCW) => {
  if (ring.length < 3) return ring;
  const ccw = isCCW(ring);
  if (wantCCW ? ccw : !ccw) return ring;
  return ring.slice().reverse();
};

const polygonToEarcutInput = (polygonCoords) => {
  const data = [];
  const holes = [];
  let vertexCount = 0;

  for (let r = 0; r < polygonCoords.length; r++) {
    let ring = stripClosingPoint(polygonCoords[r]);

    // Skip invalid rings
    if (!Array.isArray(ring) || ring.length < 3) continue;

    // Enforce winding:
    // outer ring (r==0): CCW
    // holes (r>0): CW
    ring = ensureWinding(ring, r === 0);

    if (r > 0) holes.push(vertexCount);

    for (const [lon, lat] of ring) {
      data.push(lon, lat);
      vertexCount += 1;
    }
  }

  const indices = earcut(data, holes, 2);
  return { data, holes, indices };
};

export function geojsonToIndices(feature) {
  const geom = feature.geometry;
  if (!geom) throw new Error("No geometry");

  if (geom.type === "Polygon") {
    return [polygonToEarcutInput(geom.coordinates)];
  }
  if (geom.type === "MultiPolygon") {
    return geom.coordinates.map(polygonToEarcutInput);
  }

  throw new Error(`Unsupported geometry type: ${geom.type}`);
}

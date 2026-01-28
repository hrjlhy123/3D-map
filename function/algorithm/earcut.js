import earcut from 'earcut';

const stripClosingPoint = (ring) => {
    /* full version */
    // if (ring.length < 2) return ring
    // const [x0, y0] = ring[0]
    // const [xN, yN] = ring[ring.length - 1]
    // if (x0 == xN && y0 == yN) return ring.slice(0, -1)
    // return ring

    /* simple version */
    // if (ring.length < 2) {
    //     return ring
    // } else {
    //     return ring.slice(0, -1)
    // }

    /* simple version 2 */
    return ring.slice(0, -1)
}

const polygonToEarcutInput = (polygonCoords) => {
    const data = []
    const holes = []
    let vertexCount = 0

    for (let r = 0; r < polygonCoords.length; r++) {
        let ring = stripClosingPoint(polygonCoords[r])

        // if (ring.length < 3) continue

        if (r > 0) holes.push(vertexCount)

        for (const [lon, lat] of ring) {
            data.push(lon, lat)
            vertexCount += 1
        }
    }

    const indices = earcut(data, holes, 2)
    return { data, holes, indices }
}

export function geojsonToIndices(feature) {
    const geom = feature.geometry
    if (!geom) throw new Error(`No geometry`)
    if (geom.type == `Polygon`) {
        return [polygonToEarcutInput(geom.coordinates)]
    }
    if (geom.type == `MultiPolygon`) {
        return geom.coordinates.map(polygonToEarcutInput)
    }

    throw new Error(`Unsupported geometry type: ${geom.type}`)
}
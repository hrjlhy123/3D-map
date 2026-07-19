# WebGPU 3D GIS Project

The application renders Seattle building geometry using WebGPU.

## Spatial streaming

Building data is partitioned with H3 resolution 7 and stored as NDJSON.
The server sorts H3 cells from the viewport center outward and streams
features through WebSocket.

## Rendering

Buildings are tessellated using Earcut. Geometry is incrementally copied
into shared GPU buffers to avoid blocking the browser UI.

## Picking

The application uses an offscreen r32uint texture. Each building has a
numeric object ID that can be read back to determine the hovered building.

## Live Map Camera Context

The frontend may send live camera information to the RAG assistant.

- `camera.distanceMeters` is an application-specific camera distance.
- It is not a Google Maps, Mapbox, or Leaflet zoom level.
- The value is measured approximately in the WebGPU ENU scene coordinate system.
- Larger values indicate a farther, wider view.
- Smaller values indicate a closer, more detailed view.
- The supported application range is approximately 10 to 19,300.
- The initial camera distance is 1,400.
- When the distance falls below approximately 150, the application begins
  transitioning from the overhead view toward a lower-angle perspective.
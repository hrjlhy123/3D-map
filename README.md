# WebGPU-Based 3D GIS Real Estate Dashboard

![Demo GIF Placeholder](./img/demo.gif)

*Demo GIF showing the main interaction flow, layout switching, and dashboard updates will be here.*

A browser-based Geographic Information System (GIS) and dashboard prototype that combines large-scale building visualization, real-time streaming, WebGPU rendering, and synchronized analytical charts in a single interface.

This project demonstrates how a modern web stack can support interactive exploration of city-scale spatial data directly in the browser. The system uses a Node.js + WebSocket backend to stream tessellated geographic features, and a WebGPU-based frontend to render large numbers of buildings efficiently with a GPU-first pipeline. The current prototype focuses on Seattle-area OpenStreetMap building data and emphasizes architecture, rendering performance, streaming efficiency, and interactive visualization.

---

## Features

- WebGPU-based browser rendering pipeline for large-scale building visualization
- Real-time spatial streaming through WebSocket
- H3-based spatial partitioning for tile-level data delivery
- GeoJSON-to-triangle tessellation pipeline based on Earcut
- Hover picking using an offscreen `r32uint` interaction buffer
- Incremental deployment of geometry to GPU buffers to avoid UI stalls
- Integrated analytical dashboard with KPI cards and charts
- Two interface layouts:
  - **Layout 1**: dashboard-focused GIS view
  - **Layout 2**: AI chat feature page (**currently a static UI prototype**)
- Camera system supporting zoom, pan, pitch transition, reset, and **bird's-eye rotation**
- Center-first loading strategy for improved perceived responsiveness
- Lightweight environmental background system using video-driven sky interpolation

---

## Interface Overview

The application can switch between two page layouts:

### Layout 1: GIS Dashboard View
This is the main working view of the project.

It includes:
- a left-side analytical dashboard
- KPI cards with animated values
- top-right charts
- the main WebGPU building canvas
- runtime controls and progress feedback
- synchronized map and dashboard interaction

### Layout 2: AI Chat View
This layout is designed as an AI assistant interface for future expansion.

Current status:
- the AI chat page is **static only**
- it is used as a UI placeholder to demonstrate how an AI-assisted analysis panel could be integrated into the system
- no live OpenAI or backend chat workflow is connected in the current prototype

This separation helps demonstrate how the project can evolve from a pure GIS dashboard into a broader intelligent real-estate analysis platform.

---

## Demo Overview

### Left Dashboard Panel
- Project title and framing
- Four KPI cards:
  - Total Property Value
  - Average Property Price
  - Total Rental Revenue
  - Maintenance Cost
- Flip-card interaction to reveal full USD values

### Right Visualization Panel
- Line chart for monthly price trend
- Bar chart for listing categories
- Donut chart for property type distribution
- Main WebGPU canvas for building rendering
- Progress bar, start/stop/reset controls, and runtime logging
- Background sky/ground layer for visual context

---

## Technical Stack

### Frontend
- HTML5
- CSS3
- JavaScript (ES modules)
- WebGPU
- WGSL shaders
- Chart.js
- gl-matrix

### Backend
- Node.js
- `ws` WebSocket server
- `h3-js`
- `readline` streaming for NDJSON tiles
- Earcut-based polygon tessellation (`geojsonToIndices`)

### Data / GIS Tooling
- OpenStreetMap building data
- GeoJSON
- NDJSON tile storage
- H3 spatial indexing
- GDAL / ogr2ogr preprocessing workflow
- QGIS for inspection and validation

---

## How to Run

### 1. Start the local static server

From the project root directory:

```bash
npx http-server -c10
```

Example:

```powershell
PS D:\Work\WebGPU\3D map\project> npx http-server -c10
```

### 2. Run the preprocessing / streaming script

From the `function` directory:

```bash
node tessellate_geojson.js
```

Example:

```powershell
PS D:\Work\WebGPU\3D map\project\function> node tessellate_geojson.js
```

This script processes GeoJSON building data into the optimized streamed format used by the renderer.

### 3. Open the application

After the local server is running, open the browser and visit:

```text
http://127.0.0.1:8080
```

---

## Data Source

The building dataset used in this project is based on OpenStreetMap regional extracts.

Download source map data from Geofabrik:

```text
https://download.geofabrik.de/
```

Typical workflow:
1. Download a regional `.osm.pbf` extract
2. Convert or filter the data into GeoJSON
3. Preprocess and tessellate building polygons
4. Partition results into streamed tiles for runtime loading

---

## System Architecture

The project follows a layered architecture:

### 1. Data Layer
The source data is geographic building data derived from OpenStreetMap. The broader Washington dataset is filtered down to the target area, converted into render-friendly structures, tessellated, and partitioned into H3-indexed NDJSON tiles.

### 2. Streaming Layer
The backend is a local WebSocket server that accepts a `start` message containing a bbox, layer name, and H3 resolution. It computes intersecting H3 cells, sorts tiles by distance to the viewport center, and streams data tile by tile.

### 3. Rendering Layer
The browser requests a WebGPU adapter and device, allocates shared GPU buffers for vertices, indices, building IDs, camera data, and interaction state, then renders buildings through a batched indexed pipeline.

### 4. Interaction Layer
The user interacts through zoom, pan, hover selection, reset, and bird's-eye rotation. The map also drives dashboard updates so that analytics and spatial navigation remain synchronized.

---

## Data Pipeline

### Offline / Preprocessing Stage
1. Obtain OpenStreetMap regional extract from Geofabrik
2. Inspect layers in QGIS
3. Convert source layers into GeoJSON with GDAL / ogr2ogr
4. Filter the target region
5. Tessellate polygons into triangle indices
6. Partition data into H3 tiles
7. Store the result as NDJSON tile files

### Runtime / Server-Side Stage
At runtime, the WebSocket server:
- receives a bbox request from the client
- pads the bbox slightly
- computes intersecting H3 cells
- sorts tiles by distance to bbox center
- reads each NDJSON tile line by line
- tessellates features into GPU-friendly parts
- batches features into WebSocket payloads
- applies simple backpressure using `bufferedAmount`

---

## Frontend Rendering Pipeline

### WebGPU Initialization
On `DOMContentLoaded`, the client:
- validates `navigator.gpu`
- gets `canvas#building`
- creates a `webgpu` context
- requests an adapter
- requests a device with an elevated `maxBufferSize`
- configures the canvas context

### GPU Resources
The frontend creates shared resources for batched rendering, including:
- camera buffer
- transform buffer
- identity matrix buffer
- large vertex buffer
- large index buffer
- per-building ID buffer
- interaction uniform buffer
- hover readback buffer

### Geometry Representation
The frontend supports two geometry modes:
- **Flat mode**: polygon roofs rendered as 2D surfaces
- **Extrude mode**: buildings expanded into 3D volumes with walls and roof geometry

### Coordinate Conversion
To convert geographic coordinates into a local render space, the client transforms source lon/lat coordinates into a local East-North-Up coordinate frame before uploading them to the GPU.

---

## Streaming and GPU Deployment Strategy

The frontend does not upload every received feature directly into GPU buffers immediately. Instead, it:

1. receives batch messages over WebSocket
2. computes a center-distance metric for each feature
3. stores items in a pool
4. sorts near-to-far
5. incrementally deploys geometry to GPU memory under a time budget

This design helps avoid blocking the UI while still keeping loading responsive.

---

## Camera and Navigation

The camera controller supports:
- wheel-based zoom
- mouse drag panning
- zoom-dependent pitch transition
- bird's-eye / top-down rotation for overview navigation
- automatic FOV adjustment
- reset camera button
- zoom-at-mouse behavior in high-altitude mode

This gives the prototype a hybrid interaction style that combines GIS-style overview control with real-time 3D scene navigation.

---

## Hover Picking

The system supports hover selection by rendering a separate interaction pass into an `r32uint` texture. Each building vertex carries a building ID attribute, and a hover pass writes the selected object ID into a texture that is copied into a readback buffer for CPU-side inspection.

This GPU-based picking method works well for batched geometry because it avoids CPU-side per-object ray intersection.

---

## Dashboard and Analytical UI

### KPI Cards
The left panel contains four KPI cards. Each card has:
- a title
- a compact rolling number display
- a unit suffix (`K`, `M`, `B`, `T`, etc.)
- a flip-card back face showing the full USD value

### Charts
The top-right panel includes three charts:
- line chart for monthly price trend
- horizontal bar chart for listing categories
- donut chart for property type distribution

### Zoom-Driven Data Updates
The dashboard logic derives synthetic KPI and chart values from zoom level, making map navigation and analytics feel synchronized in the prototype.

---

## Runtime Controls

The map includes three UI controls:
- **Start**: sends a WebSocket `start` message with bbox, layer, and H3 resolution
- **Stop**: stops streaming and pauses rendering
- **Reset Camera**: restores the initial viewpoint

A bottom progress bar animates during startup, and a runtime log shows metrics such as FPS, frame delta time, approximate building count, received/pending/processed counts, and GPU buffer usage.

---

## Performance

Average resource usage during execution:

- **CPU (Intel Core i7-11800H): ~6%**
- **GPU (NVIDIA RTX 3080 Laptop GPU 90W): ~27%**
- **Memory: ~600 MB**

These numbers suggest that the prototype benefits from batched rendering, shared GPU buffers, incremental deployment, and visible-region tile selection while still leaving room for future extensions.

---

## Limitations

Current limitations include:
- the prototype is focused mainly on building geometry
- dashboard values are synthetic demo data rather than live market analytics
- the AI chat view is currently a static page only
- some pipeline constants remain hard-coded for experimentation
- the project is still a browser demo rather than a reusable library
- advanced spatial analysis and richer GIS layers are not yet integrated

---

## Future Improvements

Promising future directions include:
- advanced level-of-detail (LOD) strategies
- frustum culling
- GPU-driven instancing
- compute-shader-based spatial filtering
- additional GIS layers such as roads, land use, and demographics
- live AI-assisted geographic and real-estate analysis
- full integration of the current static AI chat page into an interactive assistant workflow

---

## Why This Project Matters

This prototype shows how browser-native GPU technology can move GIS applications beyond traditional lightweight map viewers. It combines structured spatial preprocessing, real-time streaming, WebGPU rendering, dashboard analytics, layout switching, and a planned AI interaction layer in a single interface.

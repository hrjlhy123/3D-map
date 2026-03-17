# WebGPU-Based 3D GIS Real Estate Dashboard

![Demo Placeholder](./img/demo.webp)

*Demo showing basic operations (zoom, pan, hover interaction, and dashboard updates) will be here.*

A browser-based Geographic Information System (GIS) and dashboard prototype that combines large-scale building visualization, real-time streaming, WebGPU rendering, and synchronized analytical charts in a single interface.

This project demonstrates how a modern web stack can support interactive exploration of city-scale spatial data directly in the browser. The system uses a Node.js + WebSocket backend to stream tessellated geographic features, and a WebGPU-based frontend to render large numbers of buildings efficiently with a GPU-first pipeline. The UI also includes KPI cards and charts that update together with the map to create an integrated real-estate-oriented exploration workflow.

The current prototype focuses on Seattle-area OpenStreetMap building data and emphasizes architecture, rendering performance, streaming efficiency, and interactive visualization.

---

## Features

- WebGPU-based browser rendering pipeline for geographic building visualization
- Integrated dashboard with KPI cards, line chart, bar chart, and donut chart
- Real-time streaming of spatial data through WebSocket
- H3-based spatial partitioning for tile-level data delivery
- GeoJSON-to-triangle tessellation pipeline based on Earcut
- Camera system supporting zoom, pan, pitch transition, and reset
- Distance-oriented visualization logic for large-scale exploration
- Hover picking using an offscreen `r32uint` interaction buffer
- Incremental deployment of geometry to GPU buffers to avoid UI stalls
- Center-first loading strategy for improved perceived responsiveness
- Lightweight environmental background system using video-driven sky interpolation

---

## Demo Overview

The application combines two major views in a single page:

### 1. Left dashboard panel
- Title and project framing
- Four animated KPI cards:
  - Total Property Value
  - Average Property Price
  - Total Rental Revenue
  - Maintenance Cost
- Flip-card interaction to reveal full USD values

### 2. Right visualization panel
- Three charts at the top:
  - Monthly Price Trend
  - Listings by Category
  - Property Type Distribution
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

This serves the frontend files locally.

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

Download source map data from:

**Geofabrik:** https://download.geofabrik.de/

A typical workflow is:

1. Download a regional `.osm.pbf` extract from Geofabrik
2. Convert or filter the data into GeoJSON
3. Preprocess and tessellate building polygons
4. Partition results into streamed tiles for runtime loading

---

## System Architecture

The project follows a layered architecture:

### 1. Data Layer
The source data is geographic building data derived from OpenStreetMap. The broader Washington dataset is filtered down to the area of interest, then converted into render-friendly structures.

The broader pipeline includes:
- bounding-box filtering
- polygon triangulation with Earcut
- conversion from GeoJSON to NDJSON for streaming efficiency
- H3-based spatial partitioning for incremental delivery

These steps reduce transfer size, avoid full-scene loading, and support scalable browser rendering.

### 2. Streaming Layer
The backend is a local WebSocket server that accepts a `start` message containing a bbox, a layer name, and an H3 resolution. It computes all H3 cells intersecting the requested region, sorts those tiles by distance to the viewport center, then streams the data tile by tile. The server reads NDJSON line by line and converts features into triangulated building parts before batching them for transmission.

### 3. Rendering Layer
The browser requests a WebGPU adapter and device, allocates large shared GPU buffers for vertices, indices, building IDs, camera data, and interaction state, and renders all buildings through a batched indexed pipeline.

The frontend code uses large merged buffers for:
- vertices
- indices
- building IDs
- transforms
- interaction state
- picking / hover feedback

### 4. Interaction Layer
The user interacts through zoom, pan, hover selection, and reset controls. The map also drives dashboard updates, creating a synchronized visual analytics workflow rather than separate map and chart tools.

---

## Data Pipeline

### Offline / Preprocessing Stage

A typical preprocessing workflow is:

1. Obtain OpenStreetMap regional extract from Geofabrik
2. Inspect shapefiles or converted layers in QGIS
3. Convert source layers into GeoJSON with GDAL / ogr2ogr
4. Filter the target region
5. Tessellate polygons into triangle indices
6. Partition data into H3 tiles
7. Store the result as NDJSON tile files

This preparation is essential for efficient browser delivery and large-scale rendering.

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

This design minimizes message overhead and improves perceived loading by prioritizing nearby tiles first.

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

This shared-buffer model is important because the architecture avoids per-building draw calls and instead grows a single aggregate geometry space over time.

### Geometry Representation
The frontend supports two geometry modes:
- **Flat mode**: polygon roofs rendered as 2D surfaces
- **Extrude mode**: buildings expanded into 3D volumes with walls and roof geometry

### Coordinate Conversion
To convert geographic coordinates into a local render space, the client transforms source lon/lat coordinates from geographic coordinates into a local East-North-Up coordinate frame before uploading them to the GPU.

---

## Streaming and Incremental GPU Deployment

The frontend does not immediately upload every received feature directly into GPU buffers. Instead, it:

1. receives batch messages over WebSocket
2. computes a simple center-distance metric for each feature
3. stores items in a pool
4. periodically flushes the pool into a pending queue after sorting near-to-far
5. incrementally deploys geometry to GPU memory under a time budget

This is a major design decision: instead of blocking the UI to process the entire visible dataset in one pass, the system amortizes deployment across frames.

---

## Rendering Strategy

The optimized pipeline achieves performance mainly through three techniques:

- merging building meshes into shared GPU buffers
- reducing rendering to a single `drawIndexed()` call per frame
- streaming data incrementally with a time-budget deployment strategy

This is the core reason the project remains scalable compared with naive per-building rendering.

---

## Camera and Navigation

The camera controller supports:
- wheel-based zoom
- mouse drag panning
- zoom-dependent pitch transition
- automatic FOV adjustment
- reset camera button
- zoom-at-mouse behavior in high-altitude mode

This gives the prototype a hybrid interaction style that feels partly like GIS zooming and partly like real-time 3D scene navigation.

---

## Hover Picking and Interaction Buffer

The system supports hover selection by rendering a separate interaction pass into an `r32uint` texture. Each building vertex carries a building ID attribute, and a hover pass writes the selected object ID into a texture that is copied into a readback buffer for CPU-side inspection.

This is a practical GPU picking approach for batched geometry because it avoids CPU-side per-object ray intersection.

---

## Dashboard and Analytical UI

The dashboard uses Chart.js and custom animated KPI cards.

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

### Observed Resource Usage

Average resource usage during execution:

- **CPU (Intel Core i7-11800H): ~10%**
- **GPU (NVIDIA RTX 3080 Laptop GPU 90W): ~20%**
- **Memory: ~2400 MB**

This indicates that the system efficiently utilizes GPU acceleration while maintaining relatively low CPU and memory overhead during large-scale geographic rendering.

### Interpretation

These numbers suggest several things:

1. **The frontend is not strongly CPU-bound during steady-state rendering.**  
   The combination of merged buffers, batched draw submission, and incremental deployment keeps main-thread work relatively low.

2. **The GPU is being used, but not saturated.**  
   Around 20% GPU utilization on the test machine implies there is still headroom for more advanced effects, more data layers, or denser scenes.

3. **Memory remains manageable for the tested scale.**  
   Around 2.4 GB total usage for a large-scale browser GIS demo is reasonable given the combination of browser overhead, GPU buffers, textures, streamed data, charts, and environment layers.

4. **The architecture scales better than a naive draw-call-heavy approach.**  
   The pipeline can render large numbers of buildings while maintaining interactive frame rates because geometry is merged and streamed incrementally.

### Key Performance Enablers

- Shared GPU vertex/index buffers
- Single `drawIndexed()` submission for merged scene geometry
- Incremental streaming and deployment instead of monolithic loading
- H3 tile selection limited to visible / near-visible regions
- Center-first prioritization to improve perceived responsiveness
- Lightweight WebSocket backpressure handling
- GPU-based picking rather than CPU geometry selection

---

## Limitations

Current limitations include:
- the prototype is focused primarily on building geometry
- synthetic dashboard values are zoom-driven demo data, not live market analytics
- some pipeline constants are still hard-coded for experimentation
- the system is currently browser-demo-oriented rather than packaged as a reusable library
- advanced spatial analysis and richer GIS layers are not yet integrated

---

## Future Improvements

Promising future directions include:
- advanced level-of-detail (LOD) strategies
- frustum culling
- GPU-driven instancing
- compute-shader-based spatial filtering
- additional layers such as roads, land use, environment, and demographics
- AI-assisted geographic and real-estate analysis
- broader analytical tooling integration

---

## Why This Project Matters

This prototype is a strong example of how browser-native GPU technology can move GIS applications beyond traditional lightweight map viewers. The project demonstrates that modern web graphics, structured spatial preprocessing, and incremental streaming can be combined into a responsive, integrated visual analytics workflow.

# GeoEstate AI — WebGPU-Based 3D GIS Real Estate Dashboard

![Demo GIF Placeholder](./img/demo.gif)

*A demo GIF showing WebGPU building streaming, dashboard interaction, building selection, and the RAG market assistant can be placed here.*

GeoEstate AI is a browser-based 3D geographic information system that combines city-scale building visualization, real-time WebSocket streaming, WebGPU rendering, synchronized real-estate analytics, and an OpenAI-powered retrieval-augmented generation (RAG) assistant in one interface.

The current prototype focuses on Seattle-area OpenStreetMap building data. Building geometry is organized into H3-indexed NDJSON tiles, tessellated with Earcut, streamed through WebSocket, incrementally uploaded to shared GPU buffers, and rendered in the browser with WebGPU.

The integrated assistant can analyze the current map state, retrieve project-specific knowledge from an OpenAI Vector Store, and optionally search current public web sources. It keeps live application data, synthetic dashboard data, locally retrieved documents, and public information clearly separated.

**Live Demo:** https://www.hrjlhy.com/3D-map/

---

## Features

### WebGPU GIS

- WebGPU-based browser rendering for large-scale building visualization
- Batched indexed rendering with shared vertex, index, and building-ID buffers
- Incremental GPU uploads under a per-frame time budget
- Flat and extruded building geometry modes
- East-North-Up coordinate conversion from geographic coordinates
- Center-first geometry deployment for improved perceived responsiveness
- WebGPU hover picking with an offscreen `r32uint` interaction texture
- Persistent selected-building state with separate hover and selected colors
- Camera controls for zoom, pan, pitch transition, reset, and orbit rotation
- Lightweight environmental background using video-driven sky interpolation

### Spatial Streaming

- Node.js WebSocket streaming server
- H3-based spatial partitioning
- Bounding-box-driven tile selection
- Near-to-far tile ordering
- NDJSON line-by-line reading
- Earcut polygon tessellation
- Batched WebSocket payloads
- Basic backpressure handling with `bufferedAmount`

### Dashboard

- Four animated KPI cards:
  - Total Property Value
  - Average Property Price
  - Total Rental Revenue
  - Maintenance Cost
- Line, horizontal bar, and donut charts
- Zoom-driven synthetic KPI updates
- Flip-card display for full values
- Dashboard initialization after the first building begins entering the GPU pipeline

### AI Market Assistant

- OpenAI Responses API integration
- Intelligent request routing
- Direct conversational responses without unnecessary retrieval
- Local RAG through OpenAI `file_search`
- Public research through OpenAI `web_search`
- Live selected-building and map context
- Markdown-formatted answers rendered safely in the browser
- Detailed non-streaming processing indicators
- Web-search timeout fallback
- Clear separation of verified, synthetic, retrieved, and unknown information

---

## Interface Overview

### GIS Dashboard View

The main interface includes:

- a left-side KPI dashboard
- analytical charts
- the main WebGPU building canvas
- progress and runtime statistics
- map controls
- selected-building interaction
- an expandable AI assistant

### AI Market Assistant

The assistant is connected to the live application rather than being a static mockup.

It can receive:

- the user’s current question
- attached KPI cards
- current map bounding box
- camera distance and pitch
- selected-building ID
- OpenStreetMap ID
- H3 cell
- approximate building coordinates
- application-rendered height
- available property metadata

The current implementation is intentionally single-request oriented. It does not yet maintain a persistent multi-turn conversation history after each request.

---

## RAG Architecture

The assistant uses an intent router before selecting data sources.

```text
User Question
      |
      v
OpenAI Intent Router
      |
      +-------------------+-------------------+
      |                   |                   |
      v                   v                   v
   DIRECT               LOCAL               FULL
      |                   |                   |
OpenAI answer      OpenAI file_search   OpenAI file_search
without tools      against Vector Store       |
                                              v
                                      OpenAI web_search
                                              |
                                              v
                                   Combined final response
```

### Direct Mode

Used for:

- greetings
- thanks
- casual conversation
- general questions
- questions answerable directly from the supplied live map context

No local knowledge-base search or public web search is performed.

Example:

```text
User: Hi
Result: Direct OpenAI response
```

### Local RAG Mode

Used when the question requires project-specific information, such as:

- WebGPU rendering behavior
- H3 streaming
- building picking
- dashboard definitions
- synthetic KPI methodology
- project architecture

The request uses OpenAI `file_search` against the configured Vector Store.

Example:

```text
User: How does the WebGPU picking system work?
Result: Local project-document retrieval and answer
```

### Full Research Mode

Used when the question requires real-world or current public information, such as:

- the surroundings of a selected building
- possible address or parcel context
- nearby places
- current public records
- online verification
- real-world market or geographic context

The pipeline performs:

1. local file retrieval
2. public web search
3. final source-aware synthesis

Example:

```text
User: What is around the selected building?
Result: Live map context + local RAG + public web research
```

---

## Information Boundaries

The assistant distinguishes four types of information.

### 1. Live Map Data

Provided directly by the running application, including:

- selected GPU building ID
- OSM ID
- coordinates
- H3 cell
- rendered height
- available property tags
- camera context

This data reflects the application state, not necessarily authoritative property records.

### 2. Local RAG Data

Retrieved from uploaded project documents, including:

- project documentation
- dashboard data dictionary
- synthetic Seattle demonstration dataset
- implementation notes

### 3. Public Web Data

Retrieved at request time from public sources when full research is required.

Preferred source categories include:

- OpenStreetMap
- Seattle government
- King County
- authoritative local organizations
- established mapping services

### 4. Synthetic Dashboard Data

Dashboard KPI values are generated for demonstration purposes. They must not be treated as:

- verified Seattle market statistics
- actual building-level values
- investment advice
- official parcel or assessor records

---

## RAG Response Structure

For full building research, the assistant returns four sections:

```text
LIVE MAP DATA

LOCAL RAG DATA

WEB SEARCH DATA

COMBINED INTERPRETATION
```

This structure makes it clear:

- what the application directly knows
- what was found in uploaded documents
- what public sources indicate
- what remains unknown

The assistant is instructed not to invent:

- addresses
- owners
- prices
- rental revenue
- maintenance costs
- property types
- neighborhoods
- parcel records

---

## Non-Streaming Processing UI

The chat frontend does not currently use Server-Sent Events or streaming responses.

While a request is in progress, it rotates through truthful high-level states such as:

```text
REQUEST ANALYSIS
Reading your question and live map context...

CONTEXT EVALUATION
Checking the selected building, camera, and dashboard context...

SOURCE SELECTION
Choosing the appropriate response path...

INFORMATION PROCESSING
Processing relevant context and supporting information...

RESPONSE SYNTHESIS
Preparing a source-aware response...
```

These messages do not falsely claim that a local or public search has occurred before the server selects the request mode.

---

## Markdown Rendering

Assistant responses are returned as Markdown.

The frontend uses:

- `marked` for Markdown parsing
- `DOMPurify` for sanitization

This supports:

- headings
- bold text
- lists
- links
- inline code
- code blocks

External links open in a new tab with `noopener noreferrer`.

---

## Technical Stack

### Frontend

- HTML5
- CSS3
- JavaScript ES modules
- WebGPU
- WGSL
- Chart.js
- gl-matrix
- marked
- DOMPurify

### GIS and Streaming Backend

- Node.js
- `ws`
- `h3-js`
- `readline`
- NDJSON
- Earcut-based tessellation

### RAG Backend

- Express
- CORS
- OpenAI Node SDK
- OpenAI Responses API
- OpenAI Vector Store
- OpenAI `file_search`
- OpenAI `web_search`
- structured JSON-schema routing

### GIS Tooling

- OpenStreetMap
- GeoJSON
- H3
- GDAL / ogr2ogr
- QGIS
- Geofabrik regional extracts

---

## System Architecture

### 1. Data Layer

OpenStreetMap building data is filtered to the target area, converted into render-friendly structures, and partitioned into H3-indexed NDJSON tiles.

### 2. Streaming Layer

The WebSocket server receives:

```json
{
  "type": "start",
  "bbox": {
    "minLon": 0,
    "minLat": 0,
    "maxLon": 0,
    "maxLat": 0
  },
  "layer": "gis_osm_buildings_a_free_1",
  "res": 7
}
```

The server:

- pads the bounding box
- calculates intersecting H3 cells
- sorts cells near-to-far
- reads NDJSON files line by line
- tessellates building features
- batches features
- streams them to the client

### 3. Rendering Layer

The browser:

- requests a WebGPU adapter and device
- creates shared GPU buffers
- receives building batches
- sorts buildings center-first
- converts geographic coordinates to local ENU coordinates
- extrudes geometry
- incrementally uploads data
- renders all loaded buildings with batched indexed drawing

### 4. Interaction Layer

The interaction pass renders building IDs to an `r32uint` texture.

The frontend reads the pixel below the cursor and maps the GPU ID to building context containing:

- OSM ID
- H3 cell
- coordinate center
- rendered height
- available property metadata

### 5. Analytics Layer

Dashboard cards and charts update according to the current zoom level. These values are synthetic and exist to demonstrate synchronized GIS analytics.

### 6. AI Layer

The Express RAG server receives the question plus dashboard and map context, routes the request, invokes only the required tools, and returns a Markdown answer.

---

## Data Pipeline

### Offline Preprocessing

1. Download an OpenStreetMap regional extract
2. Inspect data in QGIS
3. Convert or filter layers with GDAL / ogr2ogr
4. Export the target area
5. Partition features into H3 cells
6. Save features as NDJSON tile files

### Runtime Streaming

1. Browser computes the current map bounding box
2. Browser opens the WebSocket connection
3. Browser sends a `start` request
4. Server selects H3 tiles
5. Server streams batched building geometry
6. Frontend queues received features
7. Frontend uploads geometry within a frame budget
8. WebGPU renders the growing scene

### Runtime RAG

1. User submits a question
2. Frontend captures live map and dashboard context
3. OpenAI router selects `direct`, `local`, or `full`
4. Local documents are searched only when required
5. Public web sources are searched only when required
6. The final Markdown answer is sanitized and displayed

---

## Project Structure

A simplified structure:

```text
3D-map/
├── css/
│   ├── style.css
│   ├── dashboard.css
│   └── chat.css
├── data_hex_tiles/
├── function/
│   ├── map.js
│   ├── dashboard.js
│   ├── chat.js
│   ├── rag_server.js
│   ├── tessellate_geojson.js
│   └── algorithm/
│       └── earcut.js
├── img/
├── shader/
│   ├── vertex.wgsl
│   ├── fragment.wgsl
│   └── interaction.wgsl
├── vid/
├── chat.html
├── index.html
├── package.json
└── README.md
```

---

## Environment Configuration

Create a local `.env` file in the project root:

```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_VECTOR_STORE_ID=your_vector_store_id
OPENAI_MODEL=gpt-5.6
OPENAI_ROUTER_MODEL=gpt-5.6
OPENAI_TIMEOUT_MS=90000
RAG_PORT=3007
TILE_ROOT=./data_hex_tiles
PORT=8080
```

Never commit `.env`.

Recommended `.gitignore` entries:

```gitignore
.env
.env.*
!.env.example
```

An `.env.example` file may contain placeholder values only.

---

## OpenAI Vector Store

The local RAG pipeline expects an OpenAI Vector Store containing documents such as:

- project architecture documentation
- dashboard data dictionary
- synthetic demonstration dataset
- implementation notes

Set its ID in:

```env
OPENAI_VECTOR_STORE_ID=vs_example
```

The RAG server stops during startup when this value is missing.

---

## Installation

```bash
npm install
```

Key dependencies include:

```bash
npm install express cors openai ws h3-js marked dompurify
```

---

## Local Development

Use separate ports for the static frontend, WebSocket server, and RAG API.

### 1. Start the WebSocket GIS server

```bash
node function/tessellate_geojson.js
```

Default:

```text
ws://127.0.0.1:8080
```

### 2. Start the RAG API

```bash
npm run rag
```

Default:

```text
http://127.0.0.1:3007/api/rag
```

### 3. Start the static frontend

```bash
npx http-server -p 8081 -c-1
```

Open:

```text
http://127.0.0.1:8081
```

During local development, `chat.js` may use:

```js
const RAG_API_URL = "http://127.0.0.1:3007/api/rag";
```

For production, use an Nginx same-origin path:

```js
const RAG_API_URL = "/api/rag";
```

---

## Production Reverse Proxy

Example Nginx configuration:

```nginx
location /3D-map/ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
}

location /api/rag {
    proxy_pass http://127.0.0.1:3007/api/rag;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_read_timeout 120s;
}
```

The production WebSocket URL should resolve to:

```text
wss://your-domain.example/3D-map/ws
```

---

## Running Services in the Background

Example:

```bash
nohup node function/tessellate_geojson.js \
  > websocket.log 2>&1 &

nohup npm run rag \
  > rag.log 2>&1 &
```

Check ports:

```bash
sudo ss -ltnp | grep ':8080'
sudo ss -ltnp | grep ':3007'
```

View logs:

```bash
tail -f websocket.log
tail -f rag.log
```

For long-term deployment, a process manager such as PM2 or a `systemd` service is preferable.

---

## Camera and Navigation

The camera controller supports:

- wheel-based zoom
- mouse drag panning
- zoom-at-cursor behavior
- zoom-dependent pitch transition
- automatic field-of-view adjustment
- reset
- cinematic orbit mode

The interface transitions from a high-altitude GIS overview into a lower-angle 3D perspective as the user zooms closer.

---

## Building Selection

Each rendered building receives a GPU-side integer ID.

The application stores a mapping from that ID to contextual metadata:

```js
{
  buildingId,
  gpuId,
  osmId,
  h3Cell,
  longitude,
  latitude,
  propertyType,
  heightMeters,
  neighborhood
}
```

Hover and clicked selection use separate values in the interaction uniform:

```text
u32[0] = hovered building
u32[1] = selected building
```

The selected building is exposed through:

```js
window.selectedBuilding
```

and sent to the RAG API with every question.

---

## Performance

Example development-system resource usage:

- CPU: approximately 6%
- GPU: approximately 27%
- memory: approximately 600 MB

Actual results depend on:

- GPU
- browser
- viewport size
- number of loaded buildings
- geometry complexity
- WebSocket batch size
- GPU buffer allocation
- environmental rendering settings

---

## Limitations

Current limitations include:

- dashboard values are synthetic demonstration data
- selected-building height is application-rendered rather than surveyed
- public searches may not identify an exact building or parcel
- maintenance cost, ownership, valuation, and rental data are not inferred without evidence
- conversation history is not persistently maintained across requests
- some rendering and batching constants are experimental
- the project currently focuses mainly on buildings
- richer GIS layers are not yet integrated
- the application is a technical prototype rather than a production market-analysis platform
- outputs are not investment advice

---

## Future Improvements

- compact conversation-history support
- server-side sessions
- optional streamed RAG progress events
- parcel and assessor API integration
- additional authoritative GIS sources
- neighborhood and zoning layers
- road, transit, land-use, and demographic layers
- level of detail
- frustum and occlusion culling
- compute-shader spatial filtering
- GPU-driven indirect rendering
- real property-market datasets
- source cards and richer citations
- reusable WebGPU GIS modules

---

## Why This Project Matters

GeoEstate AI demonstrates how browser-native GPU rendering, spatial streaming, interactive analytics, and retrieval-augmented AI can work together in a single web application.

The project goes beyond a traditional map viewer by connecting:

- real-time map state
- GPU-rendered building geometry
- synthetic analytical dashboards
- project-specific document retrieval
- current public research
- source-aware AI explanations

It serves as a practical exploration of how WebGPU and RAG can support future browser-based GIS, digital-twin, and real-estate intelligence systems.

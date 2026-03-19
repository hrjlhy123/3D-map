const lineCtx = document.getElementById('lineChart');
const barCtx = document.getElementById('barChart');
const donutCtx = document.getElementById('donutChart');

Chart.defaults.color = '#666';
Chart.defaults.font.family = 'Arial, sans-serif';
Chart.defaults.plugins.legend.labels.usePointStyle = false;

const commonTitle = {
  display: true,
  color: '#5d5d5d',
  padding: {
    bottom: 14
  },
  font: {
    size: 15,
    weight: '600'
  }
};

const commonTooltip = {
  backgroundColor: 'rgba(50,60,70,0.92)',
  padding: 10,
  titleColor: '#fff',
  bodyColor: '#fff'
};

const commonGridColor = 'rgba(80,100,120,0.08)';

// Line Chart
const lineChart = new Chart(lineCtx, {
  type: 'line',
  data: {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [{
      label: 'Avg Property Price ($M)',
      data: [3.2, 3.9, 4.1, 4.8, 5.3, 5.9],
      borderColor: '#5aa9e6',
      backgroundColor: 'rgba(90,169,230,0.14)',
      tension: 0.35,
      fill: true,
      pointRadius: 3.5,
      pointHoverRadius: 4.5,
      pointBackgroundColor: '#5aa9e6',
      pointBorderWidth: 0,
      borderWidth: 2.5
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 0
    },
    elements: {
      point: {
        radius: 3.5,
        hoverRadius: 4.5,
        hitRadius: 6,
        borderWidth: 0,
        backgroundColor: '#5aa9e6',
        borderColor: '#5aa9e6'
      }
    },
    layout: {
      padding: 0
    },
    plugins: {
      legend: { display: false },
      title: {
        ...commonTitle,
        text: 'Monthly Price Trend'
      },
      tooltip: {
        ...commonTooltip,
        displayColors: false
      }
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: '#6c6c6c',
          font: {
            size: 11
          }
        }
      },
      y: {
        max: 10,
        beginAtZero: true,
        grid: {
          color: commonGridColor,
          drawBorder: false
        },
        border: { display: false },
        ticks: {
          color: '#6c6c6c',
          font: {
            size: 11
          }
        }
      }
    }
  }
});

// Bar Chart
const barChart = new Chart(barCtx, {
  type: 'bar',
  data: {
    labels: ['Residential', 'Commercial', 'Office', 'Industrial', 'Land'],
    datasets: [{
      label: 'Listings',
      data: [120, 85, 70, 55, 40],
      backgroundColor: '#69aee6',
      hoverBackgroundColor: '#5aa2dc',
      borderRadius: 999,
      borderSkipped: false,
      barThickness: 14,      // 比原来细
      maxBarThickness: 14
    }]
  },
  options: {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 0
    },
    layout: {
      padding: 0
    },
    plugins: {
      legend: { display: false },
      title: {
        ...commonTitle,
        text: 'Listings by Category'
      },
      tooltip: {
        ...commonTooltip,
        displayColors: false
      }
    },
    scales: {
      x: {
        beginAtZero: true,
        max: 150,
        grid: {
          color: commonGridColor,
          drawBorder: false
        },
        border: { display: false },
        ticks: {
          color: '#6c6c6c',
          font: {
            size: 11
          },
          stepSize: 50
        }
      },
      y: {
        grid: {
          display: false,
          drawBorder: false
        },
        border: { display: false },
        ticks: {
          color: '#666',
          font: {
            size: 11.5
          }
        }
      }
    }
  }
});

// Donut Chart
const donutChart = new Chart(donutCtx, {
  type: 'doughnut',
  data: {
    labels: ['Residential', 'Commercial', 'Office', 'Other'],
    datasets: [{
      data: [42, 23, 18, 17],
      backgroundColor: [
        '#5b9fda',
        '#78b3e6',
        '#99c7ee',
        '#bddcf5'
      ],
      borderWidth: 0,
      hoverOffset: 3,
      spacing: 1
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '68%',
    radius: '84%',
    animation: {
      duration: 0
    },
    layout: {
      padding: 0
    },
    plugins: {
      title: {
        ...commonTitle,
        text: 'Property Type Distribution'
      },
      legend: {
        position: 'right',
        align: 'center',
        labels: {
          color: '#666',
          boxWidth: 12,
          boxHeight: 12,
          padding: 10,       // 比原来紧
          font: {
            size: 11.5
          }
        }
      },
      tooltip: {
        ...commonTooltip
      }
    }
  }
});

// Chart thumbnail

let dashboardThumbMode = false;

function applyChartThumbMode(chart, mode, kind) {
  const isThumb = !!mode;
  const o = chart.options;

  // 通用
  if (o.plugins?.title) o.plugins.title.display = !isThumb;
  if (o.plugins?.tooltip) o.plugins.tooltip.enabled = !isThumb;

  if (kind === 'line') {
    if (o.scales?.x) {
      o.scales.x.display = !isThumb ? true : false;
    }
    if (o.scales?.y) {
      o.scales.y.display = !isThumb ? true : false;
    }

    o.scales.x.offset = isThumb ? true : false;

    const ds = chart.data.datasets[0];
    ds.pointRadius = isThumb ? 0 : 3.5;
    ds.pointHoverRadius = isThumb ? 0 : 4.5;
    ds.borderWidth = isThumb ? 2 : 2.5;
    ds.pointBorderWidth = 0;
    ds.pointHoverBorderWidth = 0;

    ds.tension = isThumb ? 0.25 : 0.35;
  }

  if (kind === 'bar') {
    if (o.scales?.x) {
      o.scales.x.display = !isThumb ? true : false;
    }
    if (o.scales?.y) {
      o.scales.y.display = !isThumb ? true : false;
    }

    const ds = chart.data.datasets[0];
    ds.barThickness = isThumb ? 6 : 14;
    ds.maxBarThickness = isThumb ? 6 : 14;
    ds.borderRadius = 999;
  }

  if (kind === 'donut') {
    if (o.plugins?.legend) o.plugins.legend.display = !isThumb;

    o.cutout = isThumb ? '72%' : '68%';
    o.radius = isThumb ? '92%' : '84%';
  }

  chart.update();
}

function setDashboardThumbMode(mode) {
  dashboardThumbMode = !!mode;

  document.body.classList.toggle('dashboard-thumb-mode', dashboardThumbMode);

  applyChartThumbMode(lineChart, dashboardThumbMode, 'line');
  applyChartThumbMode(barChart, dashboardThumbMode, 'bar');
  applyChartThumbMode(donutChart, dashboardThumbMode, 'donut');
}

function toggleDashboardThumbMode() {
  setDashboardThumbMode(!dashboardThumbMode);
}

const charts = document.querySelectorAll('.chart_box');
const panelLeftBottom = document.querySelector('.panel_left_bottom');
const panelRightTop = document.querySelector('.panel_right_top');
const kpi_card = document.querySelectorAll('.kpi_card');
const window_chat = document.querySelector(`#chat`);
const log = document.querySelector(`#log2`);

let movedToLeftBottom = false;

document.getElementById('chatBtn').addEventListener('click', () => {

  toggleDashboardThumbMode();
  toggleOrbitMode();
  let data
  if (movedToLeftBottom) {
    // Layout 1
    panelLeftBottom.classList.remove('layout_2');
    movedToLeftBottom = false;
    requestAnimationFrame(() => {
      for (let el of kpi_card) {
        el.classList.remove('ban_animate');
      }
    })
    for (let el of charts) {
      panelRightTop.appendChild(el);
      el.classList.remove('ban_animate');
    }
    data = buildDashboardDataFromZoom(zoom);
    window_chat.classList.remove('open');
    log.classList.remove(`layout_2`)
  } else {
    // Layout 2
    panelLeftBottom.classList.add('layout_2');
    movedToLeftBottom = true;
    for (let el of kpi_card) {
      el.classList.add('ban_animate');
      // console.log(el.className); 
    }
    for (let el of charts) {
      panelLeftBottom.appendChild(el);
      el.classList.add('ban_animate');
    }
    window_chat.classList.add('open');
    log.classList.add(`layout_2`)
  }
  updateKpiBackLabels(data ?? '');

  // 让 chart.js 重新计算尺寸
  requestAnimationFrame(() => {
    lineChart.resize();
    barChart.resize();
    donutChart.resize();
  });
});

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// 同一个 zoom 会得到稳定的“伪随机”，不会每帧乱闪
function hash01(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453123;
  return x - Math.floor(x);
}

const DASHBOARD_ZOOM_RANGE = {
  min: 20,
  max: 400
};

function zoomToT(zoom) {
  const t = (zoom - DASHBOARD_ZOOM_RANGE.min) /
    (DASHBOARD_ZOOM_RANGE.max - DASHBOARD_ZOOM_RANGE.min);
  return clamp(t, 0, 1);
}

function buildDashboardDataFromZoom(zoom) {
  const t = zoomToT(zoom);

  // ===== KPI：zoom 越大，数值越大 =====
  const base = Math.round(Math.PI * zoom * zoom);
  // console.log(base)
  const jitter = () => 1 + (Math.random() - 0.5) * 0.04;
  const kpi = {
    totalPropertyValue: base * 1200 * jitter(),
    averagePropertyPrice: (900000 - 250000 * Math.min(1, Math.max(0, (base - 7854) / (1170220467 - 7854)))) * jitter(),
    totalRentalRevenue: base * 260 * jitter(),
    maintenanceCost: base * 95 * jitter()
  };

  // ===== Line：平滑上升 + 少量假波动 =====
  const lineBase = lerp(2.4, 5.8, t);
  const lineData = Array.from({ length: 6 }, (_, i) => {
    const drift = i * lerp(0.22, 0.42, t);
    const wave = (hash01(zoom * 0.17 + i * 7.13) - 0.5) * 0.45;
    return +(lineBase + drift + wave).toFixed(2);
  });

  // ===== Bar：zoom 越大总体越高，但每类增幅不同 =====
  const barLabels = ['Residential', 'Commercial', 'Office', 'Industrial', 'Land'];
  const barData = [
    lerp(45, 130, t),
    lerp(30, 95, t),
    lerp(22, 72, t),
    lerp(18, 58, t),
    lerp(10, 38, t)
  ].map((v, i) => {
    const wobble = (hash01(zoom * 0.09 + i * 11.7) - 0.5) * 6;
    return Math.round(v + wobble);
  });

  // ===== Donut：占比也变化，但总和保持 100 =====
  let residential = lerp(30, 52, t);
  let commercial = lerp(28, 22, t);
  let office = lerp(22, 16, t);
  let other = 100 - residential - commercial - office;

  residential = +residential.toFixed(1);
  commercial = +commercial.toFixed(1);
  office = +office.toFixed(1);
  other = +(100 - residential - commercial - office).toFixed(1);

  return {
    t,
    kpi,
    lineData,
    barLabels,
    barData,
    donutData: [residential, commercial, office, other]
  };
}

// Dashboard

function padUnit(unit, width = 2) {
  return String(unit).padEnd(width, " ");
}

function formatCompactParts(value, options = {}) {
  const {
    decimals = 2,
    minIntegerDigits = 3,
    units = [
      { value: 1e33, suffix: "Dc" },
      { value: 1e30, suffix: "No" },
      { value: 1e27, suffix: "Oc" },
      { value: 1e24, suffix: "Sp" },
      { value: 1e21, suffix: "Sx" },
      { value: 1e18, suffix: "Qi" },
      { value: 1e15, suffix: "Qa" },
      { value: 1e12, suffix: "T" },
      { value: 1e9, suffix: "B" },
      { value: 1e6, suffix: "M" },
      { value: 1e3, suffix: "K" },
      { value: 1, suffix: "" }
    ]
  } = options;

  const abs = Math.abs(value);
  let scaled = value;
  let unit = "";

  for (const item of units) {
    if (abs >= item.value) {
      scaled = value / item.value;
      unit = item.suffix;
      break;
    }
  }

  const fixed = scaled.toFixed(decimals);
  let [intPart, decPart] = fixed.split(".");
  intPart = intPart.padStart(minIntegerDigits, "0");

  return {
    numberText: `${intPart}.${decPart}`, // 例如 004.82
    unitText: unit                       // 例如 M
  };
}

// 为了让随机更容易打到不同单位，不再用一个超大范围随机
function randomValueByBucket() {
  const buckets = [
    { min: 0, max: 999, label: "none" },
    { min: 1e3, max: 1e6 - 1, label: "K" },
    { min: 1e6, max: 1e9 - 1, label: "M" },
    { min: 1e9, max: 1e12 - 1, label: "B" },
    { min: 1e12, max: 1e15 - 1, label: "T" },
    { min: 1e15, max: 1e18 - 1, label: "Qa" },
    { min: 1e18, max: 1e21 - 1, label: "Qi" },
    { min: 1e21, max: 1e24 - 1, label: "Sx" },
    { min: 1e24, max: 1e27 - 1, label: "Sp" },
    { min: 1e27, max: 1e30 - 1, label: "Oc" },
    { min: 1e30, max: 1e33 - 1, label: "No" },
    { min: 1e33, max: 9.999e35, label: "Dc" }
  ];
  const bucket = buckets[Math.floor(Math.random() * buckets.length)];
  return Math.random() * (bucket.max - bucket.min) + bucket.min;
}

class RollingKPI {
  constructor(el, initialValue = "", options = {}) {
    this.el = el;
    this.options = {
      decimals: 2,
      minIntegerDigits: 3,
      unitWidth: 2,
      ...options
    };

    this.value = "";
    this.nodes = [];
    this.running = false;
    this.rafId = null;
    this.lastTs = 0;

    // this.setValue(initialValue || formatCompactParts(0, this.options), false);
    this.setValue(initialValue || "000.00", false);
  }

  createStatic(char, extraClass = "") {
    const node = document.createElement("span");
    node.className = `kpi_static ${extraClass}`.trim();
    node.textContent = char;
    node.dataset.type = "static";
    return node;
  }

  applyDigitPosition(state) {
    state.track.style.transform = `translateY(${-state.pos * 1.2}em)`;
  }

  buildFromString(str) {
    this.el.innerHTML = "";
    this.nodes = [];

    const chars = str.split("");

    chars.forEach((ch) => {
      let node;
      if (/\d/.test(ch)) {
        node = this.createDigit(ch);
      } else {
        node = this.createStatic(ch);
      }
      this.el.appendChild(node);
      this.nodes.push(node);
    });
  }

  ensureSameStructure(newValue) {
    if (!this.value) return false;
    const oldChars = this.value.split("");
    const newChars = newValue.split("");
    if (oldChars.length !== newChars.length) return false;

    for (let i = 0; i < oldChars.length; i++) {
      const a = /\d/.test(oldChars[i]);
      const b = /\d/.test(newChars[i]);
      if (a !== b) return false;
    }
    return true;
  }

  retargetDigit(state, newDigit) {
    // 先把位置拉回安全区，避免数值大了以后轨道跑飞
    if (state.pos > 70 || state.target > 75) {
      this.normalizeDigitState(state);
    }

    const currentCycle = Math.floor(state.pos / 10);
    let candidate = currentCycle * 10 + newDigit;

    while (candidate <= state.pos + 0.2) {
      candidate += 10;
    }

    // 至少滚一点，但不要无限加太多圈
    if (candidate - state.pos < 0.8) {
      candidate += 10;
    }

    state.target = candidate;
    state.digit = newDigit;
  }

  setValue(newValue, animate = true) {
    newValue = String(newValue);

    if (!this.ensureSameStructure(newValue)) {
      this.value = newValue;
      this.buildFromString(newValue);
      return;
    }

    const newChars = newValue.split("");

    newChars.forEach((ch, i) => {
      const node = this.nodes[i];
      if (node.dataset.type === "digit") {
        const state = node._state;
        const newDigit = Number(ch);
        if (animate) {
          this.retargetDigit(state, newDigit);
        } else {
          const cycle = Math.floor(state.pos / 10);
          state.pos = cycle * 10 + newDigit;
          state.target = state.pos;
          state.speed = 0;
          state.digit = newDigit;
          this.applyDigitPosition(state);
        }
      } else {
        node.textContent = ch;
      }
    });

    this.value = newValue;
    this.startLoop();
  }

  setNumber(num, animate = true, formatOptions = {}) {
    const parts = formatCompactParts(num, {
      ...this.options,
      ...formatOptions
    });
    this.setValue(parts.numberText, animate);
  }

  startLoop() {
    if (this.running) return;
    this.running = true;
    this.lastTs = performance.now();
    this.rafId = requestAnimationFrame(this.tick.bind(this));
  }

  stopLoop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  createDigit(char) {
    const wrapper = document.createElement("span");
    wrapper.className = "kpi_digit";
    wrapper.dataset.type = "digit";

    const track = document.createElement("span");
    track.className = "kpi_track";

    const repeats = 10; // 原来是 6
    const sequence = [];
    for (let r = 0; r < repeats; r++) {
      for (let i = 0; i < 10; i++) {
        sequence.push(i);
      }
    }

    sequence.forEach(n => {
      const item = document.createElement("span");
      item.textContent = n;
      track.appendChild(item);
    });

    wrapper.appendChild(track);

    const digit = Number(char);
    const startIndex = 40 + digit; // 也放更中间一点
    const state = {
      type: "digit",
      el: wrapper,
      track,
      pos: startIndex,
      target: startIndex,
      digit,
      speed: 0
    };

    wrapper._state = state;
    this.applyDigitPosition(state);

    return wrapper;
  }

  normalizeDigitState(state) {
    const SAFE_BASE = 40;
    const currentDigit = ((Math.round(state.pos) % 10) + 10) % 10;
    const targetDigit = ((Math.round(state.target) % 10) + 10) % 10;
    const frac = state.pos - Math.floor(state.pos);

    state.pos = SAFE_BASE + currentDigit + frac;
    state.target = SAFE_BASE + targetDigit;

    this.applyDigitPosition(state);
  }

  tick(ts) {
    const dt = Math.min((ts - this.lastTs) / 1000, 0.05);
    this.lastTs = ts;

    let anyMoving = false;

    for (const node of this.nodes) {
      if (node.dataset.type !== "digit") continue;
      const s = node._state;

      const dist = s.target - s.pos;

      if (Math.abs(dist) < 0.02) {
        s.pos = s.target;
        s.speed = 0;
        this.applyDigitPosition(s);
        continue;
      }

      anyMoving = true;

      const accel = Math.max(45, Math.min(120, Math.abs(dist) * 18));
      s.speed += accel * dt;

      const brakingDist = Math.max(0.6, s.speed * 0.18);
      if (dist < brakingDist) {
        s.speed *= Math.pow(0.08, dt);
      }

      const step = Math.min(dist, s.speed * dt);
      s.pos += step;

      if (s.pos > s.target) s.pos = s.target;

      if (s.pos > 75) {
        this.normalizeDigitState(s);
      }

      this.applyDigitPosition(s);
    }

    if (anyMoving) {
      this.rafId = requestAnimationFrame(this.tick.bind(this));
    } else {
      this.stopLoop();
    }
  }
}

const cards = [
  new RollingKPI(document.getElementById("kpi1")),
  new RollingKPI(document.getElementById("kpi2")),
  new RollingKPI(document.getElementById("kpi3")),
  new RollingKPI(document.getElementById("kpi4"))
];

const unitEls = [
  document.getElementById("kpi1Unit"),
  document.getElementById("kpi2Unit"),
  document.getElementById("kpi3Unit"),
  document.getElementById("kpi4Unit")
];

function initDashboardZero() {

  // KPI 全部为 0
  cards.forEach(card => {
    card.setNumber(0, false);   // false = 不要滚动动画
  });

  unitEls.forEach(el => {
    el.textContent = "";
  });

  // line
  lineChart.data.datasets[0].data = [0, 0, 0, 0, 0, 0];
  lineChart.update();

  // bar
  barChart.data.datasets[0].data = [0, 0, 0, 0, 0];
  barChart.update();

  // donut
  donutChart.data.datasets[0].data = [25, 25, 25, 25];
  donutChart.update();
}

initDashboardZero();

function formatUSD(value) {
  return "USD " + Math.round(value).toLocaleString("en-US");
}

function updateKpiBackLabels(data) {
  const isLayout2 = document.querySelector('.panel_left_bottom')?.classList.contains('layout_2');

  if (isLayout2) {
    document.getElementById("kpi1Real").textContent = "TPV";
    document.getElementById("kpi2Real").textContent = "Avg Price";
    document.getElementById("kpi3Real").textContent = "Rental Rev.";
    document.getElementById("kpi4Real").textContent = "Maint. Cost";
  } else {
    document.getElementById("kpi1Real").textContent = formatUSD(data.kpi.totalPropertyValue);
    document.getElementById("kpi2Real").textContent = formatUSD(data.kpi.averagePropertyPrice);
    document.getElementById("kpi3Real").textContent = formatUSD(data.kpi.totalRentalRevenue);
    document.getElementById("kpi4Real").textContent = formatUSD(data.kpi.maintenanceCost);
  }
}

let lastZoom = null;

window.updateDashboardFromZoom = (zoom, force = false) => {
  if (!force && lastZoom === zoom) return;
  lastZoom = zoom;

  const data = buildDashboardDataFromZoom(zoom);

  function setKPI(card, unitEl, value) {
    const parts = formatCompactParts(value);
    card.setValue(parts.numberText, true);
    unitEl.textContent = parts.unitText;
  }

  setKPI(cards[0], unitEls[0], data.kpi.totalPropertyValue);
  setKPI(cards[1], unitEls[1], data.kpi.averagePropertyPrice);
  setKPI(cards[2], unitEls[2], data.kpi.totalRentalRevenue);
  setKPI(cards[3], unitEls[3], data.kpi.maintenanceCost);

  updateKpiBackLabels(data);

  lineChart.data.datasets[0].data = data.lineData;
  lineChart.update();

  barChart.data.labels = data.barLabels;
  barChart.data.datasets[0].data = data.barData;
  barChart.update();

  donutChart.data.datasets[0].data = data.donutData;
  donutChart.update();
};
// updateDashboardFromZoom(DASHBOARD_ZOOM_RANGE.min, true);

// interaction

let fakeLiftInited = false;

function initFakeLiftGhost() {
  if (fakeLiftInited) return;
  fakeLiftInited = true;

  let ghost = null;
  let currentSource = null;
  let disabledIframes = [];
  let dragController = null;
  let dropRafId = 0;

  let offsetX = 0;
  let offsetY = 0;

  const ghostState = {
    x: 0,
    y: 0,
    rotX: 0,
    rotY: 0,
    scale: 1.02,
    opacity: 1,
    shadowX: 50,
    shadowY: 100,
    shadowBlur: 10,
    shadowAlpha: 0.3,
    highlightAlpha: 0.7,
    innerAlpha: 0.2
  };

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function disableIframesDuringDrag() {
    disabledIframes = [...document.querySelectorAll('iframe')];
    disabledIframes.forEach((frame) => {
      frame.dataset.prevPointerEvents = frame.style.pointerEvents || '';
      frame.style.pointerEvents = 'none';
    });
  }

  function restoreIframesAfterDrag() {
    disabledIframes.forEach((frame) => {
      frame.style.pointerEvents = frame.dataset.prevPointerEvents || '';
      delete frame.dataset.prevPointerEvents;
    });
    disabledIframes = [];
  }

  function copyCanvasBitmap(fromEl, toEl) {
    const srcCanvases = fromEl.querySelectorAll('canvas');
    const dstCanvases = toEl.querySelectorAll('canvas');

    srcCanvases.forEach((src, i) => {
      const dst = dstCanvases[i];
      if (!dst) return;

      dst.width = src.width;
      dst.height = src.height;
      dst.style.width = getComputedStyle(src).width;
      dst.style.height = getComputedStyle(src).height;

      const ctx = dst.getContext('2d');
      if (ctx) ctx.drawImage(src, 0, 0);
    });
  }

  function applyGhostState() {
    if (!ghost) return;

    ghost.style.setProperty('--ghost-x', `${ghostState.x}px`);
    ghost.style.setProperty('--ghost-y', `${ghostState.y}px`);
    ghost.style.setProperty('--ghost-scale', `${ghostState.scale}`);
    ghost.style.setProperty('--ghost-rot-x', `${ghostState.rotX}deg`);
    ghost.style.setProperty('--ghost-rot-y', `${ghostState.rotY}deg`);
    ghost.style.setProperty('--ghost-opacity', `${ghostState.opacity}`);

    ghost.style.setProperty('--shadow-x', `${ghostState.shadowX}px`);
    ghost.style.setProperty('--shadow-y', `${ghostState.shadowY}px`);
    ghost.style.setProperty('--shadow-blur', `${ghostState.shadowBlur}px`);
    ghost.style.setProperty('--shadow-alpha', `${ghostState.shadowAlpha}`);

    ghost.style.setProperty('--highlight-alpha', `${ghostState.highlightAlpha}`);
    ghost.style.setProperty('--inner-alpha', `${ghostState.innerAlpha}`);
  }

  function createGhost(el) {
    const rect = el.getBoundingClientRect();
    const clone = el.cloneNode(true);

    clone.classList.add('drag-ghost', 'is-dragging');
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;

    document.body.appendChild(clone);
    copyCanvasBitmap(el, clone);

    return clone;
  }

  function moveGhost(clientX, clientY) {
    if (!ghost) return;

    ghostState.x = clientX - offsetX;
    ghostState.y = clientY - offsetY;
    ghostState.rotY = clamp((clientX - window.innerWidth / 2) * 0.01, -6, 6);
    ghostState.rotX = clamp(-(clientY - window.innerHeight / 2) * 0.01, -6, 6);

    ghostState.scale = 1.02;
    ghostState.opacity = 1;

    ghostState.shadowX = 50;
    ghostState.shadowY = 100;
    ghostState.shadowBlur = 10;
    ghostState.shadowAlpha = 0.3;
    ghostState.highlightAlpha = 0.7;
    ghostState.innerAlpha = 0.2;

    applyGhostState();
  }

  function stopDragListeners() {
    dragController?.abort();
    dragController = null;
  }

  function cleanupNow() {
    stopDragListeners();

    if (dropRafId) {
      cancelAnimationFrame(dropRafId);
      dropRafId = 0;
    }

    if (ghost) {
      ghost.remove();
      ghost = null;
    }

    if (currentSource) {
      currentSource.classList.remove('fake-lift-source');
      currentSource = null;
    }

    restoreIframesAfterDrag();
  }

  function playDropAnimationAndCleanup() {
    if (!ghost) {
      cleanupNow();
      return;
    }

    ghost.classList.remove('is-dragging');
    ghost.classList.add('is-dropping');

    const startY = ghostState.y;
    const startScale = ghostState.scale;
    const startShadowX = ghostState.shadowX;
    const startShadowY = ghostState.shadowY;
    const startShadowBlur = ghostState.shadowBlur;
    const startShadowAlpha = ghostState.shadowAlpha;
    const startHighlightAlpha = ghostState.highlightAlpha;
    const startInnerAlpha = ghostState.innerAlpha;

    // 这里不是现实单位 9.8 m/s²，而是映射到屏幕的 px/s²
    // 这组数值对 60~80px 掉落看起来比较像“重力”
    const gravity = 1800;     // px / s²
    const maxDrop = 72;       // px
    const durationSec = Math.sqrt((2 * maxDrop) / gravity);
    const durationMs = durationSec * 1000;

    const startTime = performance.now();

    const step = (now) => {
      const elapsedSec = Math.min((now - startTime) / 1000, durationSec);
      const progress = elapsedSec / durationSec;

      // 自由落体：s = 1/2 g t²
      const dropY = Math.min(0.5 * gravity * elapsedSec * elapsedSec, maxDrop);

      // 阴影靠拢速度可以略快于物体本身
      const shadowT = 1 - Math.pow(1 - progress, 2.2);

      // 后半段快速淡出
      const fadeT = progress < 0.62 ? 0 : (progress - 0.62) / 0.38;

      ghostState.y = startY + dropY;
      ghostState.scale = lerp(startScale, 0.35, progress);
      ghostState.opacity = lerp(1, 0, fadeT);

      ghostState.shadowX = lerp(startShadowX, 0, shadowT);
      ghostState.shadowY = lerp(startShadowY, 30, shadowT);
      ghostState.shadowBlur = lerp(startShadowBlur, 0, shadowT);
      ghostState.shadowAlpha = lerp(startShadowAlpha, 0, shadowT);

      ghostState.highlightAlpha = lerp(startHighlightAlpha, 0.25, progress);
      ghostState.innerAlpha = lerp(startInnerAlpha, 0.05, progress);

      applyGhostState();

      if (progress < 1) {
        dropRafId = requestAnimationFrame(step);
      } else {
        dropRafId = 0;
        const ghostRect = ghost?.getBoundingClientRect();
        triggerDropIntoChatFrame(currentSource, ghostRect);
        cleanupNow();
      }
    };

    dropRafId = requestAnimationFrame(step);
  }

  document.addEventListener('pointerdown', (e) => {
    if (!panelLeftBottom.classList.contains('layout_2')) return;
    if (e.button !== 0) return;
    if (ghost) return;

    const el = e.target.closest('.kpi_card, .chart_box');
    if (!el || !panelLeftBottom.contains(el)) return;

    const rect = el.getBoundingClientRect();

    currentSource = el;
    currentSource.classList.add('fake-lift-source');

    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    ghost = createGhost(el);

    disableIframesDuringDrag();
    moveGhost(e.clientX, e.clientY);

    dragController = new AbortController();
    const { signal } = dragController;

    window.addEventListener(
      'pointermove',
      (evt) => {
        if (!ghost) return;
        moveGhost(evt.clientX, evt.clientY);
      },
      { signal }
    );

    window.addEventListener(
      'pointerup',
      () => {
        stopDragListeners();
        playDropAnimationAndCleanup();
      },
      { signal, once: true }
    );

    window.addEventListener(
      'pointercancel',
      () => {
        stopDragListeners();
        playDropAnimationAndCleanup();
      },
      { signal, once: true }
    );
  });
}

initFakeLiftGhost();

async function triggerDropIntoChatFrame(sourceEl, ghostRect) {
  if (!ghostRect) return;

  const chat = window_chat.querySelector('iframe');
  if (!chat) return;

  const splashFn = chat.contentWindow?.spawnSplashAt;
  const insertTokenFn = chat.contentWindow?.insertDashboardCardToken;
  const insertAttachmentFn = chat.contentWindow?.insertExternalAttachmentFile;

  const frameRect = chat.getBoundingClientRect();

  const impactX = ghostRect.left + ghostRect.width * 0.5;
  const impactY = ghostRect.top + ghostRect.height * 2;

  if (
    impactX < frameRect.left ||
    impactX > frameRect.right ||
    impactY < frameRect.top ||
    impactY > frameRect.bottom
  ) {
    return;
  }

  const localX = impactX - frameRect.left;
  const localY = impactY - frameRect.top;

  let remPx = 16;
  try {
    remPx = parseFloat(
      chat.contentWindow.getComputedStyle(
        chat.contentDocument.documentElement
      ).fontSize
    ) || 16;
  } catch (err) { }

  const safeMargin = remPx * 4;

  if (
    localX < safeMargin ||
    localX > frameRect.width - safeMargin ||
    localY < safeMargin ||
    localY > frameRect.height - safeMargin
  ) {
    return;
  }

  if (typeof splashFn === 'function') {
    splashFn({
      x: localX,
      y: localY,
      size: 640
    });
  }

  // ===== KPI 卡片 =====
  if (sourceEl?.classList.contains('kpi_card')) {
    const payload = buildDraggedDashboardPayload(sourceEl);

    if (payload && typeof insertTokenFn === 'function') {
      setTimeout(() => {
        insertTokenFn(payload);
      }, 120);
    }

    return;
  }

  // ===== Chart 盒子：转 PNG，按图片附件塞进 chat =====
  if (sourceEl?.classList.contains('chart_box')) {
    const file = await buildDraggedChartFile(sourceEl);

    if (file && typeof insertAttachmentFn === 'function') {
      setTimeout(() => {
        insertAttachmentFn(file);
      }, 120);
    }
  }
}

function buildDraggedDashboardPayload(el) {
  if (!el) return null;

  if (el.classList.contains('kpi_card')) {
    const allKpiCards = [...document.querySelectorAll('.kpi_card')];
    const index = allKpiCards.indexOf(el);
    if (index === -1) return null;

    const title = el.querySelector('.kpi_title')?.textContent?.trim() || 'KPI';
    const numberText = cards[index]?.value || '';
    const unitText = unitEls[index]?.textContent?.trim() || '';
    const value = `${numberText}${unitText ? ' ' + unitText : ''}`.trim();

    return {
      kind: 'kpi',
      title,
      value
    };
  }

  return null;
}

function buildDraggedChartFile(el) {
  return new Promise((resolve) => {
    if (!el || !el.classList.contains('chart_box')) {
      resolve(null);
      return;
    }

    const canvas = el.querySelector('canvas');
    if (!canvas) {
      resolve(null);
      return;
    }

    const filename = `${canvas.id || 'chart'}.png`;

    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(null);
        return;
      }

      const file = new File([blob], filename, {
        type: 'image/png'
      });

      resolve(file);
    }, 'image/png');
  });
}
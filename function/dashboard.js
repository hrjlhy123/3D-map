const lineCtx = document.getElementById('lineChart');
const barCtx = document.getElementById('barChart');

new Chart(lineCtx, {
  type: 'line',
  data: {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
    datasets: [{
      label: 'Revenue',
      data: [3.2, 4.1, 3.9, 5.0, 5.8],
      borderColor: '#5aa9e6',
      backgroundColor: 'rgba(90,169,230,0.15)',
      tension: 0.35,
      fill: false,
      pointRadius: 3
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false }
    },
    scales: {
      x: {
        grid: { display: false }
      },
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(0,0,0,0.06)' }
      }
    }
  }
});

new Chart(barCtx, {
  type: 'bar',
  data: {
    labels: ['A', 'B', 'C', 'D', 'E'],
    datasets: [{
      label: 'Buildings',
      data: [12, 19, 15, 22, 25],
      backgroundColor: '#6bb8f0',
      borderRadius: 8
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false }
    },
    scales: {
      x: {
        grid: { display: false }
      },
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(0,0,0,0.06)' }
      }
    }
  }
});
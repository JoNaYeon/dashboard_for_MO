Chart.register(ChartDataLabels);

const COLORS = {
  blue:   '#3182ce',
  green:  '#38a169',
  orange: '#dd6b20',
  purple: '#805ad5',
  teal:   '#319795',
  red:    '#e53e3e',
  pink:   '#d53f8c',
  yellow: '#d69e2e',
};
const PALETTE = Object.values(COLORS);

function fmt(n) { return n.toLocaleString('ko-KR'); }

// ── 레이아웃: 최초 1회만 렌더 ──────────────────────────────
function renderLayout() {
  document.getElementById('main-content').innerHTML = `
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">총 판독 건수</div>
      <div class="kpi-value"><span id="kpi-total">-</span><span class="kpi-unit">건</span></div>
      <div class="kpi-sub">전체 기간 누계</div>
    </div>
    <div class="kpi-card green">
      <div class="kpi-label">평균 판독 소요일</div>
      <div class="kpi-value"><span id="kpi-turnaround">-</span><span class="kpi-unit">일</span></div>
      <div class="kpi-sub">촬영일 → 판독 완료일</div>
    </div>
    <div class="kpi-card orange">
      <div class="kpi-label">일평균 판독 건수</div>
      <div class="kpi-value"><span id="kpi-daily">-</span><span class="kpi-unit">건/일</span></div>
      <div class="kpi-sub">판독일 기준 평균</div>
    </div>
    <div class="kpi-card purple">
      <div class="kpi-label">당일 판독률</div>
      <div class="kpi-value"><span id="kpi-samday">-</span><span class="kpi-unit">%</span></div>
      <div class="kpi-sub">촬영 당일 판독 완료</div>
    </div>
    <div class="kpi-card teal">
      <div class="kpi-label">최대 일일 판독</div>
      <div class="kpi-value"><span id="kpi-max">-</span><span class="kpi-unit">건</span></div>
      <div class="kpi-sub">단일 날짜 최다 판독</div>
    </div>
  </div>

  <div class="chart-row row-1col">
    <div class="chart-card">
      <h2>일별 판독 건수</h2>
      <p class="chart-desc">판독 완료일 기준 · 선택 기간</p>
      <canvas id="chart-daily" height="300"></canvas>
    </div>
  </div>

  <div class="chart-row row-2col-wide">
    <div class="chart-card">
      <h2>월별 판독 건수 & 일평균</h2>
      <p class="chart-desc">막대: 월 총 판독 건수 · 선: 판독일 기준 일평균</p>
      <canvas id="chart-monthly" height="140"></canvas>
    </div>
    <div class="chart-card">
      <h2>월별 평균 판독 소요일</h2>
      <p class="chart-desc">촬영일 → 판독 완료일 평균 소요일</p>
      <canvas id="chart-turnaround-monthly" height="140"></canvas>
    </div>
  </div>

  <div class="chart-row row-3col">
    <div class="chart-card">
      <h2>판독 소요일 분포</h2>
      <p class="chart-desc">초록: 당일 · 파랑: 1~2일 · 주황: 3일 이상</p>
      <canvas id="chart-turnaround-dist" height="300"></canvas>
    </div>
    <div class="chart-card">
      <h2>요일별 판독 건수</h2>
      <p class="chart-desc">주황/빨강: 주말</p>
      <canvas id="chart-weekday" height="300"></canvas>
    </div>
    <div class="chart-card">
      <h2>검사 유형별 분포</h2>
      <p class="chart-desc">검사명 기준 상위 8종</p>
      <canvas id="chart-exam" height="300"></canvas>
    </div>
  </div>

  <div class="chart-row row-age-gender">
    <div class="chart-card">
      <h2>연령대별 환자 분포</h2>
      <p class="chart-desc">판독 대상 환자 연령대</p>
      <canvas id="chart-age" height="300"></canvas>
    </div>
    <div class="chart-card">
      <h2>성별 분포</h2>
      <p class="chart-desc">판독 대상 환자 성별</p>
      <canvas id="chart-gender" height="120"></canvas>
    </div>
  </div>
  `;
}

// ── KPI 값만 업데이트 ────────────────────────────────────────
function updateKPI(kpi) {
  document.getElementById('doctor-name').textContent = `판독의: ${kpi.doctor}`;
  document.getElementById('period-label').innerHTML  = `분석 기간<br>${kpi.date_from} ~ ${kpi.date_to}`;
  document.getElementById('kpi-total').textContent     = fmt(kpi.total);
  document.getElementById('kpi-turnaround').textContent = kpi.avg_turnaround ?? '-';
  document.getElementById('kpi-daily').textContent     = kpi.avg_daily;
  document.getElementById('kpi-samday').textContent    = kpi.same_day_rate;
  document.getElementById('kpi-max').textContent       = fmt(kpi.max_daily);
}

// ── 차트 인스턴스 저장소 ─────────────────────────────────────
const charts = {};

function getOrCreate(id, config) {
  if (charts[id]) {
    return charts[id];
  }
  charts[id] = new Chart(document.getElementById(id).getContext('2d'), config);
  return charts[id];
}

function updateChart(id, newLabels, newDatasets) {
  const chart = charts[id];
  chart.data.labels = newLabels;
  newDatasets.forEach((ds, i) => {
    Object.assign(chart.data.datasets[i], ds);
  });
  chart.update();
}

// ── 최초 차트 생성 ────────────────────────────────────────────
function initCharts(data) {
  getOrCreate('chart-daily', {
    type: 'bar',
    data: {
      labels: data.daily.date,
      datasets: [{
        label: '일별 판독 건수',
        data: data.daily.count,
        backgroundColor: 'rgba(49,130,206,0.6)',
        borderColor: '#3182ce',
        borderWidth: 1,
        borderRadius: 2,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, datalabels: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: Math.min(data.daily.date.length, 31), font: { size: 11 } } },
        y: { beginAtZero: true, title: { display: true, text: '건수' } }
      }
    }
  });

  getOrCreate('chart-monthly', {
    type: 'bar',
    data: {
      labels: data.monthly.months,
      datasets: [
        {
          label: '월 판독 건수',
          data: data.monthly.counts,
          backgroundColor: 'rgba(56,161,105,0.65)',
          borderColor: '#38a169',
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'y',
        },
        {
          label: '일평균 판독 건수',
          data: data.monthly.daily_avg,
          type: 'line',
          borderColor: '#dd6b20',
          backgroundColor: 'rgba(221,107,32,0.15)',
          pointRadius: 5,
          pointBackgroundColor: '#dd6b20',
          tension: 0.3,
          fill: true,
          yAxisID: 'y2',
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top', labels: { font: { size: 12 } } },
        datalabels: { display: false }
      },
      scales: {
        y:  { beginAtZero: true, title: { display: true, text: '월 판독 건수 (건)' } },
        y2: { beginAtZero: true, position: 'right', title: { display: true, text: '일평균 (건/일)' },
              grid: { drawOnChartArea: false } }
      }
    }
  });

  getOrCreate('chart-turnaround-monthly', {
    type: 'line',
    data: {
      labels: data.monthly.months,
      datasets: [{
        label: '월평균 판독 소요일',
        data: data.monthly.avg_turnaround,
        borderColor: '#805ad5',
        backgroundColor: 'rgba(128,90,213,0.12)',
        pointRadius: 5,
        pointBackgroundColor: '#805ad5',
        tension: 0.3,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        datalabels: {
          display: true,
          anchor: 'end', align: 'top',
          font: { size: 11, weight: 'bold' },
          color: '#805ad5',
          formatter: v => v != null ? v + '일' : '',
        }
      },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: '소요일' }, max: 7 }
      }
    }
  });

  getOrCreate('chart-turnaround-dist', {
    type: 'bar',
    data: {
      labels: data.turnaround.days.map(d => d + '일'),
      datasets: [{
        label: '건수',
        data: data.turnaround.counts,
        backgroundColor: data.turnaround.days.map(d =>
          d === 0 ? 'rgba(56,161,105,0.8)' :
          d <= 2  ? 'rgba(49,130,206,0.75)' :
                    'rgba(221,107,32,0.75)'
        ),
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        datalabels: {
          display: true,
          anchor: 'end', align: 'top',
          font: { size: 11, weight: 'bold' },
          formatter: v => fmt(v),
        }
      },
      scales: {
        x: { title: { display: true, text: '판독 소요일' } },
        y: { beginAtZero: true, title: { display: true, text: '건수' } }
      }
    }
  });

  getOrCreate('chart-exam', {
    type: 'doughnut',
    data: {
      labels: data.exam_types.labels,
      datasets: [{
        data: data.exam_types.counts,
        backgroundColor: PALETTE.map(c => c + 'cc'),
        borderColor: 'white',
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 14 } },
        datalabels: {
          display: true,
          formatter: (value, ctx) => {
            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
            return (value / total * 100).toFixed(1) + '%';
          },
          color: 'white',
          font: { weight: 'bold', size: 11 },
        }
      }
    }
  });

  getOrCreate('chart-weekday', {
    type: 'bar',
    data: {
      labels: data.weekday.labels,
      datasets: [{
        label: '총 판독 건수',
        data: data.weekday.counts,
        backgroundColor: [
          '#3182ce','#3182ce','#3182ce','#3182ce','#3182ce','#dd6b20','#e53e3e'
        ].map(c => c + 'cc'),
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        datalabels: {
          display: true,
          anchor: 'end', align: 'top',
          font: { size: 11, weight: 'bold' },
          formatter: v => fmt(v),
        }
      },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: '건수' } }
      }
    }
  });

  getOrCreate('chart-gender', {
    type: 'doughnut',
    data: {
      labels: data.gender.labels.map(g => g === 'F' ? '여성' : '남성'),
      datasets: [{
        data: data.gender.counts,
        backgroundColor: ['rgba(213,63,140,0.75)', 'rgba(49,130,206,0.75)'],
        borderColor: 'white',
        borderWidth: 3,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom' },
        datalabels: {
          display: true,
          formatter: (value, ctx) => {
            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
            const label = ctx.chart.data.labels[ctx.dataIndex];
            return label + '\n' + (value / total * 100).toFixed(1) + '%';
          },
          color: 'white',
          font: { weight: 'bold', size: 12 },
          textAlign: 'center',
        }
      }
    }
  });

  getOrCreate('chart-age', {
    type: 'bar',
    data: {
      labels: data.age.labels,
      datasets: [{
        label: '환자 수',
        data: data.age.counts,
        backgroundColor: PALETTE.map(c => c + 'aa'),
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        datalabels: {
          display: true,
          anchor: 'end', align: 'top',
          font: { size: 11, weight: 'bold' },
          formatter: v => fmt(v),
        }
      },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: '환자 수' } }
      }
    }
  });
}

// ── 기존 차트 데이터 교체 ─────────────────────────────────────
function refreshCharts(data) {
  updateChart('chart-daily',
    data.daily.date,
    [{ data: data.daily.count }]
  );
  charts['chart-daily'].options.scales.x.ticks.maxTicksLimit = Math.min(data.daily.date.length, 31);

  updateChart('chart-monthly',
    data.monthly.months,
    [
      { data: data.monthly.counts },
      { data: data.monthly.daily_avg },
    ]
  );

  updateChart('chart-turnaround-monthly',
    data.monthly.months,
    [{ data: data.monthly.avg_turnaround }]
  );

  updateChart('chart-turnaround-dist',
    data.turnaround.days.map(d => d + '일'),
    [{
      data: data.turnaround.counts,
      backgroundColor: data.turnaround.days.map(d =>
        d === 0 ? 'rgba(56,161,105,0.8)' :
        d <= 2  ? 'rgba(49,130,206,0.75)' :
                  'rgba(221,107,32,0.75)'
      ),
    }]
  );

  updateChart('chart-exam',
    data.exam_types.labels,
    [{ data: data.exam_types.counts }]
  );

  updateChart('chart-weekday',
    data.weekday.labels,
    [{ data: data.weekday.counts }]
  );

  updateChart('chart-gender',
    data.gender.labels.map(g => g === 'F' ? '여성' : '남성'),
    [{ data: data.gender.counts }]
  );

  updateChart('chart-age',
    data.age.labels,
    [{ data: data.age.counts }]
  );
}

// ── 데이터 로드 & 렌더 ──────────────────────────────────────
let initialized = false;

async function loadDashboard() {
  const from   = document.getElementById('date-from').value;
  const to     = document.getElementById('date-to').value;
  const doctor = document.getElementById('doctor-select').value;

  const res = await fetch(`/api/data?from=${from}&to=${to}&doctor=${encodeURIComponent(doctor)}`);

  if (!res.ok) {
    const err = await res.json();
    document.getElementById('main-content').innerHTML =
      `<div class="loading" style="color:#e53e3e">${err.error || '오류가 발생했습니다.'}</div>`;
    initialized = false;
    return;
  }

  const data = await res.json();

  if (!initialized) {
    renderLayout();
    initCharts(data);
    initialized = true;
  } else {
    refreshCharts(data);
  }

  updateKPI(data.kpi);
}

// ── 진입점 ───────────────────────────────────────────────────
async function init() {
  const [rangeRes, doctorsRes] = await Promise.all([
    fetch('/api/range'),
    fetch('/api/doctors'),
  ]);
  const range   = await rangeRes.json();
  const doctors = await doctorsRes.json();

  document.getElementById('date-from').value = range.min;
  document.getElementById('date-to').value   = range.max;

  const sel = document.getElementById('doctor-select');
  sel.innerHTML = '<option value="전체">전체</option>' +
    doctors.map(d => `<option value="${d}">${d}</option>`).join('');

  await loadDashboard();

  document.getElementById('btn-apply').addEventListener('click', loadDashboard);
  document.getElementById('btn-reset').addEventListener('click', () => {
    document.getElementById('date-from').value = range.min;
    document.getElementById('date-to').value   = range.max;
    document.getElementById('doctor-select').value = '전체';
    loadDashboard();
  });
}

init().catch(err => {
  document.getElementById('main-content').innerHTML =
    `<div class="loading" style="color:#e53e3e">오류가 발생했습니다: ${err.message}</div>`;
});

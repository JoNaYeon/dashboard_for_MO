from flask import Flask, render_template, jsonify, request
import pandas as pd
from io import StringIO
import math
import time
import urllib.request

# ── Google Sheets 설정 ───────────────────────────────────────
SHEET_ID    = '1O2GnEQedjMaFrZk0qQHnMIt-zqmptGmLpT_ZI706KFc'
SHEET_URL   = f'https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv'
CACHE_TTL   = 300          # 5분 캐시
_cache: dict = {'df': None, 'ts': 0}


def _clean(v):
    """NaN/Inf → None (JSON null)으로 변환"""
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def _clean_list(lst):
    return [_clean(v) for v in lst]


app = Flask(__name__)


def _parse_date(series: pd.Series) -> pd.Series:
    """YYMMDD 또는 YYYYMMDD → datetime"""
    s = series.astype(str).str.split('.').str[0].str.strip()
    # 6자리(YYMMDD)면 '20' 붙여서 8자리로 변환
    s = s.where(s.str.len() == 8, '20' + s.str.zfill(6))
    return pd.to_datetime(s, format='%Y%m%d', errors='coerce')


def load_data() -> pd.DataFrame:
    now = time.time()
    if _cache['df'] is not None and now - _cache['ts'] < CACHE_TTL:
        return _cache['df'].copy()

    with urllib.request.urlopen(SHEET_URL, timeout=15) as r:
        raw = r.read()

    text = raw.decode('utf-8-sig')
    df = pd.read_csv(StringIO(text))
    df.columns = ['촬영일자', '촬영시간', '판독일자', '등록번호', '성별', '연령', '검사명', '판독의']

    df['촬영일자'] = _parse_date(df['촬영일자'])
    df['판독일자'] = _parse_date(df['판독일자'])

    # 연령: '071Y' → 71
    df['연령'] = pd.to_numeric(
        df['연령'].astype(str).str.replace(r'[^0-9]', '', regex=True),
        errors='coerce'
    )

    df = df.dropna(subset=['판독일자'])
    df['판독소요일'] = (df['판독일자'] - df['촬영일자']).dt.days
    df['판독_요일']  = df['판독일자'].dt.day_name()
    df['판독_월']    = df['판독일자'].dt.to_period('M').astype(str)

    _cache['df'] = df
    _cache['ts'] = now
    return df.copy()


@app.route('/api/range')
def get_range():
    df = load_data()
    return jsonify({
        'min': df['판독일자'].min().strftime('%Y-%m-%d'),
        'max': df['판독일자'].max().strftime('%Y-%m-%d'),
    })


@app.route('/api/doctors')
def get_doctors():
    df = load_data()
    doctors = sorted(df['판독의'].dropna().unique().tolist())
    return jsonify(doctors)


@app.route('/api/data')
def get_data():
    df = load_data()

    # 날짜 필터
    date_from = request.args.get('from')
    date_to   = request.args.get('to')
    if date_from:
        df = df[df['판독일자'] >= pd.to_datetime(date_from)]
    if date_to:
        df = df[df['판독일자'] <= pd.to_datetime(date_to)]

    doctor = request.args.get('doctor')
    if doctor and doctor != '전체':
        df = df[df['판독의'] == doctor]

    if df.empty:
        return jsonify({'error': '해당 조건에 데이터가 없습니다.'}), 404

    # KPI
    total = len(df)
    avg_turnaround = _clean(round(df['판독소요일'].dropna().mean(), 2))
    daily_counts = df.groupby('판독일자').size()
    avg_daily = round(daily_counts.mean(), 2)
    same_day_rate = round((df['판독소요일'] == 0).sum() / df['판독소요일'].notna().sum() * 100, 1)
    max_daily = int(daily_counts.max())

    # 일별 판독 건수 (최근 90일 + 전체)
    daily_df = daily_counts.reset_index()
    daily_df.columns = ['date', 'count']
    daily_df['date'] = daily_df['date'].dt.strftime('%Y-%m-%d')
    daily_series = daily_df.to_dict(orient='list')

    # 월별 통계
    monthly_df = df.groupby('판독_월').agg(
        판독건수=('판독의', 'count'),
        평균소요일=('판독소요일', 'mean'),
        일평균판독=('판독일자', lambda x: x.count() / x.dt.to_period('M').nunique())
    ).reset_index()
    monthly_df['평균소요일'] = monthly_df['평균소요일'].round(2)

    # 일별 평균 = 월 총 건수 / 해당 월 판독일 수
    monthly_working_days = df.groupby('판독_월')['판독일자'].nunique().reset_index()
    monthly_working_days.columns = ['판독_월', '판독일수']
    monthly_cnt = df.groupby('판독_월').size().reset_index(name='판독건수')
    monthly_merged = monthly_cnt.merge(monthly_working_days, on='판독_월')
    monthly_merged['일평균'] = (monthly_merged['판독건수'] / monthly_merged['판독일수']).round(2)
    monthly_avg_df = df.groupby('판독_월')['판독소요일'].mean().round(2).reset_index()
    monthly_avg_df.columns = ['판독_월', '평균소요일']
    monthly_final = monthly_merged.merge(monthly_avg_df, on='판독_월')

    monthly_series = {
        'months': monthly_final['판독_월'].tolist(),
        'counts': monthly_final['판독건수'].tolist(),
        'avg_turnaround': _clean_list(monthly_final['평균소요일'].tolist()),
        'daily_avg': _clean_list(monthly_final['일평균'].tolist()),
        'working_days': monthly_final['판독일수'].tolist(),
    }

    # 판독 소요일 분포
    turnaround_dist = df['판독소요일'].dropna().astype(int).value_counts().sort_index()
    turnaround_series = {
        'days': turnaround_dist.index.tolist(),
        'counts': turnaround_dist.values.tolist(),
    }

    # 검사 유형별 분포
    exam_counts = df['검사명'].value_counts()
    # 상위 8개 + 기타
    top8 = exam_counts.head(8)
    others = exam_counts.iloc[8:].sum()
    exam_labels = top8.index.tolist()
    exam_values = top8.values.tolist()
    if others > 0:
        exam_labels.append('기타')
        exam_values.append(int(others))

    # 요일별 판독 패턴
    weekday_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    weekday_labels = ['월', '화', '수', '목', '금', '토', '일']
    weekday_counts = df['판독_요일'].value_counts()
    weekday_series = {
        'labels': weekday_labels,
        'counts': [int(weekday_counts.get(d, 0)) for d in weekday_order],
    }

    # 성별 분포
    gender_counts = df['성별'].value_counts()
    gender_series = {
        'labels': gender_counts.index.tolist(),
        'counts': gender_counts.values.tolist(),
    }

    # 연령대 분포
    df['연령대'] = (df['연령'] // 10 * 10).astype(str) + '대'
    age_counts = df['연령대'].value_counts().sort_index()
    age_series = {
        'labels': age_counts.index.tolist(),
        'counts': age_counts.values.tolist(),
    }

    return jsonify({
        'kpi': {
            'total': total,
            'avg_turnaround': avg_turnaround,
            'avg_daily': avg_daily,
            'same_day_rate': same_day_rate,
            'max_daily': max_daily,
            'doctor': doctor if (doctor and doctor != '전체') else '전체',
            'date_from': df['판독일자'].min().strftime('%Y-%m-%d'),
            'date_to': df['판독일자'].max().strftime('%Y-%m-%d'),
        },
        'daily': daily_series,
        'monthly': monthly_series,
        'turnaround': turnaround_series,
        'exam_types': {'labels': exam_labels, 'counts': exam_values},
        'weekday': weekday_series,
        'gender': gender_series,
        'age': age_series,
    })


@app.route('/')
def index():
    return render_template('index.html')


if __name__ == '__main__':
    # app.run(debug=True, port=5000)
    app.run(host='192.168.20.50', port=5000, debug=False)

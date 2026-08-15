import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { api } from '../api.js';
import { DOMAINS } from '../domains.js';

const AXIS = '#8b93a7';
const SPLIT = '#e6e9f2';

function useChart(option) {
  const ref = useRef(null);
  const inst = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    inst.current = echarts.init(ref.current);
    const onResize = () => inst.current?.resize();
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); inst.current?.dispose(); inst.current = null; };
  }, []);
  useEffect(() => {
    if (inst.current && option) inst.current.setOption(option, true);
  }, [option]);
  return ref;
}

function domainLabel(id) {
  return DOMAINS.find((d) => d.id === id)?.name || (id === 'jd' ? '职位需求' : id);
}

export default function AnalyticsView() {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState('');
  const [focusDomain, setFocusDomain] = useState('all'); // 雷达图领域筛选

  useEffect(() => {
    api.stats().then(setStats).catch((e) => setErr(e.message));
  }, []);

  const timeOption = useMemo(() => {
    if (!stats) return null;
    const rows = stats.byTime || [];
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v) => (v === null ? '—' : v) },
      grid: { left: 40, right: 20, top: 36, bottom: 30 },
      legend: { data: ['平均分', '最高分', '最低分'], top: 4, textStyle: { color: AXIS } },
      xAxis: { type: 'category', data: rows.map((r) => r.date), axisLine: { lineStyle: { color: SPLIT } }, axisLabel: { color: AXIS } },
      yAxis: { type: 'value', min: 0, max: 100, axisLabel: { color: AXIS }, splitLine: { lineStyle: { color: SPLIT } } },
      series: [
        { name: '平均分', type: 'line', smooth: true, data: rows.map((r) => r.avg), itemStyle: { color: '#4f5cf6' }, areaStyle: { opacity: 0.08 }, symbolSize: 7 },
        { name: '最高分', type: 'line', smooth: true, data: rows.map((r) => r.max), lineStyle: { type: 'dashed', color: '#16a34a' }, itemStyle: { color: '#16a34a' }, symbolSize: 5 },
        { name: '最低分', type: 'line', smooth: true, data: rows.map((r) => r.min), lineStyle: { type: 'dashed', color: '#dc2626' }, itemStyle: { color: '#dc2626' }, symbolSize: 5 },
      ],
    };
  }, [stats]);

  const domainOption = useMemo(() => {
    if (!stats) return null;
    const rows = stats.byDomain || [];
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 40, right: 20, top: 36, bottom: 30 },
      xAxis: { type: 'category', data: rows.map((r) => domainLabel(r.domainId)), axisLabel: { color: AXIS, interval: 0, rotate: rows.length > 4 ? 20 : 0 }, axisLine: { lineStyle: { color: SPLIT } } },
      yAxis: { type: 'value', min: 0, max: 100, axisLabel: { color: AXIS }, splitLine: { lineStyle: { color: SPLIT } } },
      series: [{
        name: '平均分', type: 'bar', barWidth: 34,
        data: rows.map((r) => ({ value: r.avg, itemStyle: { color: r.avg >= 80 ? '#16a34a' : r.avg >= 65 ? '#d97706' : '#dc2626', borderRadius: [8, 8, 0, 0] } })),
        label: { show: true, position: 'top', formatter: (p) => (p.value === null ? '—' : p.value), color: AXIS, fontFamily: 'monospace' },
      }],
    };
  }, [stats]);

  const radarOption = useMemo(() => {
    if (!stats) return null;
    const dims = stats.dimensions || [];
    const names = dims.map((d) => d.name);
    const series = [];
    if (focusDomain === 'all') {
      series.push({
        name: '全部平均', type: 'radar',
        data: [{ value: dims.map((d) => d.avg), name: '全部平均' }],
        areaStyle: { opacity: 0.15 }, itemStyle: { color: '#4f5cf6' }, lineStyle: { color: '#4f5cf6', width: 2 }, symbolSize: 4,
      });
    } else {
      series.push({
        name: domainLabel(focusDomain), type: 'radar',
        data: [{ value: dims.map((d) => d.byDomain?.[focusDomain] ?? null), name: domainLabel(focusDomain) }],
        areaStyle: { opacity: 0.18 }, itemStyle: { color: '#7c5cf6' }, lineStyle: { color: '#7c5cf6', width: 2 }, symbolSize: 4,
      });
      const avg = {
        name: '全部平均', type: 'radar',
        data: [{ value: dims.map((d) => d.avg), name: '全部平均' }],
        areaStyle: { opacity: 0.06 }, itemStyle: { color: '#8b93a7' }, lineStyle: { color: '#8b93a7', type: 'dashed' }, symbolSize: 3,
      };
      series.push(avg);
    }
    return {
      tooltip: { valueFormatter: (v) => (v === null ? '—' : v) },
      legend: { top: 4, textStyle: { color: AXIS }, data: series.map((s) => s.name) },
      radar: {
        indicator: names.map((n) => ({ name: n, max: 100 })),
        axisName: { color: AXIS, fontSize: 12 },
        splitLine: { lineStyle: { color: SPLIT } },
        splitArea: { areaStyle: { color: ['#ffffff', '#fafbff'] } },
        axisLine: { lineStyle: { color: SPLIT } },
        radius: '68%',
      },
      series,
    };
  }, [stats, focusDomain]);

  const chartTime = useChart(timeOption);
  const chartDomain = useChart(domainOption);
  const chartRadar = useChart(radarOption);

  if (err) return <div className="card"><div className="empty">😵 {err}</div></div>;
  if (!stats) return <div className="loading"><span className="spinner" /> 加载统计数据…</div>;

  const done = (stats.byDomain || []).reduce((s, r) => s + r.count, 0);
  const allAvg = stats.byTime.length ? stats.byTime[stats.byTime.length - 1].avg : null;
  const overallAvg = stats.byDomain.length
    ? Math.round((stats.byDomain.reduce((s, r) => s + r.avg * r.count, 0) / done) * 10) / 10
    : null;
  const topDomain = stats.byDomain.length ? stats.byDomain.reduce((a, b) => (b.avg > a.avg ? b : a)) : null;

  return (
    <div>
      <div className="stat-cards">
        <div className="stat-card"><div className="k">已完成面试</div><div className="v">{done}<small> 场</small></div></div>
        <div className="stat-card"><div className="k">综合平均分</div><div className="v">{overallAvg ?? '—'}<small> / 100</small></div></div>
        <div className="stat-card"><div className="k">最近一次平均分</div><div className="v">{allAvg ?? '—'}<small> / 100</small></div></div>
        <div className="stat-card"><div className="k">最强领域</div><div className="v" style={{ fontSize: 16, fontFamily: 'inherit' }}>{topDomain ? domainLabel(topDomain.domainId) : '—'}<small> {topDomain?.avg ?? ''}</small></div></div>
      </div>

      <div className="card">
        <div className="card-title">📈 评分历史趋势 <span className="sub">按时间维度 · 每天的平均/最高/最低分</span></div>
        {stats.byTime.length === 0
          ? <div className="empty"><div className="big">📉</div>暂无数据，完成一场面试后这里就会出现你的成长曲线。</div>
          : <div ref={chartTime} className="chart" />}
      </div>

      <div className="card">
        <div className="card-title">🏆 各领域平均分对比 <span className="sub">按领域维度 · 考察自己的强项与短板</span></div>
        {done === 0
          ? <div className="empty"><div className="big">🏆</div>暂无数据。</div>
          : <div ref={chartDomain} className="chart" />}
      </div>

      <div className="card">
        <div className="card-title">🕸 能力维度雷达 <span className="sub">不同维度的平均得分对比</span>
          <select className="select" style={{ width: 200, marginLeft: 'auto' }} value={focusDomain} onChange={(e) => setFocusDomain(e.target.value)}>
            <option value="all">全部面试</option>
            {stats.byDomain.map((d) => <option key={d.domainId} value={d.domainId}>{domainLabel(d.domainId)}</option>)}
          </select>
        </div>
        {stats.dimensions.length === 0
          ? <div className="empty"><div className="big">🕸</div>暂无数据。</div>
          : <div ref={chartRadar} className="chart" />}
      </div>
    </div>
  );
}

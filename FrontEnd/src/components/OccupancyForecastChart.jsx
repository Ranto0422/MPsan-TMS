import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '../auth.js'
import {
	ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
	ResponsiveContainer, ReferenceLine
} from 'recharts'
import { BiTrendingUp } from 'react-icons/bi'

/**
 * OccupancyForecastChart
 * Fetches and displays the last 12 months of historical occupancy
 * and the next 12 months of ML-predicted occupancy as two distinct lines.
 */
export default function OccupancyForecastChart({ propertyId }) {
	const [data, setData] = useState(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState(null)

	const fetchForecast = useCallback(async () => {
		if (!propertyId) return
		setLoading(true)
		setError(null)
		try {
			const res = await authFetch(`/api/ml/occupancy-forecast/${propertyId}/`)
			if (!res.ok) {
				const body = await res.json().catch(() => ({}))
				throw new Error(body.detail || `HTTP ${res.status}`)
			}
			const json = await res.json()
			setData(json)
		} catch (err) {
			console.error('Forecast fetch error:', err)
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}, [propertyId])

	useEffect(() => { fetchForecast() }, [fetchForecast])

	/* ── Build unified chart data (last 12 historical + 12 forecast) ── */
	const chartData = (() => {
		if (!data) return []
		const map = new Map()

		// Take only the LAST 12 months of historical data
		const hist = data.historical || []
		const last12Hist = hist.slice(-12)

		last12Hist.forEach(h => {
			map.set(h.month, {
				month: h.month,
				label: formatMonth(h.month),
				historical: Math.round(h.occupancy_rate * 100 * 100) / 100,
				forecast: null,
			})
		})

		// Forecast (next 12 months)
		;(data.forecast || []).forEach(f => {
			const ciLo = f.ci_lower != null ? Math.round(f.ci_lower * 100 * 100) / 100 : null
			const ciHi = f.ci_upper != null ? Math.round(f.ci_upper * 100 * 100) / 100 : null
			const existing = map.get(f.month)
			if (existing) {
				existing.forecast = Math.round(f.predicted_occupancy * 100 * 100) / 100
				existing.ci_lower = ciLo
				existing.ci_upper = ciHi
				existing.ci_range = (ciHi != null && ciLo != null) ? Math.round((ciHi - ciLo) * 100) / 100 : null
			} else {
				map.set(f.month, {
					month: f.month,
					label: formatMonth(f.month),
					historical: null,
					forecast: Math.round(f.predicted_occupancy * 100 * 100) / 100,
					ci_lower: ciLo,
					ci_upper: ciHi,
					ci_range: (ciHi != null && ciLo != null) ? Math.round((ciHi - ciLo) * 100) / 100 : null,
				})
			}
		})

		// Bridge: copy the last historical point into forecast so the two
		// lines connect at the boundary.
		const sorted = [...map.values()].sort((a, b) => a.month.localeCompare(b.month))
		for (let i = 0; i < sorted.length; i++) {
			if (sorted[i].historical != null && sorted[i].forecast == null) {
				if (i + 1 < sorted.length && sorted[i + 1].forecast != null && sorted[i + 1].historical == null) {
					sorted[i].forecast = sorted[i].historical
				}
			}
		}

		return sorted
	})()

	/* ── Boundary month for the reference line ── */
	const boundaryMonth = (() => {
		if (!data?.historical?.length) return null
		const last = data.historical[data.historical.length - 1]
		return last?.month
	})()

	/* ── Summary numbers ── */
	const avgForecast = data?.forecast?.length
		? Math.round(
			(data.forecast.reduce((s, f) => s + f.predicted_occupancy, 0) / data.forecast.length) * 100
		)
		: null

	/* ── Render ── */
	if (!propertyId) return null

	return (
		<div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
			{/* Header */}
			<div className="flex items-center justify-between mb-6">
				<div>
					<h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
						<BiTrendingUp className="w-5 h-5 text-indigo-500" />
						Occupancy Forecast
					</h3>
					<p className="text-sm text-gray-500 dark:text-gray-400">
						ML-predicted occupancy for the next 12 months
					</p>
				</div>

				<div className="flex items-center gap-3">
					{data?.metrics?.mae != null && (
						<span className="hidden sm:inline text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded-full">
							MAE {(data.metrics.mae * 100).toFixed(1)}%
						</span>
					)}
					{avgForecast != null && (
						<span className="text-2xl font-bold text-indigo-500">{avgForecast}%</span>
					)}
				</div>
			</div>

			{/* Body */}
			{loading && (
				<div className="flex items-center justify-center h-72">
					<div className="text-center">
						<div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-600 border-t-transparent mx-auto mb-3" />
						<p className="text-sm text-gray-500 dark:text-gray-400">Running forecast model…</p>
					</div>
				</div>
			)}

			{error && !loading && (
				<div className="flex flex-col items-center justify-center h-72 text-center">
					<p className="text-sm text-red-500 dark:text-red-400 mb-3">{error}</p>
					<button
						onClick={fetchForecast}
						className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
					>
						Retry
					</button>
				</div>
			)}

			{!loading && !error && data && chartData.length === 0 && (
				<div className="flex flex-col items-center justify-center h-72 text-center">
					<BiTrendingUp className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
					<p className="text-sm text-gray-500 dark:text-gray-400 font-medium mb-1">
						Not enough occupancy data yet
					</p>
					<p className="text-xs text-gray-400 dark:text-gray-500 max-w-xs">
						{data.detail || 'Import tenants with move-in and move-out dates to enable forecasting.'}
					</p>
				</div>
			)}

			{!loading && !error && data && chartData.length > 0 && (
				<>
					{/* Chart */}
					<div className="h-72 min-h-[200px] w-full">
						<ResponsiveContainer width="100%" height={288} minHeight={200}>
							<ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
								<CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
								<XAxis
									dataKey="label"
									tick={{ fontSize: 11 }}
									stroke="#9CA3AF"
									interval={0}
									angle={-35}
									textAnchor="end"
									height={50}
								/>
								<YAxis
									domain={[0, 100]}
									tick={{ fontSize: 12 }}
									stroke="#9CA3AF"
									tickFormatter={v => `${v}%`}
								/>
								<Tooltip content={<ForecastTooltip />} />
								<Legend
									verticalAlign="top"
									height={30}
									formatter={(value) => {
										if (value === 'historical') return 'Historical (Last 12 mo)'
										if (value === 'forecast') return 'Forecast (Next 12 mo)'
										return null
									}}
									payload={[
										{ value: 'historical', type: 'line', color: '#6366F1' },
										{ value: 'forecast', type: 'line', color: '#EC4899' },
									]}
								/>
								{boundaryMonth && (
									<ReferenceLine
										x={formatMonth(boundaryMonth)}
										stroke="#9CA3AF"
										strokeDasharray="4 4"
										label={{ value: 'Now', position: 'top', fill: '#9CA3AF', fontSize: 11 }}
									/>
								)}
								{/* 80% CI shaded band (stacked: transparent base + visible range) */}
								<Area
									type="monotone"
									dataKey="ci_lower"
									stackId="ci"
									stroke="none"
									fill="transparent"
									activeDot={false}
									isAnimationActive={false}
									legendType="none"
									tooltipType="none"
								/>
								<Area
									type="monotone"
									dataKey="ci_range"
									stackId="ci"
									stroke="none"
									fill="#EC4899"
									fillOpacity={0.12}
									activeDot={false}
									isAnimationActive={false}
									legendType="none"
									tooltipType="none"
								/>
								<Line
									type="monotone"
									dataKey="historical"
									stroke="#6366F1"
									strokeWidth={2.5}
									dot={{ r: 3, fill: '#6366F1' }}
									activeDot={{ r: 5 }}
									name="historical"
									connectNulls={false}
								/>
								<Line
									type="monotone"
									dataKey="forecast"
									stroke="#EC4899"
									strokeWidth={2.5}
									strokeDasharray="6 3"
									dot={{ r: 3, fill: '#EC4899' }}
									activeDot={{ r: 5 }}
									name="forecast"
									connectNulls={false}
								/>
							</ComposedChart>
						</ResponsiveContainer>
					</div>

					{/* Model accuracy note */}
					{data.metrics?.mape != null && (
						<div className="flex justify-center mt-2">
							<span className="text-xs text-gray-400 dark:text-gray-500">
								Model accuracy: MAPE {data.metrics.mape}%
							</span>
						</div>
					)}

					{/* Forecast table (collapsible) */}
					<ForecastTable forecast={data.forecast} />

					{/* Feature importances (collapsible) */}
					<FeatureImportances importances={data.feature_importances} />
				</>
			)}
		</div>
	)
}


/* ── Collapsible forecast data table ── */
function ForecastTable({ forecast }) {
	const [expanded, setExpanded] = useState(false)
	if (!forecast?.length) return null

	const hasCI = forecast.some(f => f.ci_lower != null)

	return (
		<div className="mt-4">
			<button
				onClick={() => setExpanded(e => !e)}
				className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
			>
				{expanded ? 'Hide' : 'Show'} monthly breakdown
			</button>

			{expanded && (
				<div className="mt-3 overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
								<th className="text-left py-2 font-medium">Month</th>
								<th className="text-right py-2 font-medium">Predicted</th>
								{hasCI && <th className="text-right py-2 font-medium">CI Low</th>}
								{hasCI && <th className="text-right py-2 font-medium">CI High</th>}
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-100 dark:divide-gray-700">
							{forecast.map(f => (
								<tr key={f.month} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
									<td className="py-2 text-gray-900 dark:text-white">
										{formatMonthLong(f.month)}
									</td>
									<td className="py-2 text-right font-semibold text-indigo-600 dark:text-indigo-400">
										{(f.predicted_occupancy * 100).toFixed(1)}%
									</td>
									{hasCI && (
										<td className="py-2 text-right text-gray-500 dark:text-gray-400">
											{f.ci_lower != null ? `${(f.ci_lower * 100).toFixed(1)}%` : '\u2014'}
										</td>
									)}
									{hasCI && (
										<td className="py-2 text-right text-gray-500 dark:text-gray-400">
											{f.ci_upper != null ? `${(f.ci_upper * 100).toFixed(1)}%` : '\u2014'}
										</td>
									)}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	)
}


/* ── Custom tooltip with CI info ── */
function ForecastTooltip({ active, payload, label }) {
	if (!active || !payload?.length) return null
	const entry = payload[0]?.payload
	const hist = payload.find(p => p.dataKey === 'historical' && p.value != null)
	const fc = payload.find(p => p.dataKey === 'forecast' && p.value != null)

	return (
		<div className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm shadow-lg border border-gray-700">
			<p className="text-gray-400 mb-1">{label}</p>
			{hist && <p className="text-indigo-400">Historical: {hist.value}%</p>}
			{fc && <p className="text-pink-400">Forecast: {fc.value}%</p>}
			{fc && entry?.ci_lower != null && entry?.ci_upper != null && (
				<p className="text-gray-400 text-xs mt-1">
					80% CI: {entry.ci_lower}% - {entry.ci_upper}%
				</p>
			)}
		</div>
	)
}


/* ── Collapsible feature importances ── */
function FeatureImportances({ importances }) {
	const [expanded, setExpanded] = useState(false)
	if (!importances || !Object.keys(importances).length) return null

	const entries = Object.entries(importances).slice(0, 8)
	const maxImp = Math.max(...entries.map(([, v]) => v), 0.001)

	return (
		<div className="mt-3">
			<button
				onClick={() => setExpanded(e => !e)}
				className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
			>
				{expanded ? 'Hide' : 'Show'} feature importances
			</button>

			{expanded && (
				<div className="mt-3 space-y-2">
					{entries.map(([name, value]) => (
						<div key={name} className="flex items-center gap-3">
							<span className="text-xs text-gray-600 dark:text-gray-400 w-28 truncate" title={name}>
								{name}
							</span>
							<div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
								<div
									className="h-full bg-indigo-500 rounded-full transition-all"
									style={{ width: `${Math.round((value / maxImp) * 100)}%` }}
								/>
							</div>
							<span className="text-xs text-gray-500 dark:text-gray-400 w-12 text-right">
								{(value * 100).toFixed(1)}%
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	)
}


/* ── Helpers ── */
function formatMonth(ym) {
	// "2026-04" → "Apr '26"
	if (!ym) return ''
	const [y, m] = ym.split('-')
	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
	return `${months[parseInt(m, 10) - 1]} '${y.slice(2)}`
}

function formatMonthLong(ym) {
	if (!ym) return ''
	const [y, m] = ym.split('-')
	const months = [
		'January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December',
	]
	return `${months[parseInt(m, 10) - 1]} ${y}`
}

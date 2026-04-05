import { useState, useMemo } from 'react'
import { authFetch } from '../auth.js'

const PAGE_SIZES = [15, 25, 50, 100]

const PERIOD_OPTIONS = [
	{ value: 'all', label: 'All time' },
	{ value: '1w', label: 'Last 1 week' },
	{ value: '2w', label: 'Last 2 weeks' },
	{ value: '1m', label: 'Last 1 month' },
	{ value: '3m', label: 'Last 3 months' },
	{ value: '6m', label: 'Last 6 months' },
	{ value: '1y', label: 'Last 1 year' },
]

function getPeriodStartMs(value) {
	if (!value || value === 'all') return null
	const now = Date.now()
	switch (value) {
		case '1w': return now - 7 * 24 * 60 * 60 * 1000
		case '2w': return now - 14 * 24 * 60 * 60 * 1000
		case '1m': return now - 30 * 24 * 60 * 60 * 1000
		case '3m': return now - 90 * 24 * 60 * 60 * 1000
		case '6m': return now - 180 * 24 * 60 * 60 * 1000
		case '1y': return now - 365 * 24 * 60 * 60 * 1000
		default: return null
	}
}

function getTypeLabel(type) {
	const t = (type ?? '').toString().toLowerCase().trim()
	if (t === 'rent' || t === 'monthly_rent' || t === 'monthly rent') return 'Rent'
	if (t === 'advance') return 'Advance'
	if (t === 'deposit') return 'Deposit'
	if (t.includes('refund')) return 'Refund'
	if (t.includes('damage')) return 'Damage'
	return t || '—'
}

function toDateOnly(d) {
	if (d instanceof Date) return new Date(d.getFullYear(), d.getMonth(), d.getDate())
	if (typeof d === 'string') return toDateOnly(new Date(d + 'T12:00:00'))
	return null
}

function toYYYYMMDD(d) {
	const x = toDateOnly(d)
	if (!x) return ''
	const y = x.getFullYear()
	const m = String(x.getMonth() + 1).padStart(2, '0')
	const day = String(x.getDate()).padStart(2, '0')
	return `${y}-${m}-${day}`
}

function isInDateRange(payment, fromDate, toDate) {
	const ts = payment.timestamp ?? payment.date
	if (ts == null) return false
	const d = typeof ts === 'number' ? new Date(ts) : new Date(ts)
	if (Number.isNaN(d.getTime())) return false
	const day = toDateOnly(d)
	const from = toDateOnly(fromDate)
	const to = toDateOnly(toDate)
	if (!from || !to) return false
	return day.getTime() >= from.getTime() && day.getTime() <= to.getTime()
}

function categorizeForPrintByRange(payments, fromDate, toDate) {
	const inRange = payments.filter(p => isInDateRange(p, fromDate, toDate))
	const collected = []
	const refunds = []
	const damages = []
	inRange.forEach(p => {
		const rawType = (p.paymentType ?? p.payment_type ?? '').toString().toLowerCase()
		if (rawType.includes('refund')) refunds.push(p)
		else if (rawType.includes('damage')) damages.push(p)
		else collected.push(p)
	})
	return { collected, refunds, damages }
}

// Build calendar grid for one month: array of { date, label, isCurrentMonth, isToday }
function getCalendarDays(year, month) {
	const first = new Date(year, month, 1)
	const last = new Date(year, month + 1, 0)
	const startPad = first.getDay()
	const daysInMonth = last.getDate()
	const prevMonth = month === 0 ? 11 : month - 1
	const prevYear = month === 0 ? year - 1 : year
	const prevLast = new Date(prevYear, prevMonth + 1, 0).getDate()
	const today = new Date()
	const result = []
	for (let i = 0; i < startPad; i++) {
		const d = prevLast - startPad + 1 + i
		result.push({ date: new Date(prevYear, prevMonth, d), label: d, isCurrentMonth: false, isToday: false })
	}
	for (let d = 1; d <= daysInMonth; d++) {
		const date = new Date(year, month, d)
		result.push({ date, label: d, isCurrentMonth: true, isToday: date.getTime() === toDateOnly(today).getTime() })
	}
	const remaining = 42 - result.length
	for (let d = 1; d <= remaining; d++) {
		result.push({ date: new Date(year, month + 1, d), label: d, isCurrentMonth: false, isToday: false })
	}
	return result.slice(0, 42)
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const now = new Date()
const defaultFrom = toYYYYMMDD(new Date(now.getFullYear(), now.getMonth(), 1))
const defaultTo = toYYYYMMDD(now)

const RentCollectedListView = ({ property, payments = [], partialPayers = [], tenantReceivables = [], onBack }) => {
	const [currentPage, setCurrentPage] = useState(1)
	const [pageSize, setPageSize] = useState(25)
	const [searchQuery, setSearchQuery] = useState('')
	const [period, setPeriod] = useState('all')
	const [showPrintModal, setShowPrintModal] = useState(false)
	const [printFromDate, setPrintFromDate] = useState(defaultFrom)
	const [printToDate, setPrintToDate] = useState(defaultTo)
	const [calendarMonth, setCalendarMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1))
	const [selectingEnd, setSelectingEnd] = useState(false)
	const [exporting, setExporting] = useState(false)
	const [printFilters, setPrintFilters] = useState({
		rent: true,
		advance: true,
		deposit: true,
		refunds: true,
		damages: true,
		receivables: true,
	})

	const filteredPayments = useMemo(() => {
		let list = payments
		// Filter by time period (all transactions: rent, advance, deposit, refunds, damages, etc.)
		const periodStart = getPeriodStartMs(period)
		if (periodStart != null) {
			list = list.filter(p => {
				const ts = p.timestamp ?? p.date
				const ms = ts == null ? null : (typeof ts === 'number' ? ts : new Date(ts).getTime())
				if (ms == null || Number.isNaN(ms)) return true
				return ms >= periodStart
			})
		}
		if (!searchQuery.trim()) return list
		const q = searchQuery.toLowerCase().trim()
		return list.filter(
			p =>
				p.name?.toLowerCase().includes(q) ||
				String(p.room ?? '').toLowerCase().includes(q) ||
				String(p.paymentDate ?? '').toLowerCase().includes(q) ||
				getTypeLabel(p.paymentType ?? p.payment_type).toLowerCase().includes(q)
		)
	}, [payments, searchQuery, period])

	const totalPages = Math.max(1, Math.ceil(filteredPayments.length / pageSize))
	const pageIndex = Math.min(Math.max(1, currentPage), totalPages)
	const start = (pageIndex - 1) * pageSize
	const pagePayments = useMemo(
		() => filteredPayments.slice(start, start + pageSize),
		[filteredPayments, start, pageSize]
	)

	const totalAmount = useMemo(
		() => filteredPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0),
		[filteredPayments]
	)

	// Reset to page 1 when search, page size, or period changes
	const handlePageSizeChange = (e) => {
		const newSize = Number(e.target.value) || 25
		setPageSize(newSize)
		setCurrentPage(1)
	}
	const handlePeriodChange = (e) => {
		setPeriod(e.target.value)
		setCurrentPage(1)
	}

	function formatAmt(n) {
		return (parseFloat(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })
	}

	function openPrintForDateRange(fromStr, toStr, filters) {
		const fromD = fromStr ? new Date(fromStr + 'T00:00:00') : null
		const toD = toStr ? new Date(toStr + 'T23:59:59.999') : null
		if (!fromD || !toD || fromD.getTime() > toD.getTime()) {
			alert('Please select a valid date range (From must be on or before To).')
			return
		}
		const { collected: allCollected, refunds: allRefunds, damages: allDamages } = categorizeForPrintByRange(payments, fromD, toD)

		// Apply type filters to collected (rent/advance/deposit)
		const collected = allCollected.filter(p => {
			const rawType = (p.paymentType ?? p.payment_type ?? '').toString().toLowerCase()
			if (rawType === 'advance') return filters.advance
			if (rawType === 'deposit') return filters.deposit
			return filters.rent // rent, monthly_rent, and other collected types
		})
		const refunds = filters.refunds ? allRefunds : []
		const damages = filters.damages ? allDamages : []

		const sum = (arr) => arr.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
		const totalCollected = sum(collected)
		const totalRefunds = sum(refunds)
		const totalDamages = sum(damages)
		const netTotal = totalCollected - Math.abs(totalRefunds) - Math.abs(totalDamages)
		const propName = property?.propertyName ?? property?.name ?? 'Property'
		const fromLabel = fromD.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
		const toLabel = toD.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
		const rangeLabel = fromStr === toStr ? fromLabel : `${fromLabel} – ${toLabel}`
		const title = `${propName} — Transactions ${rangeLabel}`

		// Flatten receivables for PDF: outstanding (not received) and received (received_at in date range)
		const receivablesOutstanding = []
		const receivablesReceived = []
		if (filters.receivables) {
			tenantReceivables.forEach((t) => {
				(t.receivables || []).forEach((r) => {
					const amt = parseFloat(r.amount) || 0
					const received = r.received === true
					const receivedAt = r.received_at ? new Date(r.received_at) : null
					const inRange = receivedAt && receivedAt >= fromD && receivedAt <= toD
					const dateStr = r.date ? new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
					const row = { name: t.full_name, room: t.room, reason: r.reason || 'Reimbursement', date: dateStr, amount: amt, received_at: r.received_at }
					if (received && inRange) {
						receivablesReceived.push(row)
					} else if (!received) {
						receivablesOutstanding.push(row)
					}
				})
			})
		}
		const totalOutstanding = receivablesOutstanding.reduce((s, r) => s + r.amount, 0)
		const totalReceived = receivablesReceived.reduce((s, r) => s + r.amount, 0)
		const totalReceivableAll = totalOutstanding + totalReceived

		const row = (p, showType = true) => `
			<tr>
				<td class="cell">${(p.paymentDate ?? '—')}</td>
				<td class="cell">${(p.name ?? '—')}</td>
				${showType ? `<td class="cell">${getTypeLabel(p.paymentType ?? p.payment_type)}</td>` : ''}
				<td class="cell">${(p.room ?? '—')}</td>
				<td class="cell num">₱${formatAmt(p.amount)}</td>
			</tr>`

		const tableSection = (label, rows, total, showType) => `
			<div class="section">
				<h2 class="section-title">${label}</h2>
				<table class="tbl">
					<thead><tr>
						<th class="cell">Date</th><th class="cell">Name</th>
						${showType ? '<th class="cell">Type</th>' : ''}
						<th class="cell">Room</th><th class="cell num">Amount</th>
					</tr></thead>
					<tbody>
						${rows.length ? rows.map(p => row(p, showType)).join('') : '<tr><td class="cell" colspan="5">No transactions</td></tr>'}
						<tr class="subtotal"><td class="cell" colspan="${showType ? 4 : 3}"><strong>Subtotal</strong></td><td class="cell num"><strong>₱${formatAmt(total)}</strong></td></tr>
					</tbody>
				</table>
			</div>`

		const recRow = (r, showReceivedAt = false) => `
			<tr>
				<td class="cell">${r.date}</td>
				<td class="cell">${r.name ?? '—'}</td>
				<td class="cell">${r.room ?? '—'}</td>
				<td class="cell">${r.reason ?? '—'}</td>
				${showReceivedAt ? `<td class="cell">${r.received_at ? new Date(r.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>` : ''}
				<td class="cell num">₱${formatAmt(r.amount)}</td>
			</tr>`
		const receivablesSection = (label, recRows, total) => {
			const hasReceivedCol = label.includes('Received')
			const colCount = hasReceivedCol ? 6 : 5
			return `
			<div class="section">
				<h2 class="section-title">${label}</h2>
				<table class="tbl">
					<thead><tr>
						<th class="cell">Date</th><th class="cell">Name</th><th class="cell">Room</th><th class="cell">Reason</th>
						${hasReceivedCol ? '<th class="cell">Received date</th>' : ''}
						<th class="cell num">Amount</th>
					</tr></thead>
					<tbody>
						${recRows.length ? recRows.map(r => recRow(r, hasReceivedCol)).join('') : `<tr><td class="cell" colspan="${colCount}">None</td></tr>`}
						<tr class="subtotal"><td class="cell" colspan="${colCount - 1}"><strong>Subtotal</strong></td><td class="cell num"><strong>₱${formatAmt(total)}</strong></td></tr>
					</tbody>
				</table>
			</div>`
		}

		const receivablesHtml = filters.receivables && tenantReceivables.length > 0 ? `
	${receivablesSection('Receivables — Outstanding (tenant owes you)', receivablesOutstanding, totalOutstanding)}
	${receivablesSection('Receivables — Received (in date range)', receivablesReceived, totalReceived)}
	<table class="tbl total-row">
		<tr><td class="cell" colspan="2"><strong>Receivables outstanding</strong></td><td class="cell num"><strong>₱${formatAmt(totalOutstanding)}</strong></td></tr>
		<tr><td class="cell" colspan="2"><strong>Receivables received (in range)</strong></td><td class="cell num"><strong>₱${formatAmt(totalReceived)}</strong></td></tr>
		<tr><td class="cell" colspan="2"><strong>Total receivable (all)</strong></td><td class="cell num"><strong>₱${formatAmt(totalReceivableAll)}</strong></td></tr>
	</table>` : ''

		// Build collected label based on which types are included
		const collectedTypes = []
		if (filters.rent) collectedTypes.push('Rent')
		if (filters.advance) collectedTypes.push('Advance')
		if (filters.deposit) collectedTypes.push('Deposit')
		const collectedLabel = collectedTypes.length > 0 ? `Collected (${collectedTypes.join(', ')})` : 'Collected'
		const hasCollected = filters.rent || filters.advance || filters.deposit

		// Build summary rows
		const summaryRows = []
		if (hasCollected) summaryRows.push(`<tr><td class="cell" colspan="2"><strong>Collected</strong></td><td class="cell num"><strong>₱${formatAmt(totalCollected)}</strong></td></tr>`)
		if (filters.refunds) summaryRows.push(`<tr><td class="cell" colspan="2"><strong>Refunds</strong></td><td class="cell num"><strong>₱${formatAmt(totalRefunds)}</strong></td></tr>`)
		if (filters.damages) summaryRows.push(`<tr><td class="cell" colspan="2"><strong>Damages</strong></td><td class="cell num"><strong>₱${formatAmt(totalDamages)}</strong></td></tr>`)
		if (summaryRows.length > 1) summaryRows.push(`<tr><td class="cell" colspan="2"><strong>Net Total</strong></td><td class="cell num"><strong>₱${formatAmt(netTotal)}</strong></td></tr>`)

		const html = `
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>${title}</title>
	<style>
		body { font-family: system-ui, sans-serif; padding: 20px; color: #111; max-width: 900px; margin: 0 auto; }
		h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
		.meta { color: #666; font-size: 0.9rem; margin-bottom: 24px; }
		.section { margin-bottom: 28px; break-inside: avoid; }
		.section-title { font-size: 1rem; margin-bottom: 8px; border-bottom: 1px solid #333; padding-bottom: 4px; }
		.tbl { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
		.tbl th, .tbl td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
		.tbl th { background: #2d5016; color: #fff; }
		.tbl .num { text-align: right; }
		.tbl .subtotal { background: #f0f0f0; }
		.total-row { font-size: 1rem; font-weight: bold; border-top: 2px solid #333; margin-top: 16px; padding-top: 12px; }
		.total-row .cell { border: none; padding: 8px 0; }
		@media print { body { padding: 12px; } }
		.no-print-btn {
			position: fixed;
			top: 12px;
			left: 12px;
			z-index: 9999;
			background: #3b82f6;
			color: white;
			border: none;
			border-radius: 8px;
			padding: 10px 18px;
			font-size: 15px;
			font-weight: 600;
			cursor: pointer;
			display: flex;
			align-items: center;
			gap: 6px;
			box-shadow: 0 2px 8px rgba(0,0,0,0.2);
		}
		.no-print-btn:hover { background: #2563eb; }
		@media print { .no-print-btn { display: none !important; } }
	</style>
</head>
<body>
	<button class="no-print-btn" onclick="window.close()">&#8592; Back</button>
	<h1>${propName}</h1>
	<p class="meta">Transactions ${rangeLabel} — Printed ${new Date().toLocaleDateString('en-US', { dateStyle: 'medium' })}</p>
	${hasCollected ? tableSection(collectedLabel, collected, totalCollected, true) : ''}
	${filters.refunds ? tableSection('Refunds', refunds, totalRefunds, false) : ''}
	${filters.damages ? tableSection('Damages', damages, totalDamages, false) : ''}
	${summaryRows.length > 0 ? `<table class="tbl total-row">${summaryRows.join('')}</table>` : ''}
	${receivablesHtml}
</body>
</html>`

		const w = window.open('', '_blank')
		if (!w) {
			alert('Please allow pop-ups to print or save as PDF.')
			return
		}
		w.document.write(html)
		w.document.close()
		w.focus()
	}

	const handlePrintClick = () => setShowPrintModal(true)
	const handlePrintConfirm = () => {
		openPrintForDateRange(printFromDate, printToDate, printFilters)
		setShowPrintModal(false)
	}
	const togglePrintFilter = (key) => setPrintFilters(prev => ({ ...prev, [key]: !prev[key] }))

	const handleExportCSV = async () => {
		setExporting(true)
		try {
			const res = await authFetch(`/api/properties/${property.id}/export-payments/`)
			if (!res.ok) throw new Error('Export failed')
			const blob = await res.blob()
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = `${property?.propertyName || 'payments'}_transactions.csv`
			a.click()
			URL.revokeObjectURL(url)
		} catch (err) {
			console.error('Export error:', err)
			alert('Failed to export payment data')
		} finally {
			setExporting(false)
		}
	}

	const calendarDays = useMemo(() => {
		const y = calendarMonth.getFullYear()
		const m = calendarMonth.getMonth()
		return getCalendarDays(y, m)
	}, [calendarMonth])

	const handleCalendarDayClick = (dayInfo) => {
		const str = toYYYYMMDD(dayInfo.date)
		if (!selectingEnd) {
			setPrintFromDate(str)
			setPrintToDate(str)
			setSelectingEnd(true)
		} else {
			if (str < printFromDate) {
				setPrintToDate(printFromDate)
				setPrintFromDate(str)
			} else {
				setPrintToDate(str)
			}
			setSelectingEnd(false)
		}
	}

	const prevMonth = () => setCalendarMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
	const nextMonth = () => setCalendarMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))
	const monthLabel = calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

	return (
		<div className="w-full h-full flex flex-col bg-gray-50 dark:bg-gray-900 font-sans">
			{/* Print Modal */}
			{showPrintModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowPrintModal(false)}>
					<div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 max-w-md w-full border border-gray-100 dark:border-gray-700 max-h-[95vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
						<div className="flex justify-between items-start mb-4">
							<div>
								<h2 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Print Report</h2>
								<p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Export transaction history to PDF</p>
							</div>
							<button onClick={() => setShowPrintModal(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors">
								<svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
							</button>
						</div>

						<div className="grid grid-cols-2 gap-3 mb-6">
							<div className="space-y-1">
								<label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-1">From Date</label>
								<input
									type="date"
									value={printFromDate}
									onChange={e => setPrintFromDate(e.target.value)}
									className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none dark:text-white"
								/>
							</div>
							<div className="space-y-1">
								<label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-1">To Date</label>
								<input
									type="date"
									value={printToDate}
									onChange={e => setPrintToDate(e.target.value)}
									className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none dark:text-white"
								/>
							</div>
						</div>

						<div className="bg-gray-50 dark:bg-gray-900/50 rounded-2xl p-4 mb-6 border border-gray-100 dark:border-gray-800">
							<div className="flex items-center justify-between mb-4 px-2">
								<button type="button" onClick={prevMonth} className="p-2 rounded-xl hover:bg-white dark:hover:bg-gray-700 shadow-sm transition-all text-gray-600 dark:text-gray-300">
									<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
								</button>
								<span className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-wider">{monthLabel}</span>
								<button type="button" onClick={nextMonth} className="p-2 rounded-xl hover:bg-white dark:hover:bg-gray-700 shadow-sm transition-all text-gray-600 dark:text-gray-300">
									<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
								</button>
							</div>
							<div className="grid grid-cols-7 mb-2">
								{WEEKDAYS.map(w => (
									<div key={w} className="text-[10px] font-black text-gray-400 uppercase text-center">{w[0]}</div>
								))}
							</div>
							<div className="grid grid-cols-7 gap-1">
								{calendarDays.map((dayInfo, i) => {
									const str = toYYYYMMDD(dayInfo.date)
									const isFrom = str === printFromDate
									const isTo = str === printToDate
									const inRange = printFromDate && printToDate && str >= printFromDate && str <= printToDate
									return (
										<button
											key={i}
											type="button"
											onClick={() => handleCalendarDayClick(dayInfo)}
											className={`
												h-9 rounded-lg text-xs font-bold transition-all relative flex items-center justify-center
												${!dayInfo.isCurrentMonth ? 'text-gray-300 dark:text-gray-600 opacity-50' : 'text-gray-900 dark:text-white'}
												${dayInfo.isToday && dayInfo.isCurrentMonth ? 'after:content-[""] after:absolute after:bottom-1 after:w-1 after:h-1 after:bg-green-500 after:rounded-full' : ''}
												${isFrom || isTo ? 'bg-green-600 text-white shadow-lg shadow-green-600/30' : inRange && dayInfo.isCurrentMonth ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'hover:bg-white dark:hover:bg-gray-700'}
											`}
										>
											{dayInfo.label}
										</button>
									)
								})}
							</div>
						</div>

						{/* Include Filters */}
						<div className="mb-6">
							<p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 pl-1">Include in Report</p>
							<div className="grid grid-cols-2 gap-2">
								{[
									{ key: 'rent', label: 'Rent', onBg: 'bg-sky-50 dark:bg-sky-900/30', onText: 'text-sky-700 dark:text-sky-300', onBorder: 'border-sky-200 dark:border-sky-800', checkBg: 'bg-sky-500' },
									{ key: 'advance', label: 'Advance', onBg: 'bg-purple-50 dark:bg-purple-900/30', onText: 'text-purple-700 dark:text-purple-300', onBorder: 'border-purple-200 dark:border-purple-800', checkBg: 'bg-purple-500' },
									{ key: 'deposit', label: 'Deposit', onBg: 'bg-indigo-50 dark:bg-indigo-900/30', onText: 'text-indigo-700 dark:text-indigo-300', onBorder: 'border-indigo-200 dark:border-indigo-800', checkBg: 'bg-indigo-500' },
									{ key: 'refunds', label: 'Refunds', onBg: 'bg-red-50 dark:bg-red-900/30', onText: 'text-red-700 dark:text-red-300', onBorder: 'border-red-200 dark:border-red-800', checkBg: 'bg-red-500' },
									{ key: 'damages', label: 'Damages', onBg: 'bg-orange-50 dark:bg-orange-900/30', onText: 'text-orange-700 dark:text-orange-300', onBorder: 'border-orange-200 dark:border-orange-800', checkBg: 'bg-orange-500' },
									{ key: 'receivables', label: 'Receivables', onBg: 'bg-amber-50 dark:bg-amber-900/30', onText: 'text-amber-700 dark:text-amber-300', onBorder: 'border-amber-200 dark:border-amber-800', checkBg: 'bg-amber-500' },
								].map(f => (
									<button
										key={f.key}
										type="button"
										onClick={() => togglePrintFilter(f.key)}
										className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${
											printFilters[f.key]
												? `${f.onBg} ${f.onText} ${f.onBorder}`
												: 'bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700'
										}`}
									>
										<div className={`w-4 h-4 rounded flex items-center justify-center transition-all ${
											printFilters[f.key]
												? `${f.checkBg} text-white`
												: 'bg-gray-200 dark:bg-gray-600'
										}`}>
											{printFilters[f.key] && (
												<svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
												</svg>
											)}
										</div>
										{f.label}
									</button>
								))}
							</div>
						</div>

						<div className="grid grid-cols-2 gap-3">
							<button type="button" onClick={() => setShowPrintModal(false)} className="py-3 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-bold text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors">
								Cancel
							</button>
							<button type="button" onClick={handlePrintConfirm} className="py-3 px-4 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-bold shadow-lg shadow-green-600/30 active:scale-95 transition-all">
								Generate PDF
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Sticky Header */}
			<div className="sticky top-0 z-30 bg-white/80 dark:bg-gray-800/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-700 px-4 md:px-6 py-4">
				<div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
					<div className="flex items-center gap-4">
						<button
							type="button"
							onClick={onBack}
							className="p-2.5 bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl shadow-sm border border-gray-200 dark:border-gray-600 transition-all active:scale-90"
						>
							<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
							</svg>
						</button>
						<div>
							<h1 className="text-xl md:text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight line-clamp-1">
								{property?.propertyName ?? property?.name ?? 'Property Ledger'}
							</h1>
							<div className="flex items-center gap-2 mt-0.5">
								<span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
								<p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-widest leading-none">Financial Transaction History</p>
							</div>
						</div>
					</div>

					<div className="flex items-center gap-3 w-full md:w-auto">
						<button
							type="button"
							onClick={handleExportCSV}
							disabled={exporting}
							className="flex-1 md:flex-none px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold transition-all flex items-center justify-center space-x-2 shadow-lg shadow-green-600/20 active:scale-95 disabled:opacity-50"
						>
							{exporting ? (
								<div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
							) : (
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
								</svg>
							)}
							<span className="text-sm">Export CSV</span>
						</button>
						<button
							type="button"
							onClick={handlePrintClick}
							className="flex-1 md:flex-none px-6 py-2.5 bg-gray-900 dark:bg-gray-700 hover:bg-black dark:hover:bg-gray-600 text-white rounded-xl font-bold transition-all flex items-center justify-center space-x-2 shadow-lg shadow-black/10 dark:shadow-none"
						>
							<svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
							</svg>
							<span className="text-sm">Generate Report</span>
						</button>
					</div>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 pb-20 md:pb-6">
				<div className="max-w-7xl mx-auto space-y-6">
					{/* Stats Cards */}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div className="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between">
							<div>
								<p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total Payments</p>
								<div className="flex items-baseline gap-2">
									<span className="text-3xl font-black text-gray-900 dark:text-white leading-none">{filteredPayments.length}</span>
									<span className="text-xs font-bold text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full uppercase tracking-tighter">Transactions</span>
								</div>
							</div>
							<div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-2xl">
								<svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
								</svg>
							</div>
						</div>

						<div className="bg-gradient-to-br from-green-600 to-green-700 p-5 rounded-2xl shadow-lg shadow-green-600/20 flex items-center justify-between text-white">
							<div>
								<p className="text-[10px] font-black text-green-100 uppercase tracking-widest mb-1">Total Collected</p>
								<div className="text-3xl font-black leading-none">₱{totalAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
							</div>
							<div className="p-3 bg-white/20 rounded-2xl backdrop-blur-sm">
								<svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
							</div>
						</div>
					</div>

					{/* Filters Panel */}
					<div className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
						<div className="flex flex-col md:flex-row items-center justify-between gap-4">
							<div className="relative w-full md:max-w-sm">
								<input
									type="text"
									placeholder="Search tenant, room, or type..."
									value={searchQuery}
									onChange={(e) => {
										setSearchQuery(e.target.value)
										setCurrentPage(1)
									}}
									className="w-full pl-11 pr-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all outline-none dark:text-white"
								/>
								<svg className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
								</svg>
							</div>

							<div className="flex items-center gap-3 w-full md:w-auto">
								<div className="flex-1 md:flex-none flex items-center bg-gray-50 dark:bg-gray-900/50 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600">
									<span className="text-[10px] font-black text-gray-400 uppercase tracking-widest mr-2 whitespace-nowrap">Period</span>
									<select
										value={period}
										onChange={handlePeriodChange}
										className="bg-transparent text-sm font-bold text-gray-700 dark:text-gray-300 outline-none w-full"
									>
										{PERIOD_OPTIONS.map((opt) => (
											<option key={opt.value} value={opt.value}>{opt.label}</option>
										))}
									</select>
								</div>

								<div className="flex items-center bg-gray-50 dark:bg-gray-900/50 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600">
									<span className="text-[10px] font-black text-gray-400 uppercase tracking-widest mr-2 whitespace-nowrap">Size</span>
									<select
										value={pageSize}
										onChange={handlePageSizeChange}
										className="bg-transparent text-sm font-bold text-gray-700 dark:text-gray-300 outline-none"
									>
										{PAGE_SIZES.map((n) => (
											<option key={n} value={n}>{n}</option>
										))}
									</select>
								</div>
							</div>
						</div>
					</div>

					{/* Partial Payers Section */}
					{partialPayers.length > 0 && (
						<div className="space-y-3">
							<div className="flex items-center gap-2 px-1">
								<div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>
								<h2 className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest">Partial Payments Pending</h2>
							</div>

							{/* Desktop Partial Payers Table */}
							<div className="hidden md:block bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden border border-amber-200 dark:border-amber-900/50">
								<table className="w-full text-left border-collapse">
									<thead className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-900/50">
										<tr>
											<th className="px-6 py-4 text-[10px] font-black text-amber-800 dark:text-amber-400 uppercase tracking-widest">Tenant Name</th>
											<th className="px-6 py-4 text-[10px] font-black text-amber-800 dark:text-amber-400 uppercase tracking-widest">Room</th>
											<th className="px-6 py-4 text-[10px] font-black text-amber-800 dark:text-amber-400 uppercase tracking-widest text-right">Paid</th>
											<th className="px-6 py-4 text-[10px] font-black text-amber-800 dark:text-amber-400 uppercase tracking-widest text-right">Rent</th>
											<th className="px-6 py-4 text-[10px] font-black text-amber-800 dark:text-amber-400 uppercase tracking-widest text-right">Balance</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-amber-100 dark:divide-amber-900/30">
										{partialPayers.map((row, idx) => (
											<tr key={idx} className="hover:bg-amber-50/50 dark:hover:bg-amber-900/10 transition-colors">
												<td className="px-6 py-4 text-sm font-bold text-gray-900 dark:text-gray-300">{row.name}</td>
												<td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{row.room}</td>
												<td className="px-6 py-4 text-sm text-right text-gray-700 dark:text-gray-300">₱{formatAmt(row.paidSoFar)}</td>
												<td className="px-6 py-4 text-sm text-right text-gray-700 dark:text-gray-300">₱{formatAmt(row.monthlyRent)}</td>
												<td className="px-6 py-4 text-sm text-right font-black text-amber-600 dark:text-amber-400">₱{formatAmt(row.remainingBalance)}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>

							{/* Mobile Partial Payers Cards */}
							<div className="md:hidden space-y-3">
								{partialPayers.map((row, idx) => (
									<div key={idx} className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-amber-100 dark:border-amber-900/30">
										<div className="flex justify-between items-start mb-3">
											<div>
												<h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">{row.name}</h3>
												<p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Room {row.room || 'N/A'}</p>
											</div>
											<span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 text-[9px] font-black uppercase tracking-widest rounded-full">
												Partial
											</span>
										</div>
										<div className="flex items-center justify-between text-[10px] font-bold text-gray-500 uppercase tracking-tighter mb-1 px-1">
											<span>Balance Due</span>
											<span>Payment Progress</span>
										</div>
										<div className="flex items-center justify-between mb-4">
											<div className="text-xl font-black text-amber-600 dark:text-amber-400">₱{formatAmt(row.remainingBalance)}</div>
											<div className="text-right">
												<span className="text-xs font-bold text-gray-400">₱{formatAmt(row.paidSoFar)} </span>
												<span className="text-[10px] text-gray-300">/ ₱{formatAmt(row.monthlyRent)}</span>
											</div>
										</div>
										<div className="w-full h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
											<div
												className="h-full bg-amber-500 transition-all duration-500"
												style={{ width: `${Math.min(100, (row.paidSoFar / (row.monthlyRent || 1)) * 100)}%` }}
											></div>
										</div>
									</div>
								))}
							</div>
						</div>
					)}

					{/* Main Transaction List Section */}
					<div className="space-y-3">
						<div className="flex items-center gap-2 px-1">
							<div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
							<h2 className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest">Recent Transactions</h2>
						</div>

						{/* Desktop Transactions Table */}
						<div className="hidden md:block bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden border border-gray-100 dark:border-gray-700">
							<table className="w-full text-left border-collapse">
								<thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
									<tr>
										<th className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Tenant Name</th>
										<th className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Date</th>
										<th className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Type</th>
										<th className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Room</th>
										<th className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Status</th>
										<th className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest text-right">Amount</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
									{pagePayments.length === 0 ? (
										<tr>
											<td colSpan="6" className="px-6 py-12 text-center text-gray-400 font-medium">No transactions found</td>
										</tr>
									) : (
										pagePayments.map((payment, idx) => {
											const rawType = (payment.paymentType ?? payment.payment_type ?? '').toString().toLowerCase()
											const isRefund = rawType.includes('refund')
											const isDamage = rawType.includes('damage')
											const isLate = payment.is_late === true || payment.status?.toLowerCase() === 'late'
											const status = isRefund ? 'Refund' : isDamage ? 'Damage' : isLate ? 'Late' : (payment.status || 'Paid')

											return (
												<tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-900/20 transition-colors">
													<td className="px-6 py-4 text-sm font-bold text-gray-900 dark:text-gray-300">{payment.name}</td>
													<td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{payment.paymentDate}</td>
													<td className="px-6 py-4">
														<span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-tight 
															${getTypeBadgeStyle(payment.paymentType ?? payment.payment_type)}`}>
															{getTypeLabel(payment.paymentType ?? payment.payment_type)}
														</span>
													</td>
													<td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{payment.room}</td>
													<td className="px-6 py-4">
														<span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-tight
															${isRefund ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
																isDamage ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30' :
																	isLate ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30' :
																		'bg-green-100 text-green-700 dark:bg-green-900/30'}`}>
															{status}
														</span>
													</td>
													<td className={`px-6 py-4 text-sm font-black text-right 
														${isRefund ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
														₱{formatAmt(payment.amount)}
													</td>
												</tr>
											)
										})
									)}
								</tbody>
							</table>
						</div>

						{/* Mobile Transactions Cards */}
						<div className="md:hidden space-y-3">
							{pagePayments.length === 0 ? (
								<div className="py-12 text-center text-gray-400 font-medium bg-white dark:bg-gray-800 rounded-2xl">No transactions found</div>
							) : (
								pagePayments.map((payment, idx) => {
									const rawType = (payment.paymentType ?? payment.payment_type ?? '').toString().toLowerCase()
									const isRefund = rawType.includes('refund')
									const isDamage = rawType.includes('damage')
									const isLate = payment.is_late === true || payment.status?.toLowerCase() === 'late'
									const status = isRefund ? 'Refund' : isDamage ? 'Damage' : isLate ? 'Late' : (payment.status || 'Paid')

									return (
										<div key={idx} className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
											<div className="flex justify-between items-start mb-2">
												<div>
													<span className="text-[10px] font-black text-gray-400 uppercase tracking-tighter block mb-0.5">{payment.paymentDate}</span>
													<h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">{payment.name}</h3>
												</div>
												<span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest
													${isRefund ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400' :
														isDamage ? 'bg-orange-50 text-orange-600 dark:bg-orange-900/30' :
															isLate ? 'bg-yellow-50 text-yellow-600 dark:bg-yellow-900/30' :
																'bg-green-50 text-green-600 dark:bg-green-900/30'}`}>
													{status}
												</span>
											</div>

											<div className="flex items-center justify-between mb-2">
												<span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tight 
													${getTypeBadgeStyle(payment.paymentType ?? payment.payment_type)}`}>
													{getTypeLabel(payment.paymentType ?? payment.payment_type)}
												</span>
												<span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">RM {payment.room || 'N/A'}</span>
											</div>

											<div className={`text-xl font-black text-right ${isRefund ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
												₱{formatAmt(payment.amount)}
											</div>
										</div>
									)
								})
							)}
						</div>
					</div>

					{/* Pagination Section */}
					{totalPages > 1 && (
						<div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-4 px-2">
							<p className="text-xs font-bold text-gray-500 uppercase tracking-widest">
								Showing {start + 1}–{Math.min(start + pageSize, filteredPayments.length)} <span className="text-gray-300 mx-1">/</span> {filteredPayments.length} Total
							</p>
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
									disabled={pageIndex <= 1}
									className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-bold uppercase tracking-widest text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm"
								>
									Prev
								</button>
								<div className="px-4 py-2 bg-gray-100 dark:bg-gray-900 rounded-xl">
									<span className="text-xs font-black text-gray-900 dark:text-white">{pageIndex} <span className="text-gray-400 font-medium">of</span> {totalPages}</span>
								</div>
								<button
									type="button"
									onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
									disabled={pageIndex >= totalPages}
									className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-bold uppercase tracking-widest text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm"
								>
									Next
								</button>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}

function getTypeBadgeStyle(type) {
	const t = (type ?? '').toString().toLowerCase().trim()
	if (t === 'rent' || t === 'monthly_rent' || t === 'monthly rent') return 'bg-sky-50 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
	if (t === 'advance') return 'bg-purple-50 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
	if (t === 'deposit') return 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
	if (t.includes('refund')) return 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300'
	if (t.includes('damage')) return 'bg-orange-50 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
	return 'bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
}

export default RentCollectedListView

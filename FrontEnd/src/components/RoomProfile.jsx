import { useState, useEffect, useMemo } from 'react'
import { authFetch } from '../auth.js'

function formatRoomDisplay(room) {
	const number = room?.number ?? ''
	const type = room?.type || 'room'
	const section = room?.section ?? ''
	if (type === 'commercial') return `C${number}`
	if (section) return `${section.charAt(0).toUpperCase()}${number}`
	return `No.${number}`
}

const ITEMS_PER_PAGE = 10

const RoomProfile = ({ property, room: rawRoom, roomDisplay, onBack, onViewTenantProfile }) => {
	const [room, setRoom] = useState(rawRoom)
	const [paymentPage, setPaymentPage] = useState(1)

	useEffect(() => {
		setRoom(rawRoom)
	}, [rawRoom])

	if (!property || !room) {
		return (
			<div className="w-full h-full flex items-center justify-center bg-gray-50 dark:bg-gray-900">
				<p className="text-gray-500 dark:text-gray-400">No room data</p>
			</div>
		)
	}

	const displayName = roomDisplay || formatRoomDisplay(room)
	const currentTenant = room.tenant
	const transactions = room.transactions && Array.isArray(room.transactions) ? room.transactions : []

	// Tenant history: current tenant + unique tenants from payment history (by tenant_id/name)
	const tenantHistoryRows = []
	if (currentTenant && room.status === 'occupied') {
		tenantHistoryRows.push({
			tenant_id: currentTenant.tenant_id ?? currentTenant.id,
			name: currentTenant.full_name || currentTenant.name || 'N/A',
			date_started: currentTenant.move_in || currentTenant.date_of_occupancy || '—',
			due_per_month: parseFloat(room.payment) || 0,
			room_no: displayName,
			is_current: true
		})
	}
	const seenIds = new Set(tenantHistoryRows.map(r => String(r.tenant_id)))
	transactions.forEach(tx => {
		const tid = tx.tenant_id ?? tx.id
		const name = tx.name || tx.tenant_name || 'N/A'
		if (tid != null && !seenIds.has(String(tid))) {
			seenIds.add(String(tid))
			tenantHistoryRows.push({
				tenant_id: tid,
				name,
				date_started: tx.date || tx.timestamp || '—',
				due_per_month: parseFloat(tx.amount) || 0,
				room_no: tx.room_no ?? displayName,
				is_current: false
			})
		}
	})
	// Sort: current first, then by date desc
	tenantHistoryRows.sort((a, b) => {
		if (a.is_current) return -1
		if (b.is_current) return 1
		const dA = new Date(a.date_started)
		const dB = new Date(b.date_started)
		return isNaN(dB) ? -1 : isNaN(dA) ? 1 : dB - dA
	})

	// Payment history: from room transactions, sorted by date desc
	const paymentHistoryRows = useMemo(() => {
		return [...transactions].sort((a, b) => {
			const dA = new Date(a.date || a.timestamp)
			const dB = new Date(b.date || b.timestamp)
			return dB - dA
		})
	}, [transactions])

	// Pagination for payment history
	const totalPaymentPages = Math.ceil(paymentHistoryRows.length / ITEMS_PER_PAGE)
	const paginatedPayments = useMemo(() => {
		const start = (paymentPage - 1) * ITEMS_PER_PAGE
		return paymentHistoryRows.slice(start, start + ITEMS_PER_PAGE)
	}, [paymentHistoryRows, paymentPage])

	// Reset page when room changes
	useEffect(() => {
		setPaymentPage(1)
	}, [rawRoom])

	const formatDate = (d) => {
		if (!d) return '—'
		try {
			const date = new Date(d)
			return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
		} catch {
			return String(d)
		}
	}

	const formatPaymentDate = (d) => {
		if (!d) return '—'
		try {
			const date = new Date(d)
			return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
		} catch {
			return String(d)
		}
	}

	// Additional helper functions for PDF generation
	const escapeHtml = (text) => {
		if (!text) return ''
		const div = document.createElement('div')
		div.textContent = text
		return div.innerHTML
	}

	const formatCurrency = (amount) => {
		return parseFloat(amount || 0).toLocaleString('en-PH', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		})
	}

	const formatDateShort = (dateStr) => {
		if (!dateStr) return 'N/A'
		try {
			const date = new Date(dateStr)
			return date.toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric',
				year: 'numeric'
			})
		} catch (e) {
			return 'Invalid Date'
		}
	}

	// Generate PDF for room ledger
	const generateRoomLedgerPDF = () => {
		const propertyName = property?.propertyName || property?.name || 'Property'
		const propertyAddress = property?.address || ''
		const roomNumber = formatRoomDisplay(room)
		const roomStatus = room?.status || 'N/A'

		// Print timestamp
		const printTimestamp = new Date().toLocaleString('en-US', {
			dateStyle: 'medium',
			timeStyle: 'short'
		})

		// Current occupant info
		const currentTenant = room?.tenant
		const currentTenantName = currentTenant?.full_name || 'Vacant'
		const currentTenantId = currentTenant?.tenant_id || 'N/A'
		const currentMoveIn = currentTenant?.move_in ? formatDateShort(currentTenant.move_in) : 'N/A'
		const currentRent = formatCurrency(room?.payment)

		// Generate occupancy history rows
		const occupancyRows = tenantHistoryRows.length === 0
			? '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #999;">No occupancy history</td></tr>'
			: tenantHistoryRows.map(occupant => `
					<tr>
						<td><strong>${escapeHtml(occupant.name)}</strong> ${occupant.is_current ? '<span style="background: #dcfce7; color: #15803d; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; margin-left: 8px;">CURRENT</span>' : ''}</td>
						<td style="font-family: monospace;">#${occupant.tenant_id}</td>
						<td>${formatDateShort(occupant.date_started)}</td>
						<td class="num">₱${formatCurrency(occupant.due_per_month)}</td>
					</tr>
				`).join('')

		// Generate transaction history rows (use ALL transactions, not paginated)
		const transactionRows = paymentHistoryRows.length === 0
			? '<tr><td colspan="5" style="text-align: center; padding: 20px; color: #999;">No transactions recorded</td></tr>'
			: paymentHistoryRows.map(tx => {
				const txDate = tx.date || tx.timestamp || ''
				const txName = tx.name || tx.tenant_name || 'N/A'
				const txAmount = parseFloat(tx.amount?.toString().replace(/,/g, '')) || 0
				const txType = tx.payment_type || tx.type || 'N/A'
				const txPeriod = tx.period || formatPaymentDate(txDate)
				return `
					<tr>
						<td>${formatDateShort(txDate)}</td>
						<td>${escapeHtml(txName)}</td>
						<td>${txPeriod}</td>
						<td style="font-size: 0.7rem; color: #666;">${escapeHtml(txType)}</td>
						<td class="num">₱${formatCurrency(txAmount)}</td>
					</tr>
				`
			}).join('')

		// Calculate summary statistics
		const totalPayments = paymentHistoryRows.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0)
		const numberOfOccupants = tenantHistoryRows.length
		const averageRent = tenantHistoryRows.length > 0
			? tenantHistoryRows.reduce((sum, o) => sum + (parseFloat(o.due_per_month) || 0), 0) / tenantHistoryRows.length
			: 0

		// Build complete HTML
		const html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>${escapeHtml(propertyName)} - Room ${escapeHtml(roomNumber)} Ledger</title>
	<style>
		body {
			font-family: system-ui, -apple-system, sans-serif;
			padding: 20px;
			color: #111;
			max-width: 1000px;
			margin: 0 auto;
			background: #fff;
		}
		h1 {
			font-size: 1.5rem;
			margin-bottom: 0.5rem;
			color: #111;
			font-weight: 700;
		}
		.meta {
			color: #666;
			font-size: 0.9rem;
			margin-bottom: 24px;
			line-height: 1.5;
		}
		.section {
			margin-bottom: 28px;
			break-inside: avoid;
		}
		.section-title {
			font-size: 1rem;
			margin-bottom: 12px;
			font-weight: 600;
			color: #333;
		}
		.card {
			background: #f9fafb;
			border: 1px solid #e5e7eb;
			border-radius: 8px;
			padding: 16px;
			margin-bottom: 20px;
		}
		.card-row {
			display: flex;
			justify-content: space-between;
			padding: 6px 0;
			font-size: 0.9rem;
		}
		table {
			width: 100%;
			border-collapse: collapse;
			font-size: 0.85rem;
		}
		table th, table td {
			border: 1px solid #ccc;
			padding: 8px 10px;
			text-align: left;
			word-break: break-word;
		}
		table th {
			background: #2d5016;
			color: #fff;
			font-weight: 600;
			text-transform: uppercase;
			font-size: 0.75rem;
			letter-spacing: 0.5px;
		}
		table tbody tr:nth-child(even) {
			background: #f9f9f9;
		}
		.num {
			text-align: right;
			font-variant-numeric: tabular-nums;
		}
		.text-red {
			color: #dc2626;
		}
		.summary {
			margin-top: 24px;
			padding: 16px;
			background: #f5f5f5;
			border-radius: 8px;
			border: 2px solid #2d5016;
		}
		.summary-row {
			display: flex;
			justify-content: space-between;
			padding: 6px 0;
			font-size: 0.9rem;
		}
		.summary-row.total {
			font-weight: 700;
			font-size: 1rem;
			border-top: 2px solid #333;
			padding-top: 12px;
			margin-top: 8px;
		}
		@media print {
			body { padding: 12px; }
			table { font-size: 0.75rem; }
			table th, table td { padding: 6px 8px; }
		}
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
	<h1>${escapeHtml(propertyName)}</h1>
	${propertyAddress ? `<div style="color: #666; font-size: 0.9rem; margin-bottom: 8px;">${escapeHtml(propertyAddress)}</div>` : ''}
	<div class="meta">
		<div><strong>Report:</strong> Room Ledger</div>
		<div><strong>Room:</strong> ${escapeHtml(roomNumber)}</div>
		<div><strong>Status:</strong> ${roomStatus.toUpperCase()}</div>
		<div><strong>Generated:</strong> ${printTimestamp}</div>
	</div>

	<div class="section">
		<h2 class="section-title">Current Occupant</h2>
		<div class="card">
			<div class="card-row">
				<span>Tenant Name:</span>
				<span><strong>${escapeHtml(currentTenantName)}</strong></span>
			</div>
			<div class="card-row">
				<span>Tenant ID:</span>
				<span>${currentTenantId}</span>
			</div>
			<div class="card-row">
				<span>Move-in Date:</span>
				<span>${currentMoveIn}</span>
			</div>
			<div class="card-row">
				<span>Monthly Rent:</span>
				<span>₱${currentRent}</span>
			</div>
		</div>
	</div>

	<div class="section">
		<h2 class="section-title">Occupancy History</h2>
		<table>
			<thead>
				<tr>
					<th>Tenant Name</th>
					<th>Tenant ID</th>
					<th>Date Started</th>
					<th class="num">Monthly Rent</th>
				</tr>
			</thead>
			<tbody>
				${occupancyRows}
			</tbody>
		</table>
	</div>

	<div class="section">
		<h2 class="section-title">Transaction Ledger</h2>
		<table>
			<thead>
				<tr>
					<th>Date</th>
					<th>Payer Name</th>
					<th>Period</th>
					<th>Type</th>
					<th class="num">Amount</th>
				</tr>
			</thead>
			<tbody>
				${transactionRows}
			</tbody>
		</table>
	</div>

	${paymentHistoryRows.length > 0 || tenantHistoryRows.length > 0 ? `
	<div class="summary">
		<div class="summary-row">
			<span>Total Payments Received:</span>
			<span>₱${formatCurrency(totalPayments)}</span>
		</div>
		<div class="summary-row">
			<span>Number of Occupants:</span>
			<span>${numberOfOccupants}</span>
		</div>
		<div class="summary-row total">
			<span>Average Monthly Rent:</span>
			<span>₱${formatCurrency(averageRent)}</span>
		</div>
	</div>
	` : ''}
</body>
</html>`

		// Open new window and inject HTML
		const w = window.open('', '_blank')
		if (!w) {
			alert('Please allow pop-ups to print or save as PDF.')
			return
		}
		w.document.write(html)
		w.document.close()
		w.focus()
	}

	return (
		<div className="w-full h-full flex flex-col bg-gray-50 dark:bg-gray-900 font-sans">
			{/* Sticky Header */}
			<div className="sticky top-0 z-30 bg-white/80 dark:bg-gray-800/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-700 px-4 md:px-6 py-4">
				<div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
						<div className="min-w-0">
							<h1 className="text-lg md:text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight truncate">
								{property?.propertyName ?? property?.name ?? 'Room Profile'}
							</h1>
							<div className="flex items-center gap-2 mt-0.5">
								<span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse flex-shrink-0"></span>
								<p className="text-[9px] md:text-xs font-bold text-gray-400 uppercase tracking-widest leading-none truncate">Detailed Unit Analytics</p>
							</div>
						</div>
					</div>

					<button
						type="button"
						onClick={generateRoomLedgerPDF}
						className="w-full sm:w-auto px-6 py-2.5 bg-gray-900 dark:bg-gray-700 hover:bg-black dark:hover:bg-gray-600 text-white rounded-xl font-bold transition-all flex items-center justify-center space-x-2 shadow-lg shadow-black/10 dark:shadow-none"
					>
						<svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
						</svg>
						<span className="text-sm">Print Ledger</span>
					</button>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 pb-20 md:pb-6">
				<div className="max-w-7xl mx-auto space-y-6">
					{/* Room Info Hero */}
					<div className="relative overflow-hidden bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 md:p-8">
						<div className="absolute top-0 right-0 p-8 opacity-5">
							<svg className="w-32 h-32" fill="currentColor" viewBox="0 0 24 24"><path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
						</div>

						<div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
							<div className="min-w-0">
								<div className="flex flex-wrap items-center gap-3 mb-2">
									<h2 className="text-2xl md:text-4xl font-black text-gray-900 dark:text-white uppercase tracking-tighter">Room {displayName}</h2>
									<span className={`px-3 py-1 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest ${room.status === 'occupied' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' :
										room.status === 'maintenance' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' :
											'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'
										}`}>
										{room.status}
									</span>
								</div>
								<p className="text-[11px] md:text-sm font-bold text-gray-400 uppercase tracking-widest truncate">
									{property.propertyName ?? property.name} {property.address ? `• ${property.address}` : ''}
								</p>
							</div>

							<div className="bg-gray-50 dark:bg-gray-900/50 p-4 md:p-6 rounded-2xl border border-gray-100 dark:border-gray-700 min-w-0 md:min-w-[240px]">
								<p className="text-[9px] md:text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 md:mb-2">Current Occupant</p>
								{currentTenant ? (
									<div className="space-y-1">
										{onViewTenantProfile ? (
											<button
												onClick={() => onViewTenantProfile(currentTenant.tenant_id ?? currentTenant.id)}
												className="text-base md:text-lg font-black text-blue-600 dark:text-blue-400 hover:underline text-left block truncate"
											>
												{currentTenant.full_name || currentTenant.name}
											</button>
										) : (
											<span className="text-base md:text-lg font-black text-gray-900 dark:text-white block truncate">
												{currentTenant.full_name || currentTenant.name}
											</span>
										)}
										<span className="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-widest block">
											Due: ₱{(parseFloat(room.payment) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })} / Mo
										</span>
									</div>
								) : (
									<span className="text-base md:text-lg font-black text-gray-300 dark:text-gray-600 uppercase italic">Vacant Unit</span>
								)}
							</div>
						</div>
					</div>

					{/* Tenant History Section */}
					<div className="bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
						<div className="px-6 py-4 border-b border-gray-50 dark:border-gray-700/50 flex items-center justify-between">
							<div className="flex items-center gap-2">
								<div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
								<h3 className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest">Occupancy History</h3>
							</div>
							<span className="text-[10px] font-black text-gray-300 dark:text-gray-600 uppercase tracking-widest">{tenantHistoryRows.length} Tenants</span>
						</div>

						<div className="hidden md:block overflow-x-auto">
							<table className="w-full text-left">
								<thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-50 dark:border-gray-700/30">
									<tr>
										<th className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">ID</th>
										<th className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Full Name</th>
										<th className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest text-center">Date Started</th>
										<th className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest text-right">Monthly Rent</th>
										<th className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest text-right">Action</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
									{tenantHistoryRows.length === 0 ? (
										<tr><td colSpan="5" className="px-6 py-12 text-center text-gray-400 font-bold uppercase tracking-widest text-xs italic">No History Available</td></tr>
									) : (
										tenantHistoryRows.map((row, idx) => (
											<tr key={idx} className="group hover:bg-blue-50/30 dark:hover:bg-blue-900/5 transition-colors">
												<td className="px-6 py-4 font-mono text-xs text-gray-400 dark:text-gray-500">#{row.tenant_id}</td>
												<td className="px-6 py-4">
													{onViewTenantProfile && row.tenant_id ? (
														<button onClick={() => onViewTenantProfile(row.tenant_id)} className="text-sm font-bold text-gray-900 dark:text-gray-300 hover:text-blue-600 transition-colors">
															{row.name}
															{row.is_current && <span className="ml-2 px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 text-[8px] font-black uppercase rounded">Current</span>}
														</button>
													) : (
														<span className="text-sm font-bold text-gray-900 dark:text-gray-300">{row.name}</span>
													)}
												</td>
												<td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 text-center font-medium">
													{formatDate(row.date_started)}
												</td>
												<td className="px-6 py-4 text-sm font-black text-gray-900 dark:text-white text-right">
													₱{(row.due_per_month || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
												</td>
												<td className="px-6 py-4 text-right">
													{onViewTenantProfile && row.tenant_id && (
														<button onClick={() => onViewTenantProfile(row.tenant_id)} className="p-2 hover:bg-white dark:hover:bg-gray-700 rounded-lg shadow-sm transition-all text-gray-400 hover:text-blue-600">
															<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
															</svg>
														</button>
													)}
												</td>
											</tr>
										))
									)}
								</tbody>
							</table>
						</div>

						{/* Mobile View: Cards */}
						<div className="md:hidden divide-y divide-gray-50 dark:divide-gray-700/50 px-4">
							{tenantHistoryRows.length === 0 ? (
								<p className="py-8 text-center text-gray-400 font-bold uppercase tracking-widest text-[10px] italic">No History Available</p>
							) : (
								tenantHistoryRows.map((row, idx) => (
									<div key={idx} className="py-4 space-y-3">
										<div className="flex items-start justify-between">
											<div>
												<p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">#{row.tenant_id}</p>
												<h4 className="text-sm font-black text-gray-900 dark:text-white flex items-center gap-2">
													{row.name}
													{row.is_current && <span className="px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 text-[8px] font-black uppercase rounded">Current</span>}
												</h4>
											</div>
											<div className="text-right">
												<p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Rent</p>
												<p className="text-xs font-black text-gray-900 dark:text-white">₱{(row.due_per_month || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
											</div>
										</div>
										<div className="flex items-center justify-between">
											<div>
												<p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Started</p>
												<p className="text-[11px] font-bold text-gray-600 dark:text-gray-400">{formatDate(row.date_started)}</p>
											</div>
											{onViewTenantProfile && row.tenant_id && (
												<button
													onClick={() => onViewTenantProfile(row.tenant_id)}
													className="px-3 py-1.5 bg-gray-50 dark:bg-gray-700/50 text-blue-600 dark:text-blue-400 rounded-lg text-[10px] font-black uppercase tracking-widest border border-gray-100 dark:border-gray-600"
												>
													View
												</button>
											)}
										</div>
									</div>
								))
							)}
						</div>
					</div>

				{/* Transaction History Section — extra spacing to differentiate from Occupancy History */}
				<div className="mt-10 md:mt-12 bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
					<div className="px-6 py-4 border-b border-gray-50 dark:border-gray-700/50 flex items-center justify-between">
						<div className="flex items-center gap-2">
							<div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
							<h3 className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest">Transaction History</h3>
						</div>
						<span className="text-[10px] font-black text-gray-300 dark:text-gray-600 uppercase tracking-widest">{paymentHistoryRows.length} Ledger Records</span>
					</div>

					<div className="hidden md:block overflow-x-auto">
						<table className="w-full text-left">
							<thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-50 dark:border-gray-700/30">
								<tr>
									<th className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Payer Name</th>
									<th className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest text-center">Period</th>
									<th className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest text-right">Credit</th>
									<th className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest text-center">Status</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
								{paginatedPayments.length === 0 ? (
									<tr><td colSpan="4" className="px-6 py-12 text-center text-gray-400 font-bold uppercase tracking-widest text-xs italic">No Records Found</td></tr>
								) : (
									paginatedPayments.map((tx, idx) => {
										const isRefund = (tx.payment_type || tx.paymentType || '').toString().toLowerCase().includes('refund')
										const isLate = tx.is_late === true || tx.status?.toLowerCase() === 'late'
										const status = isRefund ? 'Refunded' : isLate ? 'Late Paid' : 'Settled'
										return (
											<tr key={idx} className="hover:bg-green-50/30 dark:hover:bg-green-900/5 transition-colors">
												<td className="px-6 py-4">
													<span className="text-sm font-bold text-gray-900 dark:text-gray-300">{tx.name || tx.tenant_name}</span>
													<p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{tx.payment_type || tx.paymentType || 'Rent'}</p>
												</td>
												<td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 text-center font-medium">
													{formatPaymentDate(tx.date || tx.timestamp)}
												</td>
												<td className={`px-6 py-4 text-sm font-black text-right ${isRefund ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>
													{isRefund ? '-' : ''}₱{(parseFloat(tx.amount?.toString().replace(/,/g, '')) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
												</td>
												<td className="px-6 py-4 text-center">
													<span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${isRefund ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' :
														isLate ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' :
															'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
														}`}>
														{status}
													</span>
												</td>
											</tr>
										)
									})
								)}
							</tbody>
						</table>
					</div>

					{/* Mobile View: Transaction Cards */}
					<div className="md:hidden divide-y divide-gray-50 dark:divide-gray-700/50 px-4">
						{paginatedPayments.length === 0 ? (
							<p className="py-8 text-center text-gray-400 font-bold uppercase tracking-widest text-[10px] italic">No Records Found</p>
						) : (
							paginatedPayments.map((tx, idx) => {
								const isRefund = (tx.payment_type || tx.paymentType || '').toString().toLowerCase().includes('refund')
								const isLate = tx.is_late === true || tx.status?.toLowerCase() === 'late'
								const status = isRefund ? 'Refunded' : isLate ? 'Late Paid' : 'Settled'
								return (
									<div key={idx} className="py-4 space-y-3">
										<div className="flex items-start justify-between">
											<div>
												<h4 className="text-sm font-black text-gray-900 dark:text-white">{tx.name || tx.tenant_name}</h4>
												<p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{tx.payment_type || tx.paymentType || 'Rent'}</p>
											</div>
											<div className="text-right">
												<p className={`text-xs font-black ${isRefund ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>
													{isRefund ? '-' : ''}₱{(parseFloat(tx.amount?.toString().replace(/,/g, '')) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
												</p>
												<span className={`inline-block px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest mt-1 ${isRefund ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' :
													isLate ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' :
														'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
													}`}>
													{status}
												</span>
											</div>
										</div>
										<div className="flex items-center justify-between">
											<div>
												<p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Period</p>
												<p className="text-[11px] font-bold text-gray-600 dark:text-gray-400">{formatPaymentDate(tx.date || tx.timestamp)}</p>
											</div>
										</div>
									</div>
								)
							})
						)}
					</div>

					{/* Pagination */}
					{totalPaymentPages > 1 && (
						<div className="px-6 py-4 border-t border-gray-50 dark:border-gray-700/50 flex flex-col sm:flex-row items-center justify-between gap-4">
							<p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
								Record {((paymentPage - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(paymentPage * ITEMS_PER_PAGE, paymentHistoryRows.length)} of {paymentHistoryRows.length}
							</p>
							<div className="flex items-center gap-1.5">
								<button
									disabled={paymentPage === 1}
									onClick={() => setPaymentPage(p => Math.max(1, p - 1))}
									className="p-1.5 bg-gray-50 dark:bg-gray-900 text-gray-400 dark:text-gray-600 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed hover:text-orange-600 transition-colors"
								>
									<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
								</button>
								<div className="flex items-center gap-1">
									{Array.from({ length: totalPaymentPages }, (_, i) => i + 1).map(page => {
										const show = page === 1 || page === totalPaymentPages || Math.abs(page - paymentPage) <= 1
										if (!show) return page === 2 || page === totalPaymentPages - 1 ? <span key={page} className="px-1 text-gray-300">...</span> : null
										return (
											<button
												key={page}
												onClick={() => setPaymentPage(page)}
												className={`w-7 h-7 text-[10px] font-black rounded-lg transition-all ${page === paymentPage ? 'bg-orange-500 text-white shadow-lg' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
													}`}
											>
												{page}
											</button>
										)
									})}
								</div>
								<button
									disabled={paymentPage === totalPaymentPages}
									onClick={() => setPaymentPage(p => Math.min(totalPaymentPages, p + 1))}
									className="p-1.5 bg-gray-50 dark:bg-gray-900 text-gray-400 dark:text-gray-600 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed hover:text-orange-600 transition-colors"
								>
									<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
								</button>
							</div>
						</div>
					)}
				</div>
				</div>
			</div>
		</div>
	)
}

export default RoomProfile

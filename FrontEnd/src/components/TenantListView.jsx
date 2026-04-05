import { useState, useEffect } from 'react'
import { authFetch } from '../auth.js'
import TenantProfile from './TenantProfile.jsx'

const TenantListView = ({ property, onBack, onAddTenant }) => {
	const [activeTenants, setActiveTenants] = useState([]) // Current tenants from layouts
	const [inactiveTenants, setInactiveTenants] = useState([]) // Previous/inactive tenants
	const [filteredTenants, setFilteredTenants] = useState([])
	const [loading, setLoading] = useState(true)
	const [loadingInactive, setLoadingInactive] = useState(false)
	const [showPrevious, setShowPrevious] = useState(false)
	const [inactiveLoaded, setInactiveLoaded] = useState(false)
	const [searchQuery, setSearchQuery] = useState('')
	const [sortField, setSortField] = useState('tenant_id')
	const [sortOrder, setSortOrder] = useState('desc')
	const [viewingTenant, setViewingTenant] = useState(null)
	const [showPrintModal, setShowPrintModal] = useState(false)
	const [printFilter, setPrintFilter] = useState('all') // 'all' | 'active' | 'timeframe'
	const [printDateRange, setPrintDateRange] = useState({ from: '', to: '' })
	const [exporting, setExporting] = useState(false)
	const [currentPage, setCurrentPage] = useState(1)
	const PAGE_SIZE = 50

	// Initial load - only fetch active tenants from layouts
	useEffect(() => {
		if (property) {
			fetchActiveTenants()
		}
	}, [property])

	// Lazy load inactive tenants when "Show Previous" is checked
	useEffect(() => {
		if (showPrevious && !inactiveLoaded && !loadingInactive) {
			fetchInactiveTenants()
		}
	}, [showPrevious])

	// Filter and sort when data or filters change
	useEffect(() => {
		filterAndSortTenants()
		setCurrentPage(1)
	}, [activeTenants, inactiveTenants, searchQuery, sortField, sortOrder, showPrevious])

	// Fetch only active tenants from property layouts (fast)
	const fetchActiveTenants = async () => {
		setLoading(true)
		try {
			const propertyRes = await authFetch(`/api/properties/${property.id}/layouts/`)
			if (!propertyRes.ok) {
				throw new Error('Failed to fetch property data')
			}
			const propertyData = await propertyRes.json()
			const layouts = propertyData.layouts || {}

			// Extract all rooms from all layout variants
			const allRooms = []
			if (typeof layouts === 'object') {
				for (const variant in layouts) {
					const rooms = layouts[variant]
					if (Array.isArray(rooms)) {
						allRooms.push(...rooms)
					}
				}
			}

			// Helper function to format room number
			const formatRoomNumber = (room) => {
				const number = room.number || ''
				const type = room.type || 'room'
				const section = room.section || ''

				if (type === 'commercial') return `C${number}`
				if (section) return `${section.charAt(0).toUpperCase()}${number}`
				return number
			}

			// Collect current tenants from rooms
			const tenantsList = []
			allRooms.forEach(room => {
				if (room.tenant && room.status === 'occupied') {
					const tenantId = room.tenant.tenant_id || room.tenant.id
					const roomDisplay = formatRoomNumber(room)
					tenantsList.push({
						tenant_id: tenantId,
						full_name: room.tenant.full_name || room.tenant.name || 'N/A',
						email: room.tenant.email || '',
						phone: room.tenant.phone || '',
						move_in: room.tenant.move_in || room.tenant.date_of_occupancy || room.tenant.created_at || new Date().toISOString(),
						payment: parseFloat(room.payment) || 0,
						unit_number: roomDisplay,
						status: 'active',
						blacklisted: room.tenant.blacklisted || false
					})
				}
			})

			setActiveTenants(tenantsList)
		} catch (error) {
			console.error('Error fetching active tenants:', error)
		} finally {
			setLoading(false)
		}
	}

	// Fetch inactive tenants only when needed (lazy load, all pages)
	const fetchInactiveTenants = async () => {
		setLoadingInactive(true)
		try {
			const activeTenantIds = new Set(activeTenants.map(t => t.tenant_id))
			const allInactive = []
			let page = 1
			while (true) {
				const res = await authFetch(`/api/tenants/?status=inactive&page=${page}&page_size=200`)
				if (!res.ok) throw new Error('Failed to fetch inactive tenants')
				const data = await res.json()
				const results = Array.isArray(data) ? data : (data.results || [])
				results.forEach(tenant => {
					if (!activeTenantIds.has(tenant.tenant_id || tenant.id)) {
						allInactive.push({
							tenant_id: tenant.tenant_id || tenant.id,
							full_name: tenant.full_name || tenant.name || 'N/A',
							email: tenant.email || '',
							phone: tenant.phone || '',
							move_in: tenant.move_in || tenant.date_of_occupancy || tenant.created_at || new Date().toISOString(),
							payment: parseFloat(tenant.payment) || parseFloat(tenant.last_payment) || 0,
							unit_number: tenant.last_room || 'N/A',
							status: 'inactive',
							blacklisted: tenant.blacklisted || false
						})
					}
				})
				// Stop if no next page
				if (Array.isArray(data) || !data.next) break
				page++
			}
			setInactiveTenants(allInactive)
			setInactiveLoaded(true)
		} catch (error) {
			console.error('Error fetching inactive tenants:', error)
		} finally {
			setLoadingInactive(false)
		}
	}

	const filterAndSortTenants = () => {
		// Combine active tenants with inactive tenants (if loaded and showing)
		let result = [...activeTenants]
		if (showPrevious && inactiveLoaded) {
			result = [...activeTenants, ...inactiveTenants]
		}

		// Filter by search query (tenant_id, name, email, phone, room)
		if (searchQuery) {
			const query = searchQuery.toLowerCase()
			result = result.filter(t =>
				t.full_name?.toLowerCase().includes(query) ||
				t.tenant_id?.toString().includes(searchQuery) ||
				t.unit_number?.toString().toLowerCase().includes(query) ||
				t.email?.toLowerCase().includes(query) ||
				t.phone?.toLowerCase().includes(query)
			)
		}

		// Sort
		result.sort((a, b) => {
			let aVal = a[sortField]
			let bVal = b[sortField]

			if (sortField === 'payment' || sortField === 'monthly_rent') {
				aVal = parseFloat(aVal) || 0
				bVal = parseFloat(bVal) || 0
			}

			if (sortOrder === 'asc') {
				return aVal > bVal ? 1 : -1
			} else {
				return aVal < bVal ? 1 : -1
			}
		})

		setFilteredTenants(result)
	}

	const handleSort = (field) => {
		if (sortField === field) {
			setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
		} else {
			setSortField(field)
			setSortOrder('asc')
		}
	}

	const totalPages = Math.ceil(filteredTenants.length / PAGE_SIZE)
	const pagedTenants = filteredTenants.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

	// Count active tenants
	const currentTenantsCount = activeTenants.length

	// Print handler
	const handlePrint = () => {
		setShowPrintModal(false)
		const tenantsToPrint = getPrintableTenants()
		generateTenantListPDF(tenantsToPrint)
	}

	// Get tenants to print based on filter
	const getPrintableTenants = () => {
		if (printFilter === 'all') {
			return [...activeTenants, ...inactiveTenants]
		}
		if (printFilter === 'active') {
			return activeTenants
		}
		if (printFilter === 'timeframe' && printDateRange.from && printDateRange.to) {
			const fromDate = new Date(printDateRange.from)
			const toDate = new Date(printDateRange.to)
			toDate.setHours(23, 59, 59, 999)
			const allTenants = [...activeTenants, ...inactiveTenants]
			return allTenants.filter(t => {
				const moveIn = new Date(t.move_in)
				return moveIn >= fromDate && moveIn <= toDate
			})
		}
		return [...activeTenants, ...inactiveTenants]
	}

	// Helper functions for PDF generation
	const escapeHtml = (text) => {
		if (!text) return ''
		const div = document.createElement('div')
		div.textContent = text
		return div.innerHTML
	}

	const formatDate = (dateStr) => {
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

	const formatCurrency = (amount) => {
		return parseFloat(amount || 0).toLocaleString('en-PH', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		})
	}

	// Generate PDF for tenant list
	const generateTenantListPDF = (tenants) => {
		const propertyName = property?.propertyName || 'Property'

		// Build filter description
		const getFilterDescription = () => {
			if (printFilter === 'active') {
				return 'Active Tenants Only'
			}
			if (printFilter === 'timeframe' && printDateRange.from && printDateRange.to) {
				const fromDate = new Date(printDateRange.from).toLocaleDateString('en-US', {
					month: 'long', day: 'numeric', year: 'numeric'
				})
				const toDate = new Date(printDateRange.to).toLocaleDateString('en-US', {
					month: 'long', day: 'numeric', year: 'numeric'
				})
				return `Tenants who moved in between ${fromDate} and ${toDate}`
			}
			return 'All Tenants'
		}
		const filterDescription = getFilterDescription()

		// Print timestamp
		const printTimestamp = new Date().toLocaleString('en-US', {
			dateStyle: 'medium',
			timeStyle: 'short'
		})

		// Calculate summary statistics
		const totalTenants = tenants.length
		const totalMonthlyRent = tenants.reduce((sum, t) => sum + (parseFloat(t.payment) || 0), 0)
		const averageRent = totalTenants > 0 ? totalMonthlyRent / totalTenants : 0
		const activeCount = tenants.filter(t => t.status === 'active').length
		const inactiveCount = totalTenants - activeCount
		const blacklistedCount = tenants.filter(t => t.blacklisted).length

		// Generate table rows
		const tableRows = totalTenants === 0
			? '<tr><td colspan="7" style="text-align: center; padding: 40px; color: #999;">No tenants match the selected criteria</td></tr>'
			: tenants.map(tenant => `
				<tr>
					<td style="font-family: monospace;">#${tenant.tenant_id}</td>
					<td><strong>${escapeHtml(tenant.full_name)}</strong></td>
					<td>${escapeHtml(tenant.phone || 'N/A')}</td>
					<td style="font-weight: 600;">${escapeHtml(tenant.unit_number)}</td>
					<td>${formatDate(tenant.move_in)}</td>
					<td class="num">₱${formatCurrency(tenant.payment)}</td>
					<td class="center">
						<span class="${tenant.status === 'active' ? 'status-active' : 'status-inactive'}">
							${tenant.status.toUpperCase()}
						</span>
						${tenant.blacklisted ? '<br/><span class="blacklisted">⊗ BLACKLISTED</span>' : ''}
					</td>
				</tr>
			`).join('')

		// Conditional summary elements
		const activeInactiveSummary = (activeCount > 0 && inactiveCount > 0) ? `
			<div class="summary-row">
				<span>Active Tenants:</span>
				<span>${activeCount}</span>
			</div>
			<div class="summary-row">
				<span>Inactive Tenants:</span>
				<span>${inactiveCount}</span>
			</div>
		` : ''

		const blacklistedSummary = blacklistedCount > 0 ? `
			<div class="summary-row">
				<span>Blacklisted Tenants:</span>
				<span class="blacklisted">${blacklistedCount}</span>
			</div>
		` : ''

		// Build complete HTML
		const html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>${escapeHtml(propertyName)} - Tenant List</title>
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
		table tbody tr:hover {
			background: #f0f0f0;
		}
		.num {
			text-align: right;
			font-variant-numeric: tabular-nums;
		}
		.center {
			text-align: center;
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
		.blacklisted {
			color: #dc2626;
			font-weight: 600;
		}
		.status-active {
			color: #16a34a;
			font-weight: 600;
		}
		.status-inactive {
			color: #6b7280;
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
	<div class="meta">
		<div><strong>Report:</strong> Tenant List</div>
		<div><strong>Filter:</strong> ${filterDescription}</div>
		<div><strong>Generated:</strong> ${printTimestamp}</div>
	</div>

	<div class="section">
		<table>
			<thead>
				<tr>
					<th>ID</th>
					<th>Tenant Name</th>
					<th>Phone</th>
					<th>Room</th>
					<th>Move-in Date</th>
					<th class="num">Monthly Rent</th>
					<th class="center">Status</th>
				</tr>
			</thead>
			<tbody>
				${tableRows}
			</tbody>
		</table>
	</div>

	${totalTenants > 0 ? `
	<div class="summary">
		<h2 class="section-title">Summary</h2>
		<div class="summary-row">
			<span>Total Tenants:</span>
			<span><strong>${totalTenants}</strong></span>
		</div>
		${activeInactiveSummary}
		${blacklistedSummary}
		<div class="summary-row total">
			<span>Total Monthly Rent Expected:</span>
			<span>₱${formatCurrency(totalMonthlyRent)}</span>
		</div>
		<div class="summary-row">
			<span>Average Rent per Tenant:</span>
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

	const handleExportCSV = async () => {
		setExporting(true)
		try {
			const res = await authFetch(`/api/properties/${property.id}/export-tenants/`)
			if (!res.ok) throw new Error('Export failed')
			const blob = await res.blob()
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = `${property.propertyName || 'tenants'}_tenant_list.csv`
			a.click()
			URL.revokeObjectURL(url)
		} catch (err) {
			console.error('Export error:', err)
			alert('Failed to export tenant list')
		} finally {
			setExporting(false)
		}
	}

	if (loading) {
		return (
			<div className="w-full h-full flex items-center justify-center bg-gray-50 dark:bg-gray-900">
				<div className="flex flex-col items-center gap-4">
					<div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
					<p className="text-gray-500 font-medium">Loading tenants...</p>
				</div>
			</div>
		)
	}

	// Show tenant profile view if a tenant is selected
	if (viewingTenant) {
		return (
			<TenantProfile
				tenantId={viewingTenant}
				onBack={(shouldRefresh) => {
					setViewingTenant(null)
					// Only refresh and clear previous-tenants list when explicitly requested (e.g. after remove), not on plain back (event is passed as first arg)
					if (shouldRefresh === true) {
						fetchActiveTenants()
						if (inactiveLoaded) {
							setInactiveLoaded(false)
							setInactiveTenants([])
						}
					}
				}}
				propertyName={property?.propertyName}
			/>
		)
	}

	return (
		<>
			<div className="w-full h-full flex flex-col bg-gray-50 dark:bg-gray-900 font-sans">
				{/* Modern Sticky Header */}
				<div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-700 px-6 py-5 flex-shrink-0 sticky top-0 z-20">
					<div className="max-w-7xl mx-auto w-full flex flex-col md:flex-row md:items-center justify-between gap-4">
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
								<h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">{property.propertyName}</h1>
								<div className="flex items-center gap-2 mt-0.5">
									<span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
									<p className="text-sm font-medium text-gray-500 dark:text-gray-400">Tenant Directory • {currentTenantsCount} Active</p>
								</div>
							</div>
						</div>
						<div className="flex items-center gap-3">
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
								onClick={() => { if (!inactiveLoaded) fetchInactiveTenants(); setShowPrintModal(true); }}
								className="flex-1 md:flex-none px-6 py-2.5 bg-gray-900 dark:bg-gray-700 hover:bg-black dark:hover:bg-gray-600 text-white rounded-xl font-bold transition-all flex items-center justify-center space-x-2 shadow-lg shadow-black/10 dark:shadow-none"
							>
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
								</svg>
								<span>Generate PDF</span>
							</button>
							<button
								onClick={onAddTenant}
								className="px-5 py-2.5 bg-gray-900 dark:bg-white dark:text-gray-900 text-white rounded-xl font-semibold shadow-lg shadow-gray-200 dark:shadow-none transition-all hover:bg-gray-800 dark:hover:bg-gray-100 active:scale-95 flex items-center gap-2"
							>
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
								</svg>
								<span>Add Tenant</span>
							</button>
						</div>
					</div>
				</div>

				<div className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900 scrollbar-thin">
					<div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

						{/* Search and Filters Bar */}
						<div className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-200/50 dark:border-gray-700/50 flex flex-col md:flex-row gap-4 items-center justify-between">
							<div className="relative w-full md:w-96 group">
								<input
									type="text"
									placeholder="Search name, room, or ID..."
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									className="w-full pl-11 pr-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all dark:text-white"
								/>
								<svg className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2 group-focus-within:text-blue-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
								</svg>
							</div>

							<div className="flex items-center gap-6 w-full md:w-auto">
								<label className="flex items-center gap-3 cursor-pointer select-none group">
									<div className="relative">
										<input
											type="checkbox"
											checked={showPrevious}
											onChange={(e) => setShowPrevious(e.target.checked)}
											className="sr-only peer"
											disabled={loadingInactive}
										/>
										<div className="w-10 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-blue-600 transition-all after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5"></div>
									</div>
									<span className="text-sm font-medium text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
										Previous Tenants
										{loadingInactive && <span className="ml-2 animate-pulse text-blue-500">...</span>}
									</span>
								</label>
							</div>
						</div>

						{/* Desktop Table View (Hidden on LG and below is too small, let's use LG as breakpoint) */}
						<div className="hidden lg:block bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
							<table className="w-full">
								<thead>
									<tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-700">
										<th onClick={() => handleSort('tenant_id')} className="px-6 py-4 text-left text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest cursor-pointer hover:text-gray-900 dark:hover:text-white transition-colors">
											<div className="flex items-center gap-1.5">
												<span>ID</span>
												{sortField === 'tenant_id' && (
													<svg className={`w-3.5 h-3.5 ${sortOrder === 'desc' ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg>
												)}
											</div>
										</th>
										<th onClick={() => handleSort('full_name')} className="px-6 py-4 text-left text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest cursor-pointer hover:text-gray-900 dark:hover:text-white transition-colors">
											<div className="flex items-center gap-1.5">
												<span>Tenant</span>
												{sortField === 'full_name' && (
													<svg className={`w-3.5 h-3.5 ${sortOrder === 'desc' ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg>
												)}
											</div>
										</th>
										<th onClick={() => handleSort('unit_number')} className="px-6 py-4 text-left text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest cursor-pointer hover:text-gray-900 dark:hover:text-white transition-colors">
											<div className="flex items-center gap-1.5">
												<span>Room</span>
												{sortField === 'unit_number' && (
													<svg className={`w-3.5 h-3.5 ${sortOrder === 'desc' ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg>
												)}
											</div>
										</th>
										<th onClick={() => handleSort('move_in')} className="px-6 py-4 text-left text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest cursor-pointer hover:text-gray-900 dark:hover:text-white transition-colors">
											<div className="flex items-center gap-1.5">
												<span>Started</span>
												{sortField === 'move_in' && (
													<svg className={`w-3.5 h-3.5 ${sortOrder === 'desc' ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg>
												)}
											</div>
										</th>
										<th onClick={() => handleSort('payment')} className="px-6 py-4 text-left text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest cursor-pointer hover:text-gray-900 dark:hover:text-white transition-colors text-right">
											<div className="flex items-center justify-end gap-1.5">
												<span>Payment</span>
												{sortField === 'payment' && (
													<svg className={`w-3.5 h-3.5 ${sortOrder === 'desc' ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg>
												)}
											</div>
										</th>
										<th className="px-6 py-4 text-center text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
											Status
										</th>
										<th className="px-6 py-4"></th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-100 dark:divide-gray-700">
									{pagedTenants.map((tenant) => (
										<tr
											key={tenant.tenant_id}
											onClick={() => setViewingTenant(tenant.tenant_id)}
											className="hover:bg-blue-50/30 dark:hover:bg-blue-900/10 transition-colors cursor-pointer group"
										>
											<td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500 dark:text-gray-400">
												#{tenant.tenant_id}
											</td>
											<td className="px-6 py-4 whitespace-nowrap">
												<div className="font-semibold text-gray-900 dark:text-white">{tenant.full_name}</div>
												<div className="text-xs text-gray-500 dark:text-gray-400">{tenant.phone || 'No phone'}</div>
											</td>
											<td className="px-6 py-4 whitespace-nowrap">
												<span className="px-2.5 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md text-xs font-bold border border-gray-200 dark:border-gray-600">
													{tenant.unit_number}
												</span>
											</td>
											<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
												{new Date(tenant.move_in).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
											</td>
											<td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900 dark:text-white text-right">
												₱{parseFloat(tenant.payment || 0).toLocaleString()}
											</td>
											<td className="px-6 py-4 whitespace-nowrap">
												<div className="flex items-center justify-center gap-2">
													<span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-wider rounded-full ${tenant.status === 'active'
														? 'bg-green-100 dark:bg-green-400/10 text-green-700 dark:text-green-400'
														: 'bg-gray-100 dark:bg-gray-400/10 text-gray-700 dark:text-gray-400'
														}`}>
														{tenant.status}
													</span>
													{tenant.blacklisted && (
														<span className="p-1 text-red-600 bg-red-100 dark:bg-red-400/10 dark:text-red-400 rounded-full" title="Do Not Rent Again">
															<svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" /></svg>
														</span>
													)}
												</div>
											</td>
											<td className="px-6 py-4 text-right">
												<div className="opacity-0 group-hover:opacity-100 transition-opacity">
													<svg className="w-5 h-5 text-blue-500 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>

						{/* Mobile/Tablet Card Layout (Visible on screens < LG) */}
						<div className="lg:hidden space-y-4">
							{pagedTenants.map((tenant) => (
								<div
									key={tenant.tenant_id}
									onClick={() => setViewingTenant(tenant.tenant_id)}
									className="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 active:scale-[0.98] transition-all cursor-pointer relative overflow-hidden group"
								>
									{/* Status Bar Indicator */}
									<div className={`absolute left-0 top-0 bottom-0 w-1 ${tenant.status === 'active' ? 'bg-green-500' : 'bg-gray-400'}`}></div>

									<div className="flex items-start justify-between mb-4">
										<div className="flex-1">
											<div className="flex items-center gap-2 mb-1">
												<h3 className="font-bold text-gray-900 dark:text-white text-lg leading-tight">{tenant.full_name}</h3>
												{tenant.blacklisted && <span className="text-red-500"><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" /></svg></span>}
											</div>
											<p className="text-sm font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1">
												<span>Room</span>
												<span className="font-bold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded uppercase">{tenant.unit_number}</span>
											</p>
										</div>
										<div className="text-right">
											<div className="text-lg font-black text-gray-900 dark:text-white">₱{parseFloat(tenant.payment || 0).toLocaleString()}</div>
											<div className="text-[10px] uppercase font-bold text-gray-400">Monthly Rent</div>
										</div>
									</div>

									<div className="grid grid-cols-2 gap-4 py-3 border-t border-gray-50 dark:border-gray-700/50">
										<div>
											<div className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 mb-0.5 tracking-wider">Tenant ID</div>
											<div className="text-sm font-mono text-gray-600 dark:text-gray-400">#{tenant.tenant_id}</div>
										</div>
										<div>
											<div className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 mb-0.5 tracking-wider">Started</div>
											<div className="text-sm font-semibold text-gray-600 dark:text-gray-300">
												{new Date(tenant.move_in).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
											</div>
										</div>
									</div>

									<div className="flex items-center justify-between mt-2">
										<span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-wider rounded-full ${tenant.status === 'active'
											? 'bg-green-100 dark:bg-green-400/10 text-green-700 dark:text-green-400'
											: 'bg-gray-100 dark:bg-gray-400/10 text-gray-700 dark:text-gray-400'
											}`}>
											{tenant.status}
										</span>
										<span className="text-blue-500 text-xs font-bold flex items-center gap-1 group-active:translate-x-1 transition-transform">
											View Profile
											<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
										</span>
									</div>
								</div>
							))}
						</div>

						{/* Empty State */}
						{filteredTenants.length === 0 && (
							<div className="py-20 text-center bg-white dark:bg-gray-800 rounded-3xl border border-dashed border-gray-300 dark:border-gray-700">
								<div className="inline-flex items-center justify-center w-20 h-20 bg-gray-50 dark:bg-gray-900 rounded-full mb-6">
									<svg className="w-10 h-10 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
									</svg>
								</div>
								<h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">No tenants found</h3>
								<p className="text-gray-500 dark:text-gray-400 max-w-xs mx-auto">Try adjusting your search or including previous tenants in the results.</p>
							</div>
						)}

						{/* Pagination Controls */}
						{totalPages > 1 && (
							<div className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-2xl px-5 py-3 border border-gray-200 dark:border-gray-700 shadow-sm">
								<span className="text-sm text-gray-500 dark:text-gray-400">
									{(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredTenants.length)} of <span className="font-semibold text-gray-900 dark:text-white">{filteredTenants.length}</span> tenants
								</span>
								<div className="flex items-center gap-2">
									<button
										onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
										disabled={currentPage === 1}
										className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
									>
										<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
									</button>
									<span className="text-sm font-semibold text-gray-700 dark:text-gray-300 min-w-[4rem] text-center">
										{currentPage} / {totalPages}
									</span>
									<button
										onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
										disabled={currentPage === totalPages}
										className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
									>
										<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
									</button>
								</div>
							</div>
						)}
					</div>
				</div>
			</div>

			{/* Print Options Modal */}
			{
				showPrintModal && (
					<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm print:hidden">
						<div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 relative">
							<button
								onClick={() => setShowPrintModal(false)}
								className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-all"
							>
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
							</button>

							<h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Print Options</h2>
							<p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Select which tenants to include in your printout.</p>

							<div className="space-y-3 mb-6">
								<label
									onClick={() => setPrintFilter('all')}
									className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${printFilter === 'all'
										? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
										: 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
										}`}
								>
									<div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${printFilter === 'all' ? 'border-blue-500' : 'border-gray-300 dark:border-gray-600'
										}`}>
										{printFilter === 'all' && <div className="w-2.5 h-2.5 rounded-full bg-blue-500"></div>}
									</div>
									<div>
										<div className="font-semibold text-gray-900 dark:text-white">All Tenants</div>
										<div className="text-sm text-gray-500 dark:text-gray-400">Active and inactive tenants ({activeTenants.length + inactiveTenants.length})</div>
									</div>
								</label>

								<label
									onClick={() => setPrintFilter('active')}
									className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${printFilter === 'active'
										? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
										: 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
										}`}
								>
									<div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${printFilter === 'active' ? 'border-blue-500' : 'border-gray-300 dark:border-gray-600'
										}`}>
										{printFilter === 'active' && <div className="w-2.5 h-2.5 rounded-full bg-blue-500"></div>}
									</div>
									<div>
										<div className="font-semibold text-gray-900 dark:text-white">Active Tenants Only</div>
										<div className="text-sm text-gray-500 dark:text-gray-400">Print only current tenants ({activeTenants.length})</div>
									</div>
								</label>

								<label
									onClick={() => setPrintFilter('timeframe')}
									className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${printFilter === 'timeframe'
										? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
										: 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
										}`}
								>
									<div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${printFilter === 'timeframe' ? 'border-blue-500' : 'border-gray-300 dark:border-gray-600'
										}`}>
										{printFilter === 'timeframe' && <div className="w-2.5 h-2.5 rounded-full bg-blue-500"></div>}
									</div>
									<div>
										<div className="font-semibold text-gray-900 dark:text-white">By Timeframe</div>
										<div className="text-sm text-gray-500 dark:text-gray-400">Filter by move-in date range</div>
									</div>
								</label>
							</div>

							{printFilter === 'timeframe' && (
								<div className="grid grid-cols-2 gap-4 mb-6 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl">
									<div>
										<label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">From</label>
										<input
											type="date"
											value={printDateRange.from}
											onChange={e => setPrintDateRange({ ...printDateRange, from: e.target.value })}
											className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:text-white"
										/>
									</div>
									<div>
										<label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">To</label>
										<input
											type="date"
											value={printDateRange.to}
											onChange={e => setPrintDateRange({ ...printDateRange, to: e.target.value })}
											className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:text-white"
										/>
									</div>
									<div className="col-span-2 text-xs text-gray-500 dark:text-gray-400">
										Matching tenants: <span className="font-bold text-gray-900 dark:text-white">{getPrintableTenants().length}</span>
									</div>
								</div>
							)}

							<div className="flex gap-3">
								<button
									onClick={() => setShowPrintModal(false)}
									className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
								>
									Cancel
								</button>
								<button
									onClick={handlePrint}
									disabled={printFilter === 'timeframe' && (!printDateRange.from || !printDateRange.to)}
									className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
								>
									<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
									Print
								</button>
							</div>
						</div>
					</div>
				)
			}
		</>
	)
}

export default TenantListView

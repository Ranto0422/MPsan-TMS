import { useState, useEffect, useRef } from 'react'
import { authFetch } from '../auth.js'

const PAGE_SIZE = 50

const RoomsListView = ({ property, onBack, onSelectRoom }) => {
	const [rooms, setRooms] = useState([])
	const [filteredRooms, setFilteredRooms] = useState([])
	const [loading, setLoading] = useState(true)
	const [searchQuery, setSearchQuery] = useState('')
	const [sortField, setSortField] = useState('room_number')
	const [sortOrder, setSortOrder] = useState('asc')
	const [statusFilter, setStatusFilter] = useState('all') // 'all', 'occupied', 'available', 'maintenance'
	const [activeFloor, setActiveFloor] = useState(null) // null = show all, number = show specific floor
	const [currentPage, setCurrentPage] = useState(1)
	const floorRefs = useRef({})

	// Stats
	const [stats, setStats] = useState({
		total: 0,
		occupied: 0,
		available: 0,
		maintenance: 0
	})

	useEffect(() => {
		if (property) {
			fetchRooms()
		}
	}, [property])

	useEffect(() => {
		filterAndSortRooms()
		setCurrentPage(1)
	}, [rooms, searchQuery, sortField, sortOrder, statusFilter, activeFloor])

	const fetchRooms = async () => {
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
					const roomsArr = layouts[variant]
					if (Array.isArray(roomsArr)) {
						allRooms.push(...roomsArr)
					}
				}
			}

			// Format rooms data (keep _raw for Room Profile)
			const roomsList = allRooms.map(room => {
				const roomDisplay = formatRoomNumber(room)
				const tenant = room.tenant
				return {
					id: `${room.floor || 1}-${room.number}-${room.section || ''}`,
					room_number: roomDisplay,
					raw_number: room.number,
					floor: room.floor || 1,
					section: room.section || '',
					type: room.type || 'room',
					status: room.status || 'available',
					tenant_name: tenant?.full_name || tenant?.name || null,
					tenant_id: tenant?.tenant_id || tenant?.id || null,
					payment: parseFloat(room.payment) || 0,
					occupancy: room.occupancy || (tenant ? 1 : 0),
					_raw: room
				}
			})

			// Calculate stats
			const occupied = roomsList.filter(r => r.status === 'occupied').length
			const available = roomsList.filter(r => r.status === 'available').length
			const maintenance = roomsList.filter(r => r.status === 'maintenance').length

			setStats({
				total: roomsList.length,
				occupied,
				available,
				maintenance
			})

			setRooms(roomsList)
		} catch (error) {
			console.error('Error fetching rooms:', error)
		} finally {
			setLoading(false)
		}
	}

	const formatRoomNumber = (room) => {
		const number = room.number || ''
		const type = room.type || 'room'
		const section = room.section || ''

		if (type === 'commercial') return `C${number}`
		if (section) return `${section.charAt(0).toUpperCase()}${number}`
		return `No.${number}`
	}

	const filterAndSortRooms = () => {
		let result = [...rooms]

		// Filter by status
		if (statusFilter !== 'all') {
			result = result.filter(r => r.status === statusFilter)
		}

		// Filter by search query
		if (searchQuery) {
			const query = searchQuery.toLowerCase()
			result = result.filter(r =>
				r.room_number?.toLowerCase().includes(query) ||
				r.tenant_name?.toLowerCase().includes(query) ||
				r.floor?.toString().includes(query) ||
				r.section?.toLowerCase().includes(query)
			)
		}

		// Sort
		result.sort((a, b) => {
			let aVal = a[sortField]
			let bVal = b[sortField]

			if (sortField === 'payment' || sortField === 'floor') {
				aVal = parseFloat(aVal) || 0
				bVal = parseFloat(bVal) || 0
			}

			if (sortField === 'room_number') {
				// Natural sort for room numbers
				return sortOrder === 'asc'
					? String(aVal).localeCompare(String(bVal), undefined, { numeric: true })
					: String(bVal).localeCompare(String(aVal), undefined, { numeric: true })
			}

			if (sortOrder === 'asc') {
				return aVal > bVal ? 1 : -1
			} else {
				return aVal < bVal ? 1 : -1
			}
		})

		setFilteredRooms(result)
	}

	const handleSort = (field) => {
		if (sortField === field) {
			setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
		} else {
			setSortField(field)
			setSortOrder('asc')
		}
	}

	// Helper functions for PDF generation
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

	// Generate PDF for room inventory
	const generateRoomInventoryPDF = (rooms, currentStats) => {
		const propertyName = property?.propertyName || property?.name || 'Property'

		// Build filter description
		const getFilterDescription = () => {
			const parts = []
			if (statusFilter !== 'all') {
				parts.push(`Status: ${statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}`)
			}
			if (activeFloor !== null) {
				parts.push(`Floor: ${activeFloor}`)
			}
			if (searchQuery) {
				parts.push(`Search: "${searchQuery}"`)
			}
			return parts.length > 0 ? parts.join(', ') : 'All Rooms'
		}
		const filterDescription = getFilterDescription()

		// Print timestamp
		const printTimestamp = new Date().toLocaleString('en-US', {
			dateStyle: 'medium',
			timeStyle: 'short'
		})

		// Calculate summary statistics
		const totalRooms = currentStats.total
		const occupiedCount = currentStats.occupied
		const availableCount = currentStats.available
		const maintenanceCount = currentStats.maintenance
		const occupancyRate = totalRooms > 0 ? ((occupiedCount / totalRooms) * 100).toFixed(1) : 0
		const totalMonthlyRent = rooms.reduce((sum, r) => sum + (parseFloat(r.payment) || 0), 0)
		const averageRent = rooms.length > 0 ? totalMonthlyRent / rooms.length : 0

		// Generate table rows
		const tableRows = rooms.length === 0
			? '<tr><td colspan="7" style="text-align: center; padding: 40px; color: #999;">No rooms match the selected criteria</td></tr>'
			: rooms.map(room => `
					<tr>
						<td style="font-weight: 600;">${escapeHtml(room.room_number)}</td>
						<td class="center">${room.floor || 1}</td>
						<td class="center">${escapeHtml(room.section || '-')}</td>
						<td>${room.type === 'commercial' ? 'Commercial' : 'Room'}</td>
						<td class="center">
							<span style="
								padding: 4px 8px;
								border-radius: 4px;
								font-size: 0.75rem;
								font-weight: 600;
								${room.status === 'occupied' ? 'background: #dcfce7; color: #15803d;' : ''}
								${room.status === 'available' ? 'background: #dbeafe; color: #1e40af;' : ''}
								${room.status === 'maintenance' ? 'background: #fef3c7; color: #a16207;' : ''}
							">
								${room.status.toUpperCase()}
							</span>
						</td>
						<td>${room.tenant_name ? escapeHtml(room.tenant_name) : '<em style="color: #999;">Vacant</em>'}</td>
						<td class="num">₱${formatCurrency(room.payment)}</td>
					</tr>
				`).join('')

		// Build complete HTML
		const html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>${escapeHtml(propertyName)} - Room Inventory</title>
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
		<div><strong>Report:</strong> Room Inventory</div>
		<div><strong>Filter:</strong> ${filterDescription}</div>
		<div><strong>Generated:</strong> ${printTimestamp}</div>
	</div>

	<div class="section">
		<table>
			<thead>
				<tr>
					<th>Room #</th>
					<th class="center">Floor</th>
					<th class="center">Section</th>
					<th>Type</th>
					<th class="center">Status</th>
					<th>Current Tenant</th>
					<th class="num">Monthly Rent</th>
				</tr>
			</thead>
			<tbody>
				${tableRows}
			</tbody>
		</table>
	</div>

	${rooms.length > 0 ? `
	<div class="summary">
		<div class="summary-row">
			<span>Total Rooms:</span>
			<span><strong>${totalRooms}</strong></span>
		</div>
		<div class="summary-row">
			<span>Occupied:</span>
			<span>${occupiedCount} (${occupancyRate}%)</span>
		</div>
		<div class="summary-row">
			<span>Available:</span>
			<span>${availableCount}</span>
		</div>
		${maintenanceCount > 0 ? `<div class="summary-row"><span>Maintenance:</span><span>${maintenanceCount}</span></div>` : ''}
		<div class="summary-row total">
			<span>Total Monthly Rent Expected:</span>
			<span>₱${formatCurrency(totalMonthlyRent)}</span>
		</div>
		<div class="summary-row">
			<span>Average Rent per Room:</span>
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

	const getStatusBadge = (status) => {
		switch (status) {
			case 'occupied':
				return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
			case 'available':
				return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
			case 'maintenance':
				return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
			default:
				return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-400'
		}
	}

	const getStatusLabel = (status) => {
		switch (status) {
			case 'occupied':
				return 'Occupied'
			case 'available':
				return 'Unoccupied'
			case 'maintenance':
				return 'Maintenance'
			default:
				return status
		}
	}

	// Group ALL rooms by floor (for floor tabs - always show all floors)
	const getAllRoomsByFloor = () => {
		const grouped = {}
		rooms.forEach(room => {
			const floor = room.floor || 1
			if (!grouped[floor]) {
				grouped[floor] = []
			}
			grouped[floor].push(room)
		})
		return grouped
	}

	// Group FILTERED rooms by floor (for displaying rooms in tables)
	const getFilteredRoomsByFloor = () => {
		const grouped = {}
		filteredRooms.forEach(room => {
			const floor = room.floor || 1
			if (!grouped[floor]) {
				grouped[floor] = []
			}
			grouped[floor].push(room)
		})
		return grouped
	}

	const allRoomsByFloor = getAllRoomsByFloor()
	const filteredRoomsByFloor = getFilteredRoomsByFloor()
	const floorNumbers = Object.keys(allRoomsByFloor).sort((a, b) => Number(a) - Number(b))

	// Pagination over filteredRooms
	const totalPages = Math.ceil(filteredRooms.length / PAGE_SIZE)
	const pagedRooms = filteredRooms.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

	// Group paged rooms by floor for display
	const pagedRoomsByFloor = (() => {
		const grouped = {}
		pagedRooms.forEach(room => {
			const floor = room.floor || 1
			if (!grouped[floor]) grouped[floor] = []
			grouped[floor].push(room)
		})
		return grouped
	})()

	// Default activeFloor is null (All Floors)

	// Get floors to display based on activeFloor (use paged data)
	const pagedFloorNumbers = Object.keys(pagedRoomsByFloor).sort((a, b) => Number(a) - Number(b))
	const displayFloors = activeFloor === null
		? pagedFloorNumbers
		: pagedFloorNumbers.filter(f => Number(f) === activeFloor)

	// Scroll to floor when clicking tab (if showing all floors)
	const scrollToFloor = (floorNum) => {
		setActiveFloor(Number(floorNum))
	}

	if (loading) {
		return (
			<div className="w-full h-full flex items-center justify-center">
				<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
			</div>
		)
	}

	return (
		<div className="w-full min-w-0 max-w-full h-full flex flex-col bg-gray-50 dark:bg-gray-900 font-sans overflow-x-hidden">
			{/* Sticky Header */}
			<div className="sticky top-0 z-30 bg-white/80 dark:bg-gray-800/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-700 px-3 sm:px-4 md:px-6 py-4 flex-shrink-0 min-w-0">
				<div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
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
								{property?.propertyName ?? property?.name ?? 'Room Inventory'}
							</h1>
							<div className="flex items-center gap-2 mt-0.5">
								<span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse flex-shrink-0"></span>
								<p className="text-[9px] md:text-xs font-bold text-gray-400 uppercase tracking-widest leading-none truncate">Property Room Management</p>
							</div>
						</div>
					</div>

					<button
						type="button"
						onClick={() => generateRoomInventoryPDF(filteredRooms, stats)}
						className="w-full sm:w-auto px-6 py-2.5 bg-gray-900 dark:bg-gray-700 hover:bg-black dark:hover:bg-gray-600 text-white rounded-xl font-bold transition-all flex items-center justify-center space-x-2 shadow-lg shadow-black/10 dark:shadow-none"
					>
						<svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
						</svg>
						<span className="text-sm">Print Room List</span>
					</button>
				</div>
			</div>

			<div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-3 sm:px-4 md:px-6 py-6 pb-20 md:pb-6">
				<div className="max-w-7xl w-full min-w-0 mx-auto space-y-6">
					{/* Stats Cards */}
					<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 min-w-0">
						<div className="bg-white dark:bg-gray-800 p-3 md:p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 min-w-0">
							<p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 truncate">Total Rooms</p>
							<div className="flex items-baseline justify-between gap-2">
								<span className="text-xl md:text-2xl font-black text-gray-900 dark:text-white leading-none">{stats.total}</span>
								<div className="p-1 md:p-1.5 bg-orange-50 dark:bg-orange-900/30 rounded-lg text-orange-600">
									<svg className="w-3.5 h-3.5 md:w-4 md:h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" /></svg>
								</div>
							</div>
						</div>

						<div className="bg-white dark:bg-gray-800 p-3 md:p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 min-w-0">
							<p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 truncate">Occupied</p>
							<div className="flex items-baseline gap-1.5 md:gap-2">
								<span className="text-xl md:text-2xl font-black text-green-600 dark:text-green-400 leading-none">{stats.occupied}</span>
								<span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">Units</span>
							</div>
						</div>

						<div className="bg-white dark:bg-gray-800 p-3 md:p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 min-w-0">
							<p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 truncate">Available</p>
							<div className="flex items-baseline gap-1.5 md:gap-2">
								<span className="text-xl md:text-2xl font-black text-blue-600 dark:text-blue-400 leading-none">{stats.available}</span>
								<span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">Units</span>
							</div>
						</div>

						<div className="bg-white dark:bg-gray-800 p-3 md:p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 min-w-0">
							<p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 truncate">Maintenance</p>
							<div className="flex items-baseline gap-1.5 md:gap-2">
								<span className="text-xl md:text-2xl font-black text-amber-600 dark:text-amber-400 leading-none">{stats.maintenance}</span>
								<span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">Units</span>
							</div>
						</div>
					</div>

					{/* Filters Panel */}
					<div className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 space-y-4 min-w-0">
						<div className="flex flex-col md:flex-row items-center justify-between gap-4 min-w-0">
							<div className="relative w-full md:max-w-sm min-w-0">
								<input
									type="text"
									placeholder="Search room number, tenant, or section..."
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									className="w-full pl-11 pr-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all outline-none dark:text-white"
								/>
								<svg className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
								</svg>
							</div>

							<div className="flex items-center gap-1.5 bg-gray-50 dark:bg-gray-900/50 p-1 rounded-xl w-full md:w-auto overflow-x-auto scrollbar-hide">
								{['all', 'occupied', 'available', 'maintenance'].map((status) => (
									<button
										key={status}
										onClick={() => setStatusFilter(status)}
										className={`px-4 py-2 text-[10px] md:text-[10px] font-black uppercase tracking-widest rounded-lg transition-all whitespace-nowrap shrink-0 ${statusFilter === status
											? 'bg-white dark:bg-gray-700 text-orange-600 dark:text-orange-400 shadow-sm ring-1 ring-gray-200 dark:ring-gray-600'
											: 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
											}`}
									>
										{status}
									</button>
								))}
							</div>
						</div>

						{floorNumbers.length > 1 && (
							<div className="flex items-center gap-2 pt-2 border-t border-gray-50 dark:border-gray-700/50 overflow-x-auto scrollbar-hide">
								<button
									onClick={() => setActiveFloor(null)}
									className={`shrink-0 px-4 py-1.5 text-[9px] md:text-[10px] font-black uppercase tracking-widest rounded-lg transition-all whitespace-nowrap ${activeFloor === null
										? 'bg-orange-600 text-white shadow-md'
										: 'bg-gray-50 dark:bg-gray-700 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600'
										}`}
								>
									All Floors
								</button>
								{floorNumbers.map(floorNum => (
									<button
										key={floorNum}
										onClick={() => setActiveFloor(Number(floorNum))}
										className={`shrink-0 px-4 py-1.5 text-[9px] md:text-[10px] font-black uppercase tracking-widest rounded-lg transition-all whitespace-nowrap ${activeFloor === Number(floorNum)
											? 'bg-orange-600 text-white shadow-md'
											: 'bg-gray-50 dark:bg-gray-700 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600'
											}`}
									>
										Floor {floorNum}
									</button>
								))}
							</div>
						)}
					</div>

					{/* Room List Section */}
					<div className="space-y-6 min-w-0">
						{displayFloors.length === 0 ? (
							<div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm py-16 text-center border border-gray-100 dark:border-gray-700">
								<div className="w-16 h-16 bg-gray-50 dark:bg-gray-900 rounded-full flex items-center justify-center mx-auto mb-4">
									<svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
									</svg>
								</div>
								<p className="text-gray-400 font-bold uppercase tracking-widest text-xs">No rooms found for this selection</p>
							</div>
						) : (
							displayFloors.map(floorNum => {
								const floorRooms = pagedRoomsByFloor[floorNum] || []
								if (floorRooms.length === 0) return null

								return (
									<div key={floorNum} className="space-y-3">
										<div className="flex items-center justify-between px-1">
											<div className="flex items-center gap-2">
												<div className="w-1.5 h-1.5 rounded-full bg-orange-500"></div>
												<h2 className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest">Floor {floorNum}</h2>
											</div>
											<span className="text-[10px] font-black text-gray-300 dark:text-gray-600 uppercase tracking-widest">{floorRooms.length} Units</span>
										</div>

										{/* Desktop Table */}
										<div className="hidden md:block bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden border border-gray-100 dark:border-gray-700">
											<table className="w-full text-left border-collapse">
												<thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
													<tr>
														<th onClick={() => handleSort('room_number')} className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest cursor-pointer hover:text-orange-600 transition-colors">Room #</th>
														<th onClick={() => handleSort('status')} className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest cursor-pointer hover:text-orange-600 transition-colors">Status</th>
														<th onClick={() => handleSort('tenant_name')} className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest cursor-pointer hover:text-orange-600 transition-colors">Tenant</th>
														<th className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest text-center">Action</th>
													</tr>
												</thead>
												<tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
													{floorRooms.length === 0 ? (
														<tr>
															<td colSpan="4" className="px-6 py-8 text-center text-gray-400 text-xs font-bold uppercase tracking-widest italic">Empty Floor</td>
														</tr>
													) : (
														floorRooms.map((room) => (
															<tr
																key={room.id}
																onClick={() => onSelectRoom?.(room._raw, room)}
																className="group cursor-pointer hover:bg-orange-50/50 dark:hover:bg-orange-900/10 transition-colors"
															>
																<td className="px-6 py-4">
																	<span className="text-sm font-bold text-gray-900 dark:text-gray-300 group-hover:text-orange-600 transition-colors uppercase">{room.room_number}</span>
																</td>
																<td className="px-6 py-4">
																	<span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-tight ${getStatusBadge(room.status)}`}>
																		{getStatusLabel(room.status)}
																	</span>
																</td>
																<td className="px-6 py-4">
																	<span className="text-sm font-medium text-gray-600 dark:text-gray-400">{room.tenant_name || '—'}</span>
																</td>
																<td className="px-6 py-4 text-center">
																	<button className="p-2 hover:bg-white dark:hover:bg-gray-700 rounded-lg shadow-sm group-hover:shadow transition-all text-gray-400 group-hover:text-orange-600">
																		<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																			<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
																			<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
																		</svg>
																	</button>
																</td>
															</tr>
														))
													)}
												</tbody>
											</table>
										</div>

										{/* Mobile Cards */}
										<div className="md:hidden space-y-3">
											{floorRooms.map((room) => (
												<div
													key={room.id}
													onClick={() => onSelectRoom?.(room._raw, room)}
													className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 transition-all"
												>
													<div className="flex justify-between items-start mb-3">
														<div>
															<h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">{room.room_number}</h3>
															<p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">{room.type}</p>
														</div>
														<span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${getStatusBadge(room.status)}`}>
															{getStatusLabel(room.status)}
														</span>
													</div>

													<div className="flex items-center justify-between">
														<div className="flex flex-col">
															<span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">Tenant</span>
															<span className="text-xs font-bold text-gray-700 dark:text-gray-300">{room.tenant_name || 'Unoccupied'}</span>
														</div>
														<div className="p-2 bg-gray-50 dark:bg-gray-700 text-gray-400 rounded-xl">
															<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
															</svg>
														</div>
													</div>
												</div>
											))}
										</div>
									</div>
								)
							})
						)}
					</div>

					{/* Pagination Controls */}
					{totalPages > 1 && (
						<div className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-2xl px-5 py-3 border border-gray-200 dark:border-gray-700 shadow-sm">
							<span className="text-sm text-gray-500 dark:text-gray-400">
								{(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredRooms.length)} of <span className="font-semibold text-gray-900 dark:text-white">{filteredRooms.length}</span> rooms
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
	)
}

export default RoomsListView

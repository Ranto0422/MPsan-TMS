import { useState, useEffect } from 'react'
import api from '../auth'

const PaymentHistoryView = ({ property, onBack }) => {
	const [payments, setPayments] = useState([])
	const [filteredPayments, setFilteredPayments] = useState([])
	const [loading, setLoading] = useState(true)
	const [searchQuery, setSearchQuery] = useState('')
	const [sortField, setSortField] = useState('payment_date')
	const [sortOrder, setSortOrder] = useState('desc')
	const [dateFilter, setDateFilter] = useState('all') // 'all', 'month', 'quarter', 'year'
	const [showDateMenu, setShowDateMenu] = useState(false)
	const [totalCollected, setTotalCollected] = useState(0)

	useEffect(() => {
		if (property) {
			fetchPayments()
		}
	}, [property])

	useEffect(() => {
		filterAndSortPayments()
	}, [payments, searchQuery, sortField, sortOrder, dateFilter])

	const fetchPayments = async () => {
		setLoading(true)
		try {
			const tenantsRes = await api.get('/api/tenants/')
			const allTenants = tenantsRes.data

			const unitsRes = await api.get('/api/units/')
			const propertyUnits = unitsRes.data.filter(u => u.property === property.id)

			const propertyTenants = allTenants.filter(t => 
				propertyUnits.some(u => u.occupant_id === t.tenant_id)
			)

			// Generate payment history records (combining real data with mock payment dates)
			const paymentRecords = []
			propertyTenants.forEach(tenant => {
				const unit = propertyUnits.find(u => u.occupant_id === tenant.tenant_id)
				const moveInDate = new Date(tenant.move_in)
				const today = new Date()
				
				// Generate payments from move-in date to today
				let currentDate = new Date(moveInDate)
				while (currentDate <= today) {
					// Randomly decide if payment was made (80% chance)
					if (Math.random() > 0.2) {
						paymentRecords.push({
							tenant_id: tenant.tenant_id,
							name: tenant.full_name,
							payment_date: new Date(currentDate),
							amount: parseFloat(tenant.payment) || 0,
							room: unit?.unit_number || 'N/A',
							status: 'Paid'
						})
					}
					// Move to next month
					currentDate.setMonth(currentDate.getMonth() + 1)
				}
			})

			// Sort by date descending
			paymentRecords.sort((a, b) => b.payment_date - a.payment_date)

			setPayments(paymentRecords)
			
			// Calculate total
			const total = paymentRecords.reduce((sum, p) => sum + p.amount, 0)
			setTotalCollected(total)
		} catch (error) {
			console.error('Error fetching payments:', error)
		} finally {
			setLoading(false)
		}
	}

	const filterAndSortPayments = () => {
		let result = [...payments]

		// Filter by date range
		if (dateFilter !== 'all') {
			const now = new Date()
			const filterDate = new Date()
			
			if (dateFilter === 'month') {
				filterDate.setMonth(now.getMonth() - 1)
			} else if (dateFilter === 'quarter') {
				filterDate.setMonth(now.getMonth() - 3)
			} else if (dateFilter === 'year') {
				filterDate.setFullYear(now.getFullYear() - 1)
			}
			
			result = result.filter(p => p.payment_date >= filterDate)
		}

		// Filter by search query
		if (searchQuery) {
			result = result.filter(p =>
				p.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
				p.tenant_id?.toString().includes(searchQuery) ||
				p.room?.toString().includes(searchQuery)
			)
		}

		// Sort
		result.sort((a, b) => {
			let aVal = a[sortField]
			let bVal = b[sortField]

			if (sortField === 'amount') {
				aVal = parseFloat(aVal) || 0
				bVal = parseFloat(bVal) || 0
			} else if (sortField === 'payment_date') {
				aVal = a.payment_date.getTime()
				bVal = b.payment_date.getTime()
			}

			if (sortOrder === 'asc') {
				return aVal > bVal ? 1 : -1
			} else {
				return aVal < bVal ? 1 : -1
			}
		})

		setFilteredPayments(result)
	}

	const handleSort = (field) => {
		if (sortField === field) {
			setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
		} else {
			setSortField(field)
			setSortOrder('asc')
		}
	}

	const getDateFilterLabel = () => {
		switch(dateFilter) {
			case 'month': return 'Last Month'
			case 'quarter': return 'Last 3 Months'
			case 'year': return 'Last Year'
			default: return 'All Time'
		}
	}

	if (loading) {
		return (
			<div className="w-full h-full flex items-center justify-center">
				<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
			</div>
		)
	}

	return (
		<div className="w-full h-full flex flex-col bg-gray-50 dark:bg-gray-900">
			{/* Header */}
			<div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex-shrink-0">
				<div className="flex items-center justify-between gap-4 mb-4">
					<div className="flex items-center space-x-4">
						<button 
							onClick={onBack}
							className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
						>
							<svg className="w-6 h-6 text-gray-700 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
							</svg>
						</button>
						<div>
							<h1 className="text-2xl font-bold text-gray-900 dark:text-white">{property.propertyName}</h1>
							<p className="text-sm text-gray-600 dark:text-gray-400">Payment History</p>
						</div>
					</div>
					<button 
						onClick={() => window.print()}
						className="px-4 py-2 bg-gray-700 hover:bg-gray-800 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
					>
						<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
						</svg>
						<span>Print All Reports</span>
					</button>
				</div>

				{/* Total Rent Collected Card */}
				<div className="bg-gradient-to-br from-green-500 to-green-600 text-white rounded-xl px-6 py-4 shadow-lg flex items-center space-x-4">
					<div className="w-14 h-14 bg-white/20 rounded-lg flex items-center justify-center">
						<svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
							<path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
							<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
						</svg>
					</div>
					<div>
						<div className="text-5xl font-bold">{totalCollected.toLocaleString()}</div>
						<div className="text-green-100 text-sm font-medium">Total Rent Collected</div>
					</div>
				</div>
			</div>

			{/* Filters and Search */}
			<div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex-shrink-0">
				<div className="flex items-center justify-between gap-4">
					<h2 className="text-lg font-semibold text-gray-900 dark:text-white">Payment History</h2>

					<div className="flex items-center space-x-3">
						<div className="relative">
							<input
								type="text"
								placeholder="Search payments..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="w-64 pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
							/>
							<svg className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
							</svg>
						</div>
						<div className="relative">
							<button 
								onClick={() => setShowDateMenu(!showDateMenu)}
								className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center space-x-2"
							>
								<svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
								</svg>
								<span className="text-sm text-gray-700 dark:text-gray-300">{getDateFilterLabel()}</span>
								<svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="currentColor" viewBox="0 0 20 20">
									<path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
								</svg>
							</button>
							{showDateMenu && (
								<div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-10">
									<div className="py-1">
										<button onClick={() => { setDateFilter('all'); setShowDateMenu(false) }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">All Time</button>
										<button onClick={() => { setDateFilter('month'); setShowDateMenu(false) }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">Last Month</button>
										<button onClick={() => { setDateFilter('quarter'); setShowDateMenu(false) }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">Last 3 Months</button>
										<button onClick={() => { setDateFilter('year'); setShowDateMenu(false) }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">Last Year</button>
									</div>
								</div>
							)}
						</div>
					</div>
				</div>
			</div>

			{/* Table */}
			<div className="flex-1 overflow-auto px-6 pt-4 pb-6">
				<div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
					<table className="w-full">
						<thead className="bg-green-600 text-white">
							<tr>
								<th 
									onClick={() => handleSort('tenant_id')}
									className="px-6 py-3 text-left text-sm font-semibold uppercase tracking-wider cursor-pointer hover:bg-green-700 transition-colors"
								>
									<div className="flex items-center space-x-1">
										<span>Tenant ID</span>
										{sortField === 'tenant_id' && (
											<svg className={`w-4 h-4 transition-transform ${sortOrder === 'desc' ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
												<path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
											</svg>
										)}
									</div>
								</th>
								<th 
									onClick={() => handleSort('name')}
									className="px-6 py-3 text-left text-sm font-semibold uppercase tracking-wider cursor-pointer hover:bg-green-700 transition-colors"
								>
									<div className="flex items-center space-x-1">
										<span>Name</span>
										{sortField === 'name' && (
											<svg className={`w-4 h-4 transition-transform ${sortOrder === 'desc' ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
												<path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
											</svg>
										)}
									</div>
								</th>
								<th 
									onClick={() => handleSort('payment_date')}
									className="px-6 py-3 text-left text-sm font-semibold uppercase tracking-wider cursor-pointer hover:bg-green-700 transition-colors"
								>
									<div className="flex items-center space-x-1">
										<span>Payment Date</span>
										{sortField === 'payment_date' && (
											<svg className={`w-4 h-4 transition-transform ${sortOrder === 'desc' ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
												<path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
											</svg>
										)}
									</div>
								</th>
								<th 
									onClick={() => handleSort('amount')}
									className="px-6 py-3 text-left text-sm font-semibold uppercase tracking-wider cursor-pointer hover:bg-green-700 transition-colors"
								>
									<div className="flex items-center space-x-1">
										<span>Amount Payed</span>
										{sortField === 'amount' && (
											<svg className={`w-4 h-4 transition-transform ${sortOrder === 'desc' ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
												<path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
											</svg>
										)}
									</div>
								</th>
								<th 
									onClick={() => handleSort('room')}
									className="px-6 py-3 text-left text-sm font-semibold uppercase tracking-wider cursor-pointer hover:bg-green-700 transition-colors"
								>
									<div className="flex items-center space-x-1">
										<span>Room #</span>
										{sortField === 'room' && (
											<svg className={`w-4 h-4 transition-transform ${sortOrder === 'desc' ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
												<path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
											</svg>
										)}
									</div>
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-200 dark:divide-gray-700">
							{filteredPayments.map((payment, idx) => (
								<tr 
									key={idx} 
									className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
								>
									<td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-300">
										{payment.tenant_id}
									</td>
									<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-300">
										{payment.name}
									</td>
									<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-400">
										{payment.payment_date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
									</td>
									<td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-gray-300">
										{payment.amount.toFixed(2)}
									</td>
									<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-400">
										{payment.room}
									</td>
								</tr>
							))}
						</tbody>
					</table>
					{filteredPayments.length === 0 && (
						<div className="py-12 text-center">
							<svg className="w-16 h-16 text-gray-400 dark:text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
							</svg>
							<p className="text-gray-500 dark:text-gray-400">No payment records found</p>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}

export default PaymentHistoryView

import { useState, useEffect, useMemo, useRef } from 'react'
import { authFetch } from '../auth.js'
import {
	BarChart, Bar, PieChart, Pie, Cell,
	XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
	Area, AreaChart
} from 'recharts'
import { BiTrendingUp, BiTrendingDown } from 'react-icons/bi'
import { FaUsers, FaHome, FaMoneyBillWave, FaExclamationTriangle, FaCalendarAlt, FaDoorOpen, FaCheckCircle, FaRegCircle, FaPlus, FaTrash, FaFilePdf } from 'react-icons/fa'
import { MdPayment, MdOutlineAccessTime, MdChecklist } from 'react-icons/md'
import { IoCalendarOutline } from 'react-icons/io5'
import OccupancyForecastChart from './OccupancyForecastChart'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

// Chart colors
const COLORS = {
	primary: '#3B82F6',
	success: '#10B981',
	warning: '#F59E0B',
	danger: '#EF4444',
	purple: '#8B5CF6',
	cyan: '#06B6D4',
	pink: '#EC4899',
	indigo: '#6366F1'
}

// Helper to format currency
const formatCurrency = (amount) => {
	return new Intl.NumberFormat('en-PH', {
		style: 'currency',
		currency: 'PHP',
		minimumFractionDigits: 0,
		maximumFractionDigits: 0
	}).format(amount)
}

// Helper to get month name
const getMonthName = (monthIndex, short = false) => {
	const months = short
		? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
		: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
	return months[monthIndex]
}

// Stat Card Component
const StatCard = ({ icon: Icon, label, value, subValue, trend, trendValue, color = 'blue', onClick }) => {
	const colorClasses = {
		blue: 'from-blue-500 to-blue-600',
		green: 'from-emerald-500 to-emerald-600',
		yellow: 'from-amber-500 to-amber-600',
		red: 'from-red-500 to-red-600',
		purple: 'from-purple-500 to-purple-600',
		cyan: 'from-cyan-500 to-cyan-600'
	}

	return (
		<div
			onClick={onClick}
			className={`bg-gradient-to-br ${colorClasses[color]} rounded-xl md:rounded-2xl p-3 md:p-4 text-white shadow-lg hover:shadow-xl transition-all duration-300 h-full flex flex-col ${onClick ? 'cursor-pointer hover:scale-[1.02]' : ''}`}
		>
			<div className="flex items-start justify-between gap-1 md:gap-2 flex-1">
				<div className="flex-1 min-w-0">
					<p className="text-white/80 text-[10px] md:text-xs font-medium mb-0.5 md:mb-1">{label}</p>
					<p className="text-lg md:text-2xl font-bold tracking-tight">{value}</p>
					{subValue && (
						<p className="text-white/70 text-[10px] md:text-xs mt-0.5 md:mt-1">{subValue}</p>
					)}
				</div>
				<div className="w-7 h-7 md:w-10 md:h-10 bg-white/20 rounded-lg md:rounded-xl flex items-center justify-center flex-shrink-0">
					<Icon className="w-3.5 h-3.5 md:w-5 md:h-5" />
				</div>
			</div>
			{trend !== undefined && (
				<div className="flex items-center gap-1 mt-2 md:mt-3 pt-2 md:pt-3 border-t border-white/20">
					{trend === 'up' ? (
						<BiTrendingUp className="w-3 h-3 md:w-4 md:h-4 text-green-200" />
					) : trend === 'down' ? (
						<BiTrendingDown className="w-3 h-3 md:w-4 md:h-4 text-red-200" />
					) : null}
					<span className="text-xs md:text-sm text-white/80">{trendValue}</span>
				</div>
			)}
		</div>
	)
}

// Local storage key for todos
const TODO_STORAGE_KEY = 'dashboard_todos'

// Load todos from localStorage
const loadTodos = (propertyId) => {
	try {
		const stored = localStorage.getItem(`${TODO_STORAGE_KEY}_${propertyId}`)
		if (stored) {
			return JSON.parse(stored)
		}
	} catch (e) {
		console.error('Error loading todos:', e)
	}
	return []
}

// Save todos to localStorage
const saveTodos = (propertyId, todos) => {
	try {
		localStorage.setItem(`${TODO_STORAGE_KEY}_${propertyId}`, JSON.stringify(todos))
	} catch (e) {
		console.error('Error saving todos:', e)
	}
}

export default function Dashboard({ property, layoutsRefreshKey, onViewTenantProfile }) {
	const [loading, setLoading] = useState(true)
	const [generatingReport, setGeneratingReport] = useState(false)
	const [selectedMonth, setSelectedMonth] = useState('all')
	const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
	const yearOptions = useMemo(() => {
		const now = new Date().getFullYear()
		const years = []
		for (let y = now - 2; y <= now + 1; y++) years.push(y)
		return years
	}, [])

	// Data states
	const [allRooms, setAllRooms] = useState([])
	const [allTransactions, setAllTransactions] = useState([])
	const [monthlyData, setMonthlyData] = useState([])

	// Todo list state
	const [todos, setTodos] = useState([])
	const [newTodoText, setNewTodoText] = useState('')
	const [showCompletedTodos, setShowCompletedTodos] = useState(false)

	// Load todos when property changes
	useEffect(() => {
		if (property?.id) {
			setTodos(loadTodos(property.id))
		}
	}, [property?.id])

	// Save todos whenever they change
	useEffect(() => {
		if (property?.id && todos.length >= 0) {
			saveTodos(property.id, todos)
		}
	}, [todos, property?.id])

	// Add new todo
	const addTodo = () => {
		if (!newTodoText.trim()) return
		const newTodo = {
			id: Date.now(),
			text: newTodoText.trim(),
			completed: false,
			createdAt: new Date().toISOString(),
			priority: 'normal' // 'high', 'normal', 'low'
		}
		setTodos(prev => [newTodo, ...prev])
		setNewTodoText('')
	}

	// Toggle todo completion
	const toggleTodo = (id) => {
		setTodos(prev => prev.map(todo =>
			todo.id === id ? { ...todo, completed: !todo.completed, completedAt: !todo.completed ? new Date().toISOString() : null } : todo
		))
	}

	// Delete todo
	const deleteTodo = (id) => {
		setTodos(prev => prev.filter(todo => todo.id !== id))
	}

	// Set priority
	const setPriority = (id, priority) => {
		setTodos(prev => prev.map(todo =>
			todo.id === id ? { ...todo, priority } : todo
		))
	}

	// Fetch data
	useEffect(() => {
		if (!property?.id) {
			setLoading(false)
			return
		}
		fetchDashboardData()
	}, [property?.id, layoutsRefreshKey])

	const fetchDashboardData = async () => {
		setLoading(true)
		try {
			const res = await authFetch(`/api/properties/${property.id}/layouts/`)
			if (!res.ok) throw new Error('Failed to fetch data')
			const data = await res.json()
			const layouts = data.layouts || {}

			// Extract all rooms
			const rooms = []
			Object.values(layouts).forEach(variant => {
				if (Array.isArray(variant)) {
					rooms.push(...variant)
				}
			})
			setAllRooms(rooms)

			// Extract all transactions
			const transactions = []
			rooms.forEach(room => {
				if (room.transactions && Array.isArray(room.transactions)) {
					room.transactions.forEach(tx => {
						transactions.push({
							...tx,
							roomNumber: room.number,
							roomSection: room.section,
							tenantName: tx.name || tx.tenant_name || room.tenant?.full_name || 'Unknown',
							date: new Date(tx.timestamp || tx.date)
						})
					})
				}
			})
			transactions.sort((a, b) => b.date - a.date)
			setAllTransactions(transactions)

			// Build monthly aggregated data for charts
			buildMonthlyData(rooms, transactions)

		} catch (err) {
			console.error('Dashboard fetch error:', err)
		} finally {
			setLoading(false)
		}
	}

	const buildMonthlyData = (rooms, transactions) => {
		const data = []
		const now = new Date()

		for (let month = 0; month < 12; month++) {
			const monthStart = new Date(selectedYear, month, 1)
			const monthEnd = new Date(selectedYear, month + 1, 0, 23, 59, 59)

			// Filter transactions for this month
			const monthTx = transactions.filter(tx => {
				const txDate = tx.date
				return txDate >= monthStart && txDate <= monthEnd
			})

			// Calculate total collected for this month (all payment types)
			const rentCollected = monthTx
				.reduce((sum, tx) => {
					const amount = parseFloat(String(tx.amount || 0).replace(/,/g, '')) || 0
					return sum + amount
				}, 0)

			// For occupancy, use current data for current/future months
			// For past months, we'd need historical data (which we don't have, so estimate)
			const occupiedRooms = rooms.filter(r => r.status === 'occupied' && r.tenant).length
			const totalRooms = rooms.length
			const occupancyRate = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0

			// Expected rent (if fully occupied)
			const expectedRent = rooms.reduce((sum, r) => sum + (parseFloat(r.payment) || 0), 0)
			const currentExpected = rooms
				.filter(r => r.status === 'occupied')
				.reduce((sum, r) => sum + (parseFloat(r.payment) || 0), 0)

			data.push({
				month: getMonthName(month, true),
				monthIndex: month,
				rentCollected,
				expectedRent,
				currentExpected,
				occupancyRate,
				occupiedRooms,
				totalRooms,
				transactionCount: monthTx.length,
				// Only show data up to current month for current year
				isFuture: selectedYear > now.getFullYear() || (selectedYear === now.getFullYear() && month > now.getMonth())
			})
		}

		setMonthlyData(data)
	}

	// Rebuild monthly data when year changes
	useEffect(() => {
		if (allRooms.length || allTransactions.length) {
			buildMonthlyData(allRooms, allTransactions)
		}
	}, [selectedYear])

	// Computed stats
	const stats = useMemo(() => {
		const occupied = allRooms.filter(r => r.status === 'occupied' && r.tenant)
		const vacant = allRooms.filter(r => r.status === 'available')
		const totalRooms = allRooms.length

		// Current rent (if all occupied pay)
		const currentMonthlyRent = occupied.reduce((sum, r) => sum + (parseFloat(r.payment) || 0), 0)
		const maxPossibleRent = allRooms.reduce((sum, r) => sum + (parseFloat(r.payment) || 0), 0)

		// Calculate total collected this year (all payment types)
		const yearStart = new Date(selectedYear, 0, 1)
		const yearEnd = new Date(selectedYear, 11, 31, 23, 59, 59)
		const yearTx = allTransactions.filter(tx => tx.date >= yearStart && tx.date <= yearEnd)
		const totalCollectedYear = yearTx
			.reduce((sum, tx) => sum + (parseFloat(String(tx.amount || 0).replace(/,/g, '')) || 0), 0)

		// Month collected (uses selectedYear so it updates when year changes)
		const now = new Date()
		const displayMonth = now.getMonth()
		const monthStart = new Date(selectedYear, displayMonth, 1)
		const monthEnd = new Date(selectedYear, displayMonth + 1, 0, 23, 59, 59)
		const currentMonthTx = allTransactions.filter(tx => tx.date >= monthStart && tx.date <= monthEnd)
		const currentMonthCollected = currentMonthTx
			.reduce((sum, tx) => sum + (parseFloat(String(tx.amount || 0).replace(/,/g, '')) || 0), 0)

		// Outstanding balance calculation
		const today = new Date()
		today.setHours(0, 0, 0, 0)
		let totalOutstanding = 0
		let tenantsWithBalance = 0

		occupied.forEach(room => {
			const tenant = room.tenant
			if (!tenant) return

			// Check advance/deposit
			if (tenant.advance_paid !== true) {
				totalOutstanding += parseFloat(tenant.advance_amount) || parseFloat(room.payment) || 0
			}
			if (tenant.deposit_paid !== true) {
				totalOutstanding += parseFloat(tenant.deposit_amount) || parseFloat(room.payment) || 0
			}

			// Check if tenant moved in this month - if so, rent is not due yet (first rent due next month)
			const moveInDate = tenant.move_in || tenant.date_of_occupancy
			if (moveInDate) {
				const moveIn = new Date(moveInDate)
				if (moveIn.getMonth() === today.getMonth() && moveIn.getFullYear() === today.getFullYear()) {
					return // New tenant - no rent due yet
				}
			}

			// Check rent due (only for tenants who moved in before this month)
			const moveInDay = (() => {
				const mi = tenant.move_in || tenant.date_of_occupancy
				if (!mi) return 28
				if (typeof mi === 'string' && mi.match(/^\d{4}-\d{2}-\d{2}/)) return parseInt(mi.split('-')[2], 10)
				return new Date(mi).getDate() || 28
			})()
			const monthlyRent = parseFloat(room.payment) || 0

			// Calculate if rent is due
			const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
			const dueDay = Math.min(moveInDay, lastDay)
			const dueDate = new Date(today.getFullYear(), today.getMonth(), dueDay)

			if (dueDate <= today) {
				// Check if rent was paid this month
				const monthTx = (room.transactions || []).filter(tx => {
					const type = (tx.payment_type || tx.paymentType || '').toString().toLowerCase()
					if (type !== 'rent' && type !== 'monthly_rent' && type !== 'monthly rent') return false
					const txDate = new Date(tx.timestamp || tx.date)
					return txDate.getMonth() === today.getMonth() && txDate.getFullYear() === today.getFullYear()
				})
				const paidAmount = monthTx.reduce((sum, tx) => sum + (parseFloat(String(tx.amount || 0).replace(/,/g, '')) || 0), 0)

				if (paidAmount < monthlyRent) {
					totalOutstanding += monthlyRent - paidAmount
					tenantsWithBalance++
				}
			}
		})

		// Room type breakdown
		const roomTypes = {}
		allRooms.forEach(room => {
			const type = room.type || 'room'
			if (!roomTypes[type]) {
				roomTypes[type] = { total: 0, occupied: 0 }
			}
			roomTypes[type].total++
			if (room.status === 'occupied') roomTypes[type].occupied++
		})

		return {
			totalTenants: occupied.length,
			totalRooms,
			vacantRooms: vacant.length,
			occupancyRate: totalRooms > 0 ? Math.round((occupied.length / totalRooms) * 100) : 0,
			currentMonthlyRent,
			maxPossibleRent,
			totalCollectedYear,
			currentMonthCollected,
			totalOutstanding,
			tenantsWithBalance,
			roomTypes,
			recentTransactions: allTransactions.slice(0, 8)
		}
	}, [allRooms, allTransactions, selectedYear])

	// Payment status distribution for pie chart
	const paymentStatusData = useMemo(() => {
		const occupied = allRooms.filter(r => r.status === 'occupied' && r.tenant)
		const today = new Date()
		today.setHours(0, 0, 0, 0)

		let paid = 0
		let partial = 0
		let unpaid = 0
		let notDueYet = 0

		occupied.forEach(room => {
			const tenant = room.tenant
			if (!tenant) return

			// Check if tenant moved in this month - if so, first rent is due next month
			const moveInDate = tenant.move_in || tenant.date_of_occupancy
			if (moveInDate) {
				const moveIn = new Date(moveInDate)
				if (moveIn.getMonth() === today.getMonth() && moveIn.getFullYear() === today.getFullYear()) {
					notDueYet++
					return
				}
			}

			const monthlyRent = parseFloat(room.payment) || 0
			const moveInDay = (() => {
				const mi = tenant.move_in || tenant.date_of_occupancy
				if (!mi) return 28
				if (typeof mi === 'string' && mi.match(/^\d{4}-\d{2}-\d{2}/)) return parseInt(mi.split('-')[2], 10)
				return new Date(mi).getDate() || 28
			})()
			const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
			const dueDay = Math.min(moveInDay, lastDay)
			const dueDate = new Date(today.getFullYear(), today.getMonth(), dueDay)

			// Get rent payments this month
			const monthTx = (room.transactions || []).filter(tx => {
				const type = (tx.payment_type || tx.paymentType || '').toString().toLowerCase()
				if (type !== 'rent' && type !== 'monthly_rent' && type !== 'monthly rent') return false
				const txDate = new Date(tx.timestamp || tx.date)
				return txDate.getMonth() === today.getMonth() && txDate.getFullYear() === today.getFullYear()
			})
			const paidAmount = monthTx.reduce((sum, tx) => sum + (parseFloat(String(tx.amount || 0).replace(/,/g, '')) || 0), 0)

			if (dueDate > today) {
				notDueYet++
			} else if (paidAmount >= monthlyRent) {
				paid++
			} else if (paidAmount > 0) {
				partial++
			} else {
				unpaid++
			}
		})

		return [
			{ name: 'Paid', value: paid, color: COLORS.success },
			{ name: 'Partial', value: partial, color: COLORS.warning },
			{ name: 'Unpaid', value: unpaid, color: COLORS.danger },
			{ name: 'Not Due', value: notDueYet, color: COLORS.primary }
		].filter(d => d.value > 0)
	}, [allRooms])

	// Helper: get due day from room/tenant (same logic as Reports)
	const getDueDay = (room) => {
		const moveIn = room.tenant?.move_in || room.tenant?.date_of_occupancy
		if (!moveIn) return null
		try {
			if (typeof moveIn === 'string' && moveIn.match(/^\d{4}-\d{2}-\d{2}/)) {
				return parseInt(moveIn.split('-')[2], 10)
			}
			return new Date(moveIn).getDate()
		} catch {
			return null
		}
	}

	// Helper: check if payment type is rent
	const isRentPaymentType = (type) => {
		const v = (type ?? '').toString().toLowerCase().trim()
		return v === 'rent' || v === 'monthly_rent' || v === 'monthly rent'
	}

	// Helper: get sum of rent payments for a period
	const getRentPaidSumForPeriod = (transactions, dueDate, tenantId) => {
		if (!transactions || !Array.isArray(transactions)) return 0
		const dueY = dueDate.getFullYear()
		const dueM = dueDate.getMonth()
		const tid = String(tenantId)
		let sum = 0
		transactions.forEach(t => {
			if (!isRentPaymentType(t.payment_type || t.paymentType)) return
			const tId = t.tenant_id ?? t.id
			if (tId != null && String(tId) !== tid) return
			const d = t.date || t.timestamp
			if (!d) return
			try {
				const dt = new Date(d)
				if (dt.getFullYear() !== dueY || dt.getMonth() !== dueM) return
				const raw = t.amount ?? 0
				const str = typeof raw === 'string' ? String(raw).replace(/,/g, '') : String(raw)
				sum += parseFloat(str) || 0
			} catch { }
		})
		return sum
	}

	// Upcoming dues - sorted from closest to furthest
	const upcomingDues = useMemo(() => {
		const occupied = allRooms.filter(r => r.status === 'occupied' && r.tenant)
		const today = new Date()
		today.setHours(0, 0, 0, 0)

		const duesList = []

		occupied.forEach(room => {
			const tenant = room.tenant
			if (!tenant) return

			const tenantName = tenant.full_name || tenant.name || 'Unknown'
			const monthlyRent = parseFloat(room.payment) || 0
			const moveInDateStr = tenant.move_in || tenant.date_of_occupancy
			const roomDisplay = room.section
				? `${room.section.charAt(0).toUpperCase()}${room.number}`
				: room.number
			const tenantId = tenant.tenant_id || tenant.id

			// Get the due day (same logic as Reports)
			const dueDay = getDueDay(room)
			if (dueDay == null) return // Skip if no due day can be determined

			// Parse move-in date
			let moveInDate = null
			let movedInThisMonth = false
			if (moveInDateStr) {
				moveInDate = new Date(moveInDateStr)
				moveInDate.setHours(0, 0, 0, 0)
				movedInThisMonth = moveInDate.getMonth() === today.getMonth() && moveInDate.getFullYear() === today.getFullYear()
			}

			// Calculate this month's due date
			const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
			const actualDueDay = Math.min(dueDay, lastDay)
			let dueDate = new Date(today.getFullYear(), today.getMonth(), actualDueDay)

			// Check if this due date is after move-in
			let dueDateValid = true
			if (moveInDate) {
				// If due date is in the same month as move-in, advance covers it - skip to next month
				if (dueDate.getMonth() === moveInDate.getMonth() && dueDate.getFullYear() === moveInDate.getFullYear()) {
					dueDateValid = false
				}
				// If due date is before move-in, it's not valid
				if (dueDate < moveInDate) {
					dueDateValid = false
				}
			}

			// Check rent payments for this month's due period
			const paidAmount = getRentPaidSumForPeriod(room.transactions, dueDate, tenantId)

			// Determine if we should show this month's due date or next month's
			let showNextMonth = false
			if (!dueDateValid || movedInThisMonth) {
				// Tenant moved in this month - first rent due next month
				showNextMonth = true
			} else if (paidAmount >= monthlyRent) {
				// Already fully paid this month - show next month
				showNextMonth = true
			}

			if (showNextMonth) {
				const nextMonth = today.getMonth() + 1
				const nextYear = nextMonth > 11 ? today.getFullYear() + 1 : today.getFullYear()
				const nextMonthAdj = nextMonth > 11 ? 0 : nextMonth
				const nextLastDay = new Date(nextYear, nextMonthAdj + 1, 0).getDate()
				const nextDueDay = Math.min(dueDay, nextLastDay)
				dueDate = new Date(nextYear, nextMonthAdj, nextDueDay)
			}

			// Calculate days until due
			const timeDiff = dueDate.getTime() - today.getTime()
			const daysUntilDue = Math.ceil(timeDiff / (1000 * 60 * 60 * 24))

			// Determine status
			let status = 'upcoming'
			let statusColor = 'blue'

			// Only mark as unpaid/partial if this is for current month rent (not next month)
			const isCurrentMonthDue = dueDate.getMonth() === today.getMonth() && dueDate.getFullYear() === today.getFullYear()
			const hasNoPaidAmount = paidAmount === 0 && isCurrentMonthDue && !showNextMonth
			const isPartiallyPaid = paidAmount > 0 && paidAmount < monthlyRent && isCurrentMonthDue && !showNextMonth

			if (daysUntilDue < 0) {
				// Past due date
				status = hasNoPaidAmount ? 'unpaid' : (isPartiallyPaid ? 'partial' : 'overdue')
				statusColor = 'red'
			} else if (daysUntilDue === 0) {
				// Due today - show "due today" regardless of payment status (they still have time)
				status = isPartiallyPaid ? 'partial' : 'due today'
				statusColor = isPartiallyPaid ? 'orange' : 'yellow'
			} else if (daysUntilDue <= 3) {
				status = 'due soon'
				statusColor = 'orange'
			} else if (daysUntilDue <= 7) {
				status = 'this week'
				statusColor = 'blue'
			}

			duesList.push({
				tenantId,
				tenantName,
				room: roomDisplay,
				amount: monthlyRent,
				dueDate,
				dueDateFormatted: dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
				daysUntilDue,
				status,
				statusColor,
				paidAmount,
				remainingAmount: monthlyRent - paidAmount
			})
		})

		// Sort: unpaid/overdue first, then by due date (closest first)
		duesList.sort((a, b) => {
			// Priority order: unpaid > partial > overdue > due today > due soon > others
			const statusPriority = {
				'unpaid': 0,
				'partial': 1,
				'overdue': 2,
				'due today': 3,
				'due soon': 4,
				'this week': 5,
				'upcoming': 6
			}
			const aPriority = statusPriority[a.status] ?? 10
			const bPriority = statusPriority[b.status] ?? 10
			if (aPriority !== bPriority) return aPriority - bPriority
			// Same priority - sort by due date
			return a.dueDate - b.dueDate
		})

		return duesList
	}, [allRooms])

	const [isHeaderVisible, setIsHeaderVisible] = useState(true)
	const lastScrollY = useRef(0)

	useEffect(() => {
		const handleScroll = () => {
			if (window.innerWidth >= 768) {
				setIsHeaderVisible(true)
				return
			}
			const currentScrollY = window.scrollY
			if (currentScrollY > lastScrollY.current && currentScrollY > 100) {
				setIsHeaderVisible(false)
			} else {
				setIsHeaderVisible(true)
			}
			lastScrollY.current = currentScrollY
		}

		window.addEventListener('scroll', handleScroll, { passive: true })
		return () => window.removeEventListener('scroll', handleScroll)
	}, [])

	// ─── Generate PDF Report ───
	const generateReport = async () => {
		setGeneratingReport(true)
		try {
			// Fetch occupancy forecast data (may fail if no training data — that's OK)
			let forecastData = null
			try {
				const fcRes = await authFetch(`/api/ml/occupancy-forecast/${property.id}/`)
				if (fcRes.ok) forecastData = await fcRes.json()
			} catch { /* forecast unavailable — skip section */ }

			const propName = property.propertyName || property.name || 'Property'
			const reportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

			// Build payment status counts
			const statusCounts = { Paid: 0, Partial: 0, Unpaid: 0, 'Not Due': 0 }
			paymentStatusData.forEach(d => { statusCounts[d.name] = d.value })

			// Recent transactions (last 20)
			const recentTx = allTransactions.slice(0, 20)

			// Create hidden container
			const container = document.createElement('div')
			container.style.cssText = 'position:absolute;left:-9999px;top:0;width:794px;background:#fff;color:#1a1a1a;font-family:Arial,Helvetica,sans-serif;padding:40px;box-sizing:border-box;'
			document.body.appendChild(container)

			const h = (tag, text, styles = '') => `<${tag} style="${styles}">${text}</${tag}>`
			const thStyle = 'padding:8px 12px;text-align:left;border-bottom:2px solid #333;font-size:12px;font-weight:600;background:#f3f4f6;'
			const tdStyle = 'padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:11px;'
			const tdRight = 'padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:11px;text-align:right;'
			const sectionTitle = (text) => h('h2', text, 'font-size:16px;margin:28px 0 12px;padding-bottom:6px;border-bottom:2px solid #3b82f6;color:#1e40af;')

			let html = ''

			// ── Page 1: Header & Summary ──
			html += `
				<div style="text-align:center;margin-bottom:24px;padding-bottom:16px;border-bottom:3px solid #1e40af;">
					<h1 style="font-size:24px;margin:0 0 4px;color:#1e40af;">${propName}</h1>
					<p style="font-size:13px;color:#6b7280;margin:0;">${property.address || ''}</p>
					<p style="font-size:12px;color:#9ca3af;margin:4px 0 0;">Dashboard Report • Generated ${reportDate}</p>
				</div>
			`

			// Summary stats grid (3x2)
			const statCards = [
				{ label: 'Total Tenants', value: stats.totalTenants, sub: `of ${stats.totalRooms} rooms` },
				{ label: 'Vacant Rooms', value: stats.vacantRooms, sub: `${stats.occupancyRate}% occupancy` },
				{ label: 'Monthly Rent', value: formatCurrency(stats.currentMonthlyRent), sub: `Max: ${formatCurrency(stats.maxPossibleRent)}` },
				{ label: 'Collected This Month', value: formatCurrency(stats.currentMonthCollected), sub: `${stats.currentMonthlyRent > 0 ? Math.round((stats.currentMonthCollected / stats.currentMonthlyRent) * 100) : 0}% of expected` },
				{ label: 'Outstanding Balance', value: formatCurrency(stats.totalOutstanding), sub: `${stats.tenantsWithBalance} tenant${stats.tenantsWithBalance !== 1 ? 's' : ''} with balance` },
				{ label: 'Year Total Collected', value: formatCurrency(stats.totalCollectedYear), sub: `${selectedYear}` },
			]

			html += '<div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:20px;">'
			statCards.forEach(card => {
				html += `
					<div style="flex:1 1 30%;min-width:200px;border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fafafa;">
						<div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">${card.label}</div>
						<div style="font-size:20px;font-weight:700;color:#111827;margin:4px 0 2px;">${card.value}</div>
						<div style="font-size:10px;color:#9ca3af;">${card.sub}</div>
					</div>
				`
			})
			html += '</div>'

			// Payment Status
			html += sectionTitle('Payment Status')
			html += '<div style="display:flex;gap:16px;margin-bottom:8px;">'
			const statusColors = { Paid: '#10b981', Partial: '#f59e0b', Unpaid: '#ef4444', 'Not Due': '#3b82f6' }
			Object.entries(statusCounts).forEach(([name, val]) => {
				html += `<div style="display:flex;align-items:center;gap:6px;font-size:13px;">
					<span style="width:12px;height:12px;border-radius:50%;background:${statusColors[name]};display:inline-block;"></span>
					<strong>${name}:</strong> ${val}
				</div>`
			})
			html += '</div>'

			// ── Page 2: Monthly Income Table ──
			html += sectionTitle(`Monthly Income Summary — ${selectedYear}`)
			html += '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">'
			html += `<thead><tr>
				<th style="${thStyle}">Month</th>
				<th style="${thStyle}text-align:right;">Expected</th>
				<th style="${thStyle}text-align:right;">Collected</th>
				<th style="${thStyle}text-align:right;">Difference</th>
				<th style="${thStyle}text-align:right;">Collection %</th>
			</tr></thead><tbody>`

			let yearExpected = 0, yearCollected = 0
			monthlyData.forEach(m => {
				if (m.isFuture) return
				const diff = m.rentCollected - m.currentExpected
				const pct = m.currentExpected > 0 ? Math.round((m.rentCollected / m.currentExpected) * 100) : 0
				yearExpected += m.currentExpected
				yearCollected += m.rentCollected
				const diffColor = diff >= 0 ? '#10b981' : '#ef4444'
				html += `<tr>
					<td style="${tdStyle}">${m.month}</td>
					<td style="${tdRight}">${formatCurrency(m.currentExpected)}</td>
					<td style="${tdRight}">${formatCurrency(m.rentCollected)}</td>
					<td style="${tdRight}color:${diffColor};">${diff >= 0 ? '+' : ''}${formatCurrency(Math.abs(diff))}</td>
					<td style="${tdRight}">${pct}%</td>
				</tr>`
			})
			const yearDiff = yearCollected - yearExpected
			html += `<tr style="font-weight:700;background:#f3f4f6;">
				<td style="${tdStyle}">TOTAL</td>
				<td style="${tdRight}">${formatCurrency(yearExpected)}</td>
				<td style="${tdRight}">${formatCurrency(yearCollected)}</td>
				<td style="${tdRight}color:${yearDiff >= 0 ? '#10b981' : '#ef4444'};">${yearDiff >= 0 ? '+' : ''}${formatCurrency(Math.abs(yearDiff))}</td>
				<td style="${tdRight}">${yearExpected > 0 ? Math.round((yearCollected / yearExpected) * 100) : 0}%</td>
			</tr>`
			html += '</tbody></table>'

			// ── Room Type Breakdown ──
			html += sectionTitle('Room Type Breakdown')
			html += '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">'
			html += `<thead><tr>
				<th style="${thStyle}">Type</th>
				<th style="${thStyle}text-align:right;">Total</th>
				<th style="${thStyle}text-align:right;">Occupied</th>
				<th style="${thStyle}text-align:right;">Vacant</th>
				<th style="${thStyle}text-align:right;">Occupancy %</th>
			</tr></thead><tbody>`
			Object.entries(stats.roomTypes).forEach(([type, data]) => {
				const vacant = data.total - data.occupied
				const occ = data.total > 0 ? Math.round((data.occupied / data.total) * 100) : 0
				html += `<tr>
					<td style="${tdStyle}text-transform:capitalize;">${type}</td>
					<td style="${tdRight}">${data.total}</td>
					<td style="${tdRight}">${data.occupied}</td>
					<td style="${tdRight}">${vacant}</td>
					<td style="${tdRight}">${occ}%</td>
				</tr>`
			})
			html += '</tbody></table>'

			// ── Occupancy Forecast (ML) ──
			if (forecastData) {
				html += sectionTitle('Occupancy Forecast (ML Prediction)')

				// Model metrics badges
				const metrics = forecastData.metrics || {}
				const forecast = forecastData.forecast || []
				const historical = forecastData.historical || []

				html += '<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">'
				if (metrics.mae != null) {
					html += `<div style="display:inline-flex;align-items:center;gap:4px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:4px 10px;font-size:11px;">
						<strong>MAE:</strong> ${(metrics.mae * 100).toFixed(1)}%
					</div>`
				}
				if (metrics.rmse != null) {
					html += `<div style="display:inline-flex;align-items:center;gap:4px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:4px 10px;font-size:11px;">
						<strong>RMSE:</strong> ${(metrics.rmse * 100).toFixed(1)}%
					</div>`
				}
				if (metrics.mape != null) {
					html += `<div style="display:inline-flex;align-items:center;gap:4px;background:#fefce8;border:1px solid #fef08a;border-radius:6px;padding:4px 10px;font-size:11px;">
						<strong>MAPE:</strong> ${metrics.mape.toFixed(1)}%
					</div>`
				}
				// Average predicted occupancy
				if (forecast.length > 0) {
					const avgPredicted = forecast.reduce((s, f) => s + (f.predicted_occupancy || 0), 0) / forecast.length
					html += `<div style="display:inline-flex;align-items:center;gap:4px;background:#faf5ff;border:1px solid #e9d5ff;border-radius:6px;padding:4px 10px;font-size:11px;">
						<strong>Avg Forecast:</strong> ${(avgPredicted * 100).toFixed(1)}%
					</div>`
				}
				html += '</div>'

				// Side-by-side: Historical (last 6) + Forecast (next 12)
				html += '<div style="display:flex;gap:16px;">'

				// Historical mini table (last 6 months)
				if (historical.length > 0) {
					const recentHistorical = historical.slice(-6)
					html += '<div style="flex:1;">'
					html += '<h3 style="font-size:13px;font-weight:600;color:#374151;margin:0 0 8px;">Recent Historical</h3>'
					html += '<table style="width:100%;border-collapse:collapse;">'
					html += `<thead><tr>
						<th style="${thStyle}">Month</th>
						<th style="${thStyle}text-align:right;">Occupancy</th>
					</tr></thead><tbody>`
					recentHistorical.forEach(h => {
						const [y, m] = h.month.split('-')
						const label = new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
						const rate = (h.occupancy_rate * 100).toFixed(1)
						const color = h.occupancy_rate >= 0.9 ? '#10b981' : h.occupancy_rate >= 0.7 ? '#f59e0b' : '#ef4444'
						html += `<tr>
							<td style="${tdStyle}">${label}</td>
							<td style="${tdRight}color:${color};font-weight:600;">${rate}%</td>
						</tr>`
					})
					html += '</tbody></table></div>'
				}

				// Forecast table (next 12 months)
				if (forecast.length > 0) {
					html += '<div style="flex:1;">'
					html += '<h3 style="font-size:13px;font-weight:600;color:#374151;margin:0 0 8px;">Predicted (Next 12 Months)</h3>'
					html += '<table style="width:100%;border-collapse:collapse;">'
					html += `<thead><tr>
						<th style="${thStyle}">Month</th>
						<th style="${thStyle}text-align:right;">Predicted</th>
					</tr></thead><tbody>`
					forecast.forEach(f => {
						const [y, m] = f.month.split('-')
						const label = new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
						const rate = (f.predicted_occupancy * 100).toFixed(1)
						const color = f.predicted_occupancy >= 0.9 ? '#10b981' : f.predicted_occupancy >= 0.7 ? '#f59e0b' : '#ef4444'
						html += `<tr>
							<td style="${tdStyle}">${label}</td>
							<td style="${tdRight}color:${color};font-weight:600;">${rate}%</td>
						</tr>`
					})
					html += '</tbody></table></div>'
				}

				html += '</div>' // end side-by-side
			}

			// ── Upcoming Dues ──
			html += sectionTitle('Upcoming Due Dates')
			if (upcomingDues.length === 0) {
				html += '<p style="font-size:12px;color:#6b7280;">No upcoming dues.</p>'
			} else {
				html += '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">'
				html += `<thead><tr>
					<th style="${thStyle}">Tenant</th>
					<th style="${thStyle}">Room</th>
					<th style="${thStyle}">Due Date</th>
					<th style="${thStyle}text-align:right;">Amount</th>
					<th style="${thStyle}text-align:right;">Paid</th>
					<th style="${thStyle}">Status</th>
				</tr></thead><tbody>`
				upcomingDues.slice(0, 30).forEach(due => {
					const statusBg = {
						unpaid: '#fef2f2', partial: '#fffbeb', overdue: '#fef2f2',
						'due today': '#fefce8', 'due soon': '#fff7ed',
						'this week': '#eff6ff', upcoming: '#f0fdf4'
					}
					html += `<tr style="background:${statusBg[due.status] || '#fff'};">
						<td style="${tdStyle}">${due.tenantName}</td>
						<td style="${tdStyle}">${due.room}</td>
						<td style="${tdStyle}">${due.dueDateFormatted}</td>
						<td style="${tdRight}">${formatCurrency(due.amount)}</td>
						<td style="${tdRight}">${formatCurrency(due.paidAmount)}</td>
						<td style="${tdStyle}text-transform:uppercase;font-size:10px;font-weight:600;">${due.status}</td>
					</tr>`
				})
				html += '</tbody></table>'
			}

			// ── Recent Transactions ──
			html += sectionTitle('Recent Transactions')
			if (recentTx.length === 0) {
				html += '<p style="font-size:12px;color:#6b7280;">No recent transactions.</p>'
			} else {
				html += '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">'
				html += `<thead><tr>
					<th style="${thStyle}">Date</th>
					<th style="${thStyle}">Tenant</th>
					<th style="${thStyle}">Room</th>
					<th style="${thStyle}">Type</th>
					<th style="${thStyle}text-align:right;">Amount</th>
				</tr></thead><tbody>`
				recentTx.forEach(tx => {
					const txDate = tx.date instanceof Date ? tx.date : new Date(tx.date)
					const type = tx.payment_type || tx.paymentType || 'N/A'
					html += `<tr>
						<td style="${tdStyle}">${txDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
						<td style="${tdStyle}">${tx.tenantName || 'Unknown'}</td>
						<td style="${tdStyle}">${tx.roomSection ? tx.roomSection.charAt(0).toUpperCase() : ''}${tx.roomNumber || ''}</td>
						<td style="${tdStyle}text-transform:capitalize;">${type}</td>
						<td style="${tdRight}">${formatCurrency(parseFloat(String(tx.amount || 0).replace(/,/g, '')) || 0)}</td>
					</tr>`
				})
				html += '</tbody></table>'
			}

			// Footer
			html += `
				<div style="margin-top:32px;padding-top:12px;border-top:1px solid #e5e7eb;text-align:center;">
					<p style="font-size:10px;color:#9ca3af;margin:0;">Generated by MP-SAN Tenant Management System • ${reportDate}</p>
				</div>
			`

			container.innerHTML = html

			// Wait for render
			await new Promise(r => setTimeout(r, 300))

			// Capture with html2canvas
			const canvas = await html2canvas(container, {
				scale: 2,
				useCORS: true,
				backgroundColor: '#ffffff',
				logging: false,
			})

			// Generate PDF
			const imgData = canvas.toDataURL('image/png')
			const pdf = new jsPDF('p', 'mm', 'a4')
			const pdfWidth = pdf.internal.pageSize.getWidth()
			const pdfHeight = pdf.internal.pageSize.getHeight()
			const imgWidth = pdfWidth - 20 // 10mm margins
			const imgHeight = (canvas.height * imgWidth) / canvas.width

			let heightLeft = imgHeight
			let position = 10

			// First page
			pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight)
			heightLeft -= (pdfHeight - 20)

			// Additional pages if needed
			while (heightLeft > 0) {
				position = -(pdfHeight - 20) * (Math.ceil((imgHeight - heightLeft) / (pdfHeight - 20))) + 10
				pdf.addPage()
				pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight)
				heightLeft -= (pdfHeight - 20)
			}

			// Download
			const fileName = `${propName.replace(/[^a-zA-Z0-9]/g, '_')}_Report_${new Date().toISOString().slice(0, 10)}.pdf`
			pdf.save(fileName)

			// Cleanup
			document.body.removeChild(container)

		} catch (err) {
			console.error('Report generation error:', err)
			alert('Failed to generate report. Please try again.')
		} finally {
			setGeneratingReport(false)
		}
	}

	if (!property) {
		return (
			<div className="flex flex-col items-center justify-center min-h-[500px] text-center p-8">
				<div className="w-20 h-20 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-4">
					<FaHome className="w-10 h-10 text-blue-500" />
				</div>
				<h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">No Property Selected</h3>
				<p className="text-gray-500 dark:text-gray-400">Select a property to view the dashboard analytics.</p>
			</div>
		)
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center min-h-[500px]">
				<div className="text-center">
					<div className="animate-spin rounded-full h-12 w-12 border-3 border-blue-600 border-t-transparent mx-auto mb-4" />
					<p className="text-gray-500 dark:text-gray-400">Loading dashboard...</p>
				</div>
			</div>
		)
	}

	return (
		<div className="bg-gray-50 dark:bg-gray-900 min-h-screen flex flex-col">
			{/* Header */}
			<div className={`sticky top-0 z-20 bg-gray-50/80 dark:bg-gray-900/80 backdrop-blur-md px-6 py-4 transition-all duration-500 ${isHeaderVisible ? 'translate-y-0' : '-translate-y-full shadow-none'}`}>
				<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
					<div>
						<h1 className="text-2xl font-bold text-gray-900 dark:text-white">
							Dashboard
						</h1>
						<p className="text-gray-500 dark:text-gray-400 mt-1">
							{property.propertyName || property.name} • Analytics Overview
						</p>
					</div>

					{/* Filters */}
					<div className="flex items-center gap-3">
						<select
							value={selectedYear}
							onChange={e => setSelectedYear(Number(e.target.value))}
							className="hidden"
						>
							{yearOptions.map(y => (
								<option key={y} value={y}>{y}</option>
							))}
						</select>
						<button
							onClick={generateReport}
							disabled={generatingReport}
							className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
						>
							<FaFilePdf className="w-4 h-4" />
							{generatingReport ? 'Generating...' : 'Generate Report'}
						</button>
						<button
							onClick={fetchDashboardData}
							className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
						>
							<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
							</svg>
							Refresh
						</button>
					</div>
				</div>
			</div>

			<div className="p-6 pt-2 space-y-6 flex-1 pb-32">

				{/* Upcoming Dues & Todo List Row */}
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
					{/* Upcoming Dues */}
					<div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
						<div className="flex items-center justify-between mb-4">
							<div>
								<h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
									<IoCalendarOutline className="w-5 h-5 text-blue-500" />
									Upcoming Due Dates
								</h3>
								<p className="text-sm text-gray-500 dark:text-gray-400">Sorted by closest due date</p>
							</div>
							<span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-1 rounded-full">
								{upcomingDues.length} tenant{upcomingDues.length !== 1 ? 's' : ''}
							</span>
						</div>
						<div className="space-y-2 max-h-80 overflow-y-auto pr-1 scrollbar-thin">
							{upcomingDues.length === 0 ? (
								<div className="text-center py-8 text-gray-500 dark:text-gray-400">
									<IoCalendarOutline className="w-10 h-10 mx-auto mb-2 opacity-50" />
									<p>No upcoming dues</p>
								</div>
							) : (
								upcomingDues.map((due, idx) => (
									<div
										key={`${due.tenantId}-${due.room}`}
										onClick={() => {
											if (typeof onViewTenantProfile === 'function' && due.tenantId) {
												onViewTenantProfile(due.tenantId)
											}
										}}
										className={`flex items-center justify-between p-3 rounded-lg transition-colors ${typeof onViewTenantProfile === 'function' && due.tenantId ? 'cursor-pointer hover:ring-2 hover:ring-blue-300 dark:hover:ring-blue-700' : ''} ${due.status === 'overdue' || due.status === 'unpaid'
											? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
											: due.status === 'partial'
												? 'bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800'
												: due.status === 'due today'
													? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
													: due.status === 'due soon'
														? 'bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800'
														: 'bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600'
											}`}
									>
										<div className="flex items-center gap-3 flex-1 min-w-0">
											<div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${due.status === 'overdue' || due.status === 'unpaid'
												? 'bg-red-500 text-white'
												: due.status === 'partial'
													? 'bg-orange-500 text-white'
													: due.status === 'due today'
														? 'bg-amber-500 text-white'
														: due.status === 'due soon'
															? 'bg-orange-500 text-white'
															: 'bg-blue-500 text-white'
												}`}>
												{due.status === 'unpaid' || due.status === 'partial' ? '!' : (due.daysUntilDue < 0 ? Math.abs(due.daysUntilDue) : due.daysUntilDue)}
											</div>
											<div className="flex-1 min-w-0">
												<p className="font-medium text-sm truncate text-gray-900 dark:text-white">
													{due.tenantName}
												</p>
												<p className="text-xs text-gray-500 dark:text-gray-400">
													Room {due.room} • {due.dueDateFormatted}
												</p>
											</div>
										</div>
										<div className="text-right ml-2">
											<p className="font-semibold text-gray-900 dark:text-white text-sm">
												{formatCurrency(due.remainingAmount > 0 ? due.remainingAmount : due.amount)}
											</p>
											<p className={`text-xs font-medium ${due.status === 'overdue' || due.status === 'unpaid'
												? 'text-red-600 dark:text-red-400'
												: due.status === 'partial'
													? 'text-orange-600 dark:text-orange-400'
													: due.status === 'due today'
														? 'text-amber-600 dark:text-amber-400'
														: due.status === 'due soon'
															? 'text-orange-600 dark:text-orange-400'
															: 'text-blue-600 dark:text-blue-400'
												}`}>
												{due.status === 'unpaid'
													? 'Unpaid'
													: due.status === 'partial'
														? 'Partial payment'
														: due.daysUntilDue < 0
															? `${Math.abs(due.daysUntilDue)} day${Math.abs(due.daysUntilDue) !== 1 ? 's' : ''} overdue`
															: due.daysUntilDue === 0
																? 'Due today'
																: `${due.daysUntilDue} day${due.daysUntilDue !== 1 ? 's' : ''} left`
												}
											</p>
										</div>
									</div>
								))
							)}
						</div>
					</div>

					{/* Todo List */}
					<div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
						<div className="flex items-center justify-between mb-4">
							<div>
								<h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
									<MdChecklist className="w-5 h-5 text-purple-500" />
									Todo List
								</h3>
								<p className="text-sm text-gray-500 dark:text-gray-400">
									{todos.filter(t => !t.completed).length} pending task{todos.filter(t => !t.completed).length !== 1 ? 's' : ''}
								</p>
							</div>
							<button
								onClick={() => setShowCompletedTodos(!showCompletedTodos)}
								className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
							>
								{showCompletedTodos ? 'Hide' : 'Show'} completed
							</button>
						</div>

						{/* Add new todo */}
						<div className="flex gap-2 mb-4">
							<input
								type="text"
								value={newTodoText}
								onChange={(e) => setNewTodoText(e.target.value)}
								onKeyPress={(e) => e.key === 'Enter' && addTodo()}
								placeholder="Add a new task..."
								className="flex-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 dark:text-white placeholder-gray-400"
							/>
							<button
								onClick={addTodo}
								disabled={!newTodoText.trim()}
								className="px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
							>
								<FaPlus className="w-4 h-4" />
							</button>
						</div>

						{/* Todo items */}
						<div className="space-y-2 max-h-64 overflow-y-auto pr-1">
							{todos.length === 0 ? (
								<div className="text-center py-8 text-gray-500 dark:text-gray-400">
									<MdChecklist className="w-10 h-10 mx-auto mb-2 opacity-50" />
									<p>No tasks yet</p>
									<p className="text-xs mt-1">Add your first task above</p>
								</div>
							) : (
								<>
									{/* Pending todos */}
									{todos.filter(t => !t.completed).map(todo => (
										<div
											key={todo.id}
											className={`flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 group ${todo.priority === 'high' ? 'border-l-4 border-l-red-500' :
												todo.priority === 'low' ? 'border-l-4 border-l-gray-400' : ''
												}`}
										>
											<button
												onClick={() => toggleTodo(todo.id)}
												className="text-gray-400 hover:text-purple-500 transition-colors"
											>
												<FaRegCircle className="w-5 h-5" />
											</button>
											<span className="flex-1 text-sm text-gray-900 dark:text-white">
												{todo.text}
											</span>
											<div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
												<select
													value={todo.priority}
													onChange={(e) => setPriority(todo.id, e.target.value)}
													className="text-xs bg-transparent border-none text-gray-500 dark:text-gray-400 cursor-pointer focus:ring-0"
												>
													<option value="high">High</option>
													<option value="normal">Normal</option>
													<option value="low">Low</option>
												</select>
												<button
													onClick={() => deleteTodo(todo.id)}
													className="text-gray-400 hover:text-red-500 transition-colors p-1"
												>
													<FaTrash className="w-3 h-3" />
												</button>
											</div>
										</div>
									))}

									{/* Completed todos */}
									{showCompletedTodos && todos.filter(t => t.completed).length > 0 && (
										<>
											<div className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide mt-4 mb-2">
												Completed
											</div>
											{todos.filter(t => t.completed).map(todo => (
												<div
													key={todo.id}
													className="flex items-center gap-3 p-3 rounded-lg bg-gray-50/50 dark:bg-gray-700/30 border border-gray-100 dark:border-gray-700 group"
												>
													<button
														onClick={() => toggleTodo(todo.id)}
														className="text-green-500 hover:text-gray-400 transition-colors"
													>
														<FaCheckCircle className="w-5 h-5" />
													</button>
													<span className="flex-1 text-sm text-gray-400 dark:text-gray-500 line-through">
														{todo.text}
													</span>
													<button
														onClick={() => deleteTodo(todo.id)}
														className="text-gray-300 hover:text-red-500 transition-colors p-1 opacity-0 group-hover:opacity-100"
													>
														<FaTrash className="w-3 h-3" />
													</button>
												</div>
											))}
										</>
									)}
								</>
							)}
						</div>
					</div>
				</div>

				{/* Main Stats Grid - 2 cols on mobile, 3 cols on tablet/laptop, 6 cols on large desktop */}
				<div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-3 md:gap-4">
					<StatCard
						icon={FaUsers}
						label="Total Tenants"
						value={stats.totalTenants}
						subValue={`of ${stats.totalRooms} rooms`}
						color="blue"
					/>
					<StatCard
						icon={FaDoorOpen}
						label="Vacant Rooms"
						value={stats.vacantRooms}
						subValue={`${100 - stats.occupancyRate}% available`}
						color="cyan"
					/>
					<StatCard
						icon={FaMoneyBillWave}
						label="Monthly Income"
						value={formatCurrency(stats.currentMonthlyRent)}
						subValue="If all tenants pay"
						color="green"
					/>
					<StatCard
						icon={MdPayment}
						label={`Collected (${getMonthName(new Date().getMonth(), true)} ${selectedYear})`}
						value={formatCurrency(stats.currentMonthCollected)}
						subValue={`${stats.currentMonthlyRent > 0 ? Math.round((stats.currentMonthCollected / stats.currentMonthlyRent) * 100) : 0}% of expected`}
						color="purple"
					/>
					<StatCard
						icon={FaExclamationTriangle}
						label="Outstanding"
						value={formatCurrency(stats.totalOutstanding)}
						subValue={`${stats.tenantsWithBalance} tenant(s)`}
						color="yellow"
					/>
					<StatCard
						icon={FaCalendarAlt}
						label="Year Total"
						value={formatCurrency(stats.totalCollectedYear)}
						subValue={`${selectedYear}`}
						color="red"
					/>
				</div>

				{/* Charts Row */}
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
					{/* Income Chart */}
					<div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
						<div className="flex items-center justify-between mb-6">
							<div>
								<h3 className="text-lg font-semibold text-gray-900 dark:text-white">Income Overview</h3>
								<p className="text-sm text-gray-500 dark:text-gray-400">Monthly rent collection for {selectedYear}</p>
							</div>
							<div className="flex items-center gap-4 text-xs">
								<div className="flex items-center gap-1.5">
									<div className="w-3 h-3 rounded-full bg-blue-500" />
									<span className="text-gray-600 dark:text-gray-400">Collected</span>
								</div>
								<div className="flex items-center gap-1.5">
									<div className="w-3 h-3 rounded-full bg-emerald-500" />
									<span className="text-gray-600 dark:text-gray-400">Expected</span>
								</div>
							</div>
						</div>
						<div className="h-72 min-h-[200px] w-full">
							<ResponsiveContainer width="100%" height={288} minHeight={200}>
								<AreaChart data={monthlyData.filter(d => !d.isFuture)} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
									<defs>
										<linearGradient id="colorCollected" x1="0" y1="0" x2="0" y2="1">
											<stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.3} />
											<stop offset="95%" stopColor={COLORS.primary} stopOpacity={0} />
										</linearGradient>
										<linearGradient id="colorExpected" x1="0" y1="0" x2="0" y2="1">
											<stop offset="5%" stopColor={COLORS.success} stopOpacity={0.3} />
											<stop offset="95%" stopColor={COLORS.success} stopOpacity={0} />
										</linearGradient>
									</defs>
									<CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
									<XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#9CA3AF" />
									<YAxis tick={{ fontSize: 12 }} stroke="#9CA3AF" tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
									<Tooltip
										contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: '8px', color: '#fff' }}
										formatter={(value) => [formatCurrency(value), '']}
										labelStyle={{ color: '#9CA3AF' }}
									/>
									<Area type="monotone" dataKey="currentExpected" stroke={COLORS.success} strokeWidth={2} fillOpacity={1} fill="url(#colorExpected)" name="Expected" />
									<Area type="monotone" dataKey="rentCollected" stroke={COLORS.primary} strokeWidth={2} fillOpacity={1} fill="url(#colorCollected)" name="Collected" />
								</AreaChart>
							</ResponsiveContainer>
						</div>
					</div>

					{/* Occupancy Chart */}
					<div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
						<div className="flex items-center justify-between mb-6">
							<div>
								<h3 className="text-lg font-semibold text-gray-900 dark:text-white">Occupancy Rate</h3>
								<p className="text-sm text-gray-500 dark:text-gray-400">Current: {stats.occupancyRate}% occupied</p>
							</div>
							<div className="text-3xl font-bold text-emerald-500">{stats.occupancyRate}%</div>
						</div>
						<div className="h-72 min-h-[200px] w-full">
							<ResponsiveContainer width="100%" height={288} minHeight={200}>
								<BarChart data={monthlyData.filter(d => !d.isFuture)} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
									<CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
									<XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#9CA3AF" />
									<YAxis domain={[0, 100]} tick={{ fontSize: 12 }} stroke="#9CA3AF" tickFormatter={(v) => `${v}%`} />
									<Tooltip
										contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: '8px', color: '#fff' }}
										formatter={(value) => [`${value}%`, 'Occupancy']}
									/>
									<Bar dataKey="occupancyRate" fill={COLORS.success} radius={[4, 4, 0, 0]} />
								</BarChart>
							</ResponsiveContainer>
						</div>
					</div>
				</div>

				{/* Occupancy Forecast (ML) */}
				<OccupancyForecastChart propertyId={property?.id} />

				{/* Bottom Row */}
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
					{/* Payment Status Pie Chart */}
					<div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
						<h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Payment Status</h3>
						<p className="text-sm text-gray-500 dark:text-gray-400 mb-4">This month's rent status breakdown</p>
						<div className="h-52 min-h-[200px] w-full">
							<ResponsiveContainer width="100%" height={208} minHeight={200}>
								<PieChart>
									<Pie
										data={paymentStatusData}
										cx="50%"
										cy="50%"
										innerRadius={50}
										outerRadius={80}
										paddingAngle={3}
										dataKey="value"
									>
										{paymentStatusData.map((entry, index) => (
											<Cell key={`cell-${index}`} fill={entry.color} />
										))}
									</Pie>
									<Tooltip
										contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: '8px', color: '#fff' }}
										formatter={(value, name) => [`${value} tenant(s)`, name]}
									/>
								</PieChart>
							</ResponsiveContainer>
						</div>
						<div className="flex flex-wrap justify-center gap-4 mt-2">
							{paymentStatusData.map((entry, index) => (
								<div key={index} className="flex items-center gap-2">
									<div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
									<span className="text-xs text-gray-600 dark:text-gray-400">
										{entry.name}: {entry.value}
									</span>
								</div>
							))}
						</div>
					</div>

					{/* Recent Transactions */}
					<div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
						<div className="flex items-center justify-between mb-4">
							<div>
								<h3 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Payments</h3>
								<p className="text-sm text-gray-500 dark:text-gray-400">Latest transactions</p>
							</div>
							<MdOutlineAccessTime className="w-5 h-5 text-gray-400" />
						</div>
						<div className="overflow-x-auto">
							<table className="w-full">
								<thead>
									<tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
										<th className="text-left py-2 font-medium">Tenant</th>
										<th className="text-left py-2 font-medium">Room</th>
										<th className="text-left py-2 font-medium">Date</th>
										<th className="text-right py-2 font-medium">Amount</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-100 dark:divide-gray-700">
									{stats.recentTransactions.length === 0 ? (
										<tr>
											<td colSpan="4" className="py-8 text-center text-gray-500 dark:text-gray-400">
												No recent payments
											</td>
										</tr>
									) : (
										stats.recentTransactions.map((tx, idx) => (
											<tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
												<td className="py-3">
													<span className="font-medium text-gray-900 dark:text-white text-sm">{tx.tenantName}</span>
												</td>
												<td className="py-3">
													<span className="text-gray-600 dark:text-gray-400 text-sm">
														{tx.roomSection ? `${tx.roomSection.charAt(0).toUpperCase()}${tx.roomNumber}` : tx.roomNumber}
													</span>
												</td>
												<td className="py-3">
													<span className="text-gray-500 dark:text-gray-400 text-sm">
														{tx.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
													</span>
												</td>
												<td className="py-3 text-right">
													<span className="font-semibold text-emerald-600 dark:text-emerald-400 text-sm">
														{formatCurrency(parseFloat(String(tx.amount || 0).replace(/,/g, '')) || 0)}
													</span>
												</td>
											</tr>
										))
									)}
								</tbody>
							</table>
						</div>
					</div>
				</div>

				{/* Room Type Stats */}
				{Object.keys(stats.roomTypes).length > 1 && (
					<div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
						<h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Room Type Breakdown</h3>
						<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
							{Object.entries(stats.roomTypes).map(([type, data]) => (
								<div key={type} className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 text-center">
									<p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
										{type === 'room' ? 'Standard' : type.charAt(0).toUpperCase() + type.slice(1)}
									</p>
									<p className="text-2xl font-bold text-gray-900 dark:text-white">{data.occupied}/{data.total}</p>
									<p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
										{data.total > 0 ? Math.round((data.occupied / data.total) * 100) : 0}% occupied
									</p>
								</div>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

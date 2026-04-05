import { useState, useEffect, useRef } from 'react'
import { authFetch, getAccess, buildWsUrl } from '../auth.js'
import TenantListView from './TenantListView.jsx'
import TenantProfile from './TenantProfile.jsx'
import PaymentHistoryView from './PaymentHistoryView.jsx'
import BalanceListView from './BalanceListView.jsx'
import RoomsListView from './RoomsListView.jsx'
import RoomProfile from './RoomProfile.jsx'
import RentCollectedListView from './RentCollectedListView.jsx'
import AddTenant from './AddTenant.jsx'
import { HiOfficeBuilding } from 'react-icons/hi'

// Due day always derived from move-in date (consistent with RoomSidebar/TenantProfile)
function getDueDay(room) {
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
function getLastDueDateInPast(today, dueDay) {
	if (dueDay == null || dueDay < 1) return null
	let y = today.getFullYear()
	let m = today.getMonth()
	const lastDay = new Date(y, m + 1, 0).getDate()
	const day = Math.min(dueDay, lastDay)
	let due = new Date(y, m, day)
	if (due > today) {
		m -= 1
		if (m < 0) { m = 11; y -= 1 }
		const lastDayPrev = new Date(y, m + 1, 0).getDate()
		due = new Date(y, m, Math.min(dueDay, lastDayPrev))
	}
	return due
}
function isRentPaymentType(type) {
	const v = (type ?? '').toString().toLowerCase().trim()
	return v === 'rent' || v === 'monthly_rent' || v === 'monthly rent'
}
function hasRentPaymentForPeriod(transactions, dueDate, tenantId) {
	if (!transactions || !Array.isArray(transactions)) return false
	const dueY = dueDate.getFullYear()
	const dueM = dueDate.getMonth()
	const tid = String(tenantId)
	return transactions.some(t => {
		if (!isRentPaymentType(t.payment_type || t.paymentType)) return false
		const tId = t.tenant_id ?? t.id
		if (tId != null && String(tId) !== tid) return false
		const d = t.date || t.timestamp
		if (!d) return false
		try {
			const dt = new Date(d)
			return dt.getFullYear() === dueY && dt.getMonth() === dueM
		} catch {
			return false
		}
	})
}

// Sum of rent payments for the same month/year as dueDate (for partial-payment detection)
function getRentPaidSumForPeriod(transactions, dueDate, tenantId) {
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

// Format room number for display (used by buildBalanceFromRooms; must match component logic)
function formatRoomNumberForBalance(room) {
	const number = room.number || ''
	const type = room.type || 'room'
	const section = room.section || ''
	if (type === 'commercial') return `C${number}`
	if (section) return `${section.charAt(0).toUpperCase()}${number}`
	return number
}

// Build balance list, due-today list, and partial payers from allRooms (shared by initial fetch and WebSocket update)
function buildBalanceFromRooms(allRooms) {
	const today = new Date()
	today.setHours(0, 0, 0, 0)
	const balanceList = []
	const partialPayersList = []
	for (const room of allRooms) {
		if (!room.tenant || room.status !== 'occupied') continue
		const tenantId = room.tenant.tenant_id ?? room.tenant.id
		const monthlyRent = parseFloat(room.payment) || 0
		const unitNumber = formatRoomNumberForBalance(room)
		const baseRow = {
			tenant_id: tenantId,
			full_name: room.tenant.full_name || room.tenant.name || 'N/A',
			due_date_display: null,
			amount_owed: 0,
			unit_number: unitNumber,
			reason_display: ''
		}
		const dueDay = getDueDay(room)
		if (dueDay != null) {
			const dueDate = getLastDueDateInPast(today, dueDay)
			if (dueDate) {
				const moveIn = room.tenant?.move_in || room.tenant?.date_of_occupancy
				let afterMoveIn = true
				if (moveIn) {
					const moveInDate = new Date(moveIn)
					moveInDate.setHours(0, 0, 0, 0)
					afterMoveIn = dueDate >= moveInDate
				}
				if (afterMoveIn) {
					const dueDateOnly = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate())
					const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())
					// Skip if due date is in the future (not yet due)
					if (dueDateOnly > todayOnly) continue
					// Skip if due date is TODAY and no payment made yet - they still have time to pay
					// Only show in balance list if they're PAST due (dueDateOnly < todayOnly) OR have partial payment
					const isDueToday = dueDateOnly.getTime() === todayOnly.getTime()
					const moveInDate = moveIn ? new Date(moveIn) : null
					if (moveInDate && room.tenant.advance_paid === true &&
						dueDate.getMonth() === moveInDate.getMonth() && dueDate.getFullYear() === moveInDate.getFullYear()) {
						continue
					}
					const rentPaidSum = getRentPaidSumForPeriod(room.transactions, dueDate, tenantId)
					if (rentPaidSum >= monthlyRent) continue
					// If due today and no payment yet, don't add to balance list (they still have time)
					// Only add if: past due OR has partial payment (partial means they started paying but didn't finish)
					if (isDueToday && rentPaidSum === 0) continue
					if (rentPaidSum === 0) {
						// Past due with no payment
						balanceList.push({
							...baseRow,
							due_date_display: dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
							amount_owed: monthlyRent,
							reason_display: 'Rent overdue'
						})
					} else {
						// Partial payment (could be due today or past due)
						const remaining = monthlyRent - rentPaidSum
						balanceList.push({
							...baseRow,
							due_date_display: dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
							amount_owed: remaining,
							reason_display: 'Partial rent (remaining)'
						})
						partialPayersList.push({
							tenant_id: tenantId,
							name: baseRow.full_name,
							room: unitNumber,
							paidSoFar: rentPaidSum,
							monthlyRent,
							remainingBalance: remaining
						})
					}
				}
			}
		}
		if (room.tenant.advance_paid !== true) {
			const advanceAmount = parseFloat(room.tenant.advance_amount) || monthlyRent
			balanceList.push({
				...baseRow,
				due_date_display: '—',
				amount_owed: advanceAmount,
				reason_display: 'Advance not paid'
			})
		}
		if (room.tenant.deposit_paid !== true) {
			const depositAmount = parseFloat(room.tenant.deposit_amount) || monthlyRent
			balanceList.push({
				...baseRow,
				due_date_display: '—',
				amount_owed: depositAmount,
				reason_display: 'Deposit not paid'
			})
		}
	}
	const withBalance = balanceList.map(row => ({
		name: row.full_name,
		tenantId: row.tenant_id,
		paymentDue: row.due_date_display ?? '—',
		amount: row.amount_owed,
		room: row.unit_number,
		status: row.reason_display
	}))
	const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())
	const dueTodayList = []
	for (const room of allRooms) {
		if (!room.tenant || room.status !== 'occupied') continue
		if (room.tenant.advance_paid !== true || room.tenant.deposit_paid !== true) continue
		const tenantId = room.tenant.tenant_id ?? room.tenant.id
		const dueDay = getDueDay(room)
		if (dueDay == null) continue
		const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
		const dueDayCapped = Math.min(dueDay, lastDayOfMonth)
		const dueDateOnly = new Date(today.getFullYear(), today.getMonth(), dueDayCapped)
		if (dueDateOnly.getTime() !== todayOnly.getTime()) continue
		const moveIn = room.tenant?.move_in || room.tenant?.date_of_occupancy
		if (moveIn) {
			const moveInDate = new Date(moveIn)
			moveInDate.setHours(0, 0, 0, 0)
			if (dueDateOnly.getMonth() === moveInDate.getMonth() && dueDateOnly.getFullYear() === moveInDate.getFullYear()) continue
			if (dueDateOnly < moveInDate) continue
		}
		if (hasRentPaymentForPeriod(room.transactions, dueDateOnly, tenantId)) continue
		const monthlyRent = parseFloat(room.payment) || 0
		dueTodayList.push({
			tenantId: tenantId,
			name: room.tenant.full_name || room.tenant.name || 'N/A',
			paymentDue: dueDateOnly.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
			amount: monthlyRent,
			room: formatRoomNumberForBalance(room),
			status: 'Due today'
		})
	}
	return { withBalance, dueTodayList, partialPayersList }
}

// Calculate total collected from transactions (rent + advance + deposit - refunds)
function calculateTotalCollected(transactions) {
	const collected = []
	const refunds = []

	transactions.forEach(t => {
		const rawType = (t.paymentType ?? t.payment_type ?? '').toString().toLowerCase()
		if (rawType.includes('refund')) {
			refunds.push(t)
		} else if (!rawType.includes('damage')) {
			// Include rent, advance, deposit, but exclude damages
			collected.push(t)
		}
	})

	const sum = (arr) => arr.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0)
	const totalCollected = sum(collected)
	const totalRefunds = sum(refunds)
	return totalCollected - Math.abs(totalRefunds)
}

const Reports = ({ property, onOpenAddTenant, refreshKey }) => {
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

	const [viewingTenantId, setViewingTenantId] = useState(null)
	const [viewingRoom, setViewingRoom] = useState(null) // { property, rawRoom, roomDisplay } when viewing a room profile
	const [stats, setStats] = useState({
		totalTenants: 0,
		rentCollected: 0,
		vacantSlots: 0,
		hasBalance: 0,
		amountExpected: 0,
		totalRooms: 0
	})
	const [tenantsWithBalance, setTenantsWithBalance] = useState([])
	const [tenantsDueToday, setTenantsDueToday] = useState([])
	const [recentPayments, setRecentPayments] = useState([])
	const [allPayments, setAllPayments] = useState([])
	const [partialPayers, setPartialPayers] = useState([])
	const [allTenants, setAllTenants] = useState([])
	const [tenantReceivables, setTenantReceivables] = useState([]) // { tenant_id, full_name, room, receivables } for PDF
	const [showPreviousTenants, setShowPreviousTenants] = useState(false)
	const [loading, setLoading] = useState(true)
	const [view, setView] = useState('reports') // 'reports', 'tenants', 'add-tenant', 'payments', 'balance', 'rent-collected', 'rooms'
	const [properties, setProperties] = useState([])
	const emptyRooms = []  // Stable reference to prevent infinite re-renders in AddTenant

	// CSV Import modal state
	const [showImportModal, setShowImportModal] = useState(false)
	const [importMode, setImportMode] = useState('tenants') // 'tenants' or 'payments'
	const [importFile, setImportFile] = useState(null)
	const [importPreview, setImportPreview] = useState([])
	const [totalImportRows, setTotalImportRows] = useState(0)
	const [importing, setImporting] = useState(false)
	const [importResult, setImportResult] = useState(null) // { imported, errors }
	const fileInputRef = useRef(null)

	useEffect(() => {
		if (!property) {
			setLoading(false)
			return
		}
		fetchReportData()
	}, [property, refreshKey])

	// WebSocket listener for real-time updates across browser sessions
	// Silently updates data without disrupting the user
	useEffect(() => {
		if (!property || !property.id) return

		let ws
		const wsRef = { current: null }
		const currentPropRef = { id: property.id }
		const token = getAccess()
		const qs = token ? `?token=${encodeURIComponent(token)}` : ''
		const url = buildWsUrl(`/ws/properties/${property.id}/${qs}`)

		// Delay websocket creation slightly to avoid race when switching properties
		const connectTimer = setTimeout(() => {
			if (currentPropRef.id !== property.id) return
			try {
				ws = new WebSocket(url)
			} catch (e) {
				console.warn('Reports WebSocket failed to connect', e)
				return
			}

			wsRef.current = ws

			ws.onopen = () => {
				console.debug('Reports WS connected to', url)
			}
			ws.onclose = () => {
				console.debug('Reports WS disconnected', url)
			}
			ws.onerror = (err) => {
				console.warn('Reports WS error', err)
			}
			ws.onmessage = (ev) => {
				if (wsRef.current !== ws) return
				try {
					const msg = JSON.parse(ev.data)
					if (msg.type === 'layouts.update') {
						// Silently update recent payments from WebSocket data
						console.debug('Reports: Received layouts.update, silently updating data')
						const layouts = msg.layouts || {}
						updateFromLayouts(layouts)
					}
				} catch (e) {
					console.warn('Invalid WS message in Reports', e)
				}
			}
		}, 500)

		return () => {
			clearTimeout(connectTimer)
			currentPropRef.id = null
			try {
				if (wsRef.current) {
					wsRef.current.close()
					wsRef.current = null
				}
			} catch (e) { }
		}
	}, [property?.id])

	// Helper to update state from layouts data (used by both initial fetch and WebSocket)
	const updateFromLayouts = (layouts) => {
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

		// Collect all transactions from all rooms
		const allTransactions = []
		allRooms.forEach(room => {
			if (room.transactions && Array.isArray(room.transactions)) {
				room.transactions.forEach(tx => {
					const roomDisplay = formatRoomNumber(room)
					allTransactions.push({
						tenantId: tx.tenant_id ?? room.tenant?.tenant_id ?? room.tenant?.id,
						name: tx.name || tx.tenant_name || 'N/A',
						paymentDate: tx.date || new Date(tx.timestamp).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
						amount: parseFloat(tx.amount?.toString().replace(/,/g, '')) || 0,
						room: roomDisplay,
						status: tx.is_late ? 'Late' : 'Paid',
						timestamp: tx.timestamp || tx.date,
						paymentType: tx.payment_type ?? tx.paymentType
					})
				})
			}
		})

		// Sort by timestamp (most recent first) and take the latest 15
		allTransactions.sort((a, b) => {
			const dateA = new Date(a.timestamp)
			const dateB = new Date(b.timestamp)
			return dateB - dateA
		})
		const recent = allTransactions.slice(0, 15)

		// Update recent payments silently
		setRecentPayments(recent)

		// Also update stats and balance list (so "Has Balance" updates when layout changes, e.g. new tenant without deposit)
		const occupiedRooms = allRooms.filter(room => room.status === 'occupied' && room.tenant)
		const totalTenants = occupiedRooms.length
		const totalRooms = allRooms.length
		const vacantSlots = allRooms.filter(room => room.status === 'available').length
		const rentCollected = calculateTotalCollected(allTransactions)
		const amountExpected = allRooms.reduce((sum, room) => sum + (parseFloat(room.payment) || 0), 0)
		const { withBalance, dueTodayList, partialPayersList } = buildBalanceFromRooms(allRooms)

		setStats(prev => ({
			...prev,
			totalTenants,
			rentCollected,
			vacantSlots,
			hasBalance: withBalance.length,
			amountExpected,
			totalRooms
		}))
		setTenantsWithBalance(withBalance)
		setTenantsDueToday(dueTodayList)
		setPartialPayers(partialPayersList)
	}

	const fetchReportData = async () => {
		setLoading(true)
		try {
			// Fetch property layouts (includes all room data)
			const propertyRes = await authFetch(`/api/properties/${property.id}/layouts/`)
			if (!propertyRes.ok) {
				throw new Error('Failed to fetch property data')
			}
			const propertyData = await propertyRes.json()
			const layouts = propertyData.layouts || {}

			// Fetch all tenants (including inactive/removed ones)
			const tenantsRes = await authFetch('/api/tenants/')
			const allTenantsFromDB = tenantsRes.ok ? await tenantsRes.json() : []

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

			// Count tenants (occupied rooms)
			const occupiedRooms = allRooms.filter(room => room.status === 'occupied' && room.tenant)
			const totalTenants = occupiedRooms.length
			const totalRooms = allRooms.length
			const vacantSlots = allRooms.filter(room => room.status === 'available').length

			// Calculate rent collected (sum of all transactions: rent + advance + deposit - refunds)
			// Note: Moved after allTransactions is built (see below)
			let rentCollected = 0

			// Calculate amount expected (sum of all room payments - occupied + vacant)
			const amountExpected = allRooms.reduce((sum, room) => sum + (parseFloat(room.payment) || 0), 0)

			// Build balance list (same logic as BalanceListView so count matches)
			const { withBalance, dueTodayList, partialPayersList } = buildBalanceFromRooms(allRooms)

			// Collect all transactions from all rooms (single fetch — no extra GET for rent-collected list)
			const allTransactions = []
			allRooms.forEach(room => {
				if (room.transactions && Array.isArray(room.transactions)) {
					room.transactions.forEach(tx => {
						const roomDisplay = formatRoomNumber(room)
						allTransactions.push({
							tenantId: tx.tenant_id ?? room.tenant?.tenant_id ?? room.tenant?.id,
							name: tx.name || tx.tenant_name || 'N/A',
							paymentDate: tx.date || (tx.timestamp ? new Date(tx.timestamp).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'),
							amount: parseFloat(tx.amount?.toString().replace(/,/g, '')) || 0,
							room: roomDisplay,
							status: tx.is_late ? 'Paid Late' : 'Paid',
							timestamp: tx.timestamp || tx.date,
							paymentType: tx.payment_type ?? tx.paymentType,
							is_late: tx.is_late
						})
					})
				}
			})

			// Sort by timestamp (most recent first)
			allTransactions.sort((a, b) => {
				const dateA = new Date(a.timestamp)
				const dateB = new Date(b.timestamp)
				return dateB - dateA
			})
			const recent = allTransactions.slice(0, 15)

			// Calculate rent collected from all transactions (includes advance, deposit, rent, minus refunds)
			rentCollected = calculateTotalCollected(allTransactions)

			// Collect all tenants (current and previous)
			const tenantsList = []
			const currentTenantIds = new Set()

			// First, add all current tenants from rooms
			allRooms.forEach(room => {
				if (room.tenant) {
					const tenantId = room.tenant.tenant_id || room.tenant.id
					currentTenantIds.add(tenantId)
					const roomDisplay = formatRoomNumber(room)
					tenantsList.push({
						id: tenantId,
						name: room.tenant.full_name || room.tenant.name || 'N/A',
						dateStarted: room.tenant.move_in || room.tenant.date_of_occupancy || room.tenant.created_at || 'N/A',
						duePerMonth: parseFloat(room.payment) || 0,
						room: roomDisplay,
						status: room.status === 'occupied' ? 'Current' : 'Previous',
						isCurrent: room.status === 'occupied'
					})
				}
			})

			// Add removed/inactive tenants from the database
			if (Array.isArray(allTenantsFromDB)) {
				allTenantsFromDB.forEach(tenant => {
					const tenantId = tenant.tenant_id || tenant.id
					// Only add if not already in the current tenants list
					if (!currentTenantIds.has(tenantId)) {
						// Use last_payment for inactive tenants if payment is 0 or null
						const payment = parseFloat(tenant.payment) || parseFloat(tenant.last_payment) || 0
						tenantsList.push({
							id: tenantId,
							name: tenant.full_name || tenant.name || 'N/A',
							dateStarted: tenant.move_in || tenant.date_of_occupancy || tenant.created_at || 'N/A',
							duePerMonth: payment,
							room: tenant.last_room || 'N/A',
							status: 'Previous',
							isCurrent: false
						})
					}
				})
			}

			// Sort tenants: current first, then by name
			tenantsList.sort((a, b) => {
				if (a.isCurrent && !b.isCurrent) return -1
				if (!a.isCurrent && b.isCurrent) return 1
				return a.name.localeCompare(b.name)
			})

			setStats({
				totalTenants,
				rentCollected,
				vacantSlots,
				hasBalance: withBalance.length,
				amountExpected,
				totalRooms
			})
			// Build tenant receivables for Rent Collected PDF (one entry per tenant with receivables)
			const tenantReceivablesMap = {}
			allRooms.forEach(room => {
				if (room.tenant && room.tenant.receivables && room.tenant.receivables.length > 0) {
					const tid = room.tenant.tenant_id ?? room.tenant.id
					if (!tenantReceivablesMap[tid]) {
						tenantReceivablesMap[tid] = {
							tenant_id: tid,
							full_name: room.tenant.full_name || room.tenant.name || 'N/A',
							room: formatRoomNumber(room),
							receivables: room.tenant.receivables
						}
					}
				}
			})
			const tenantReceivablesList = Object.values(tenantReceivablesMap)

			setTenantsWithBalance(withBalance)
			setTenantsDueToday(dueTodayList)
			setRecentPayments(recent)
			setAllPayments(allTransactions)
			setPartialPayers(partialPayersList)
			setAllTenants(tenantsList)
			setTenantReceivables(tenantReceivablesList)
		} catch (error) {
			console.error('Error fetching report data:', error)
		} finally {
			setLoading(false)
		}
	}

	// Helper function to format room number with section/type prefix
	const formatRoomNumber = (room) => {
		const number = room.number || ''
		const type = room.type || 'room'
		const section = room.section || ''

		if (type === 'commercial') return `C${number}`
		if (section) return `${section.charAt(0).toUpperCase()}${number}`
		return number
	}

	if (!property) {
		return (
			<div className="w-full h-full flex items-center justify-center">
				<div className="text-center">
					<div className="text-xl font-semibold text-gray-700 dark:text-gray-300">No Property Selected</div>
					<div className="text-sm text-gray-500 dark:text-gray-400 mt-2">Select a property from the list to view reports</div>
				</div>
			</div>
		)
	}

	if (loading) {
		return (
			<div className="w-full h-full flex items-center justify-center">
				<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
			</div>
		)
	}

	const handleAddTenant = async () => {
		// Fetch all properties
		try {
			const propertiesRes = await authFetch('/api/properties/')
			if (propertiesRes.ok) {
				const propertiesData = await propertiesRes.json()
				setProperties(Array.isArray(propertiesData) ? propertiesData : [])
			}
		} catch (error) {
			console.error('Error fetching properties:', error)
		}
		setView('add-tenant')
	}

	const handlePropertyChange = async (propertyId) => {
		// This is called when user changes property in AddTenant dropdown
		// We don't need to do anything here as AddTenant handles fetching rooms internally
		return
	}

	// CSV Import handlers
	const handleDownloadTemplate = async () => {
		try {
			const endpoint = importMode === 'payments'
				? '/api/payments/import-csv-template/'
				: '/api/tenants/import-csv-template/'
			const res = await authFetch(endpoint)
			if (!res.ok) throw new Error('Failed to download template')
			const blob = await res.blob()
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = importMode === 'payments' ? 'payment_import_template.csv' : 'tenant_import_template.csv'
			a.click()
			URL.revokeObjectURL(url)
		} catch (err) {
			console.error('Template download error:', err)
			alert('Failed to download template')
		}
	}

	const handleFileSelect = (e) => {
		const file = e.target.files?.[0]
		if (!file) return
		setImportFile(file)
		setImportResult(null)

		// Parse CSV for preview
		const reader = new FileReader()
		reader.onload = (evt) => {
			const text = evt.target.result
			const lines = text.split('\n').filter(l => l.trim())
			if (lines.length < 2) {
				setImportPreview([])
				return
			}
			const headers = lines[0].split(',').map(h => h.trim().replace(/^\uFEFF/, ''))
			const totalDataRows = lines.length - 1
			setTotalImportRows(totalDataRows)
			const rows = []
			for (let i = 1; i < Math.min(lines.length, 11); i++) {
				const values = lines[i].split(',').map(v => v.trim())
				const row = {}
				headers.forEach((h, idx) => { row[h] = values[idx] || '' })
				rows.push(row)
			}
			setImportPreview(rows)
		}
		reader.readAsText(file)
	}

	const handleImport = async () => {
		if (!importFile || !property?.id) return
		setImporting(true)
		setImportResult(null)
		try {
			const formData = new FormData()
			formData.append('file', importFile)
			formData.append('property_id', property.id)
			const endpoint = importMode === 'payments'
				? '/api/payments/import-csv/'
				: '/api/tenants/import-csv/'
			const res = await authFetch(endpoint, {
				method: 'POST',
				body: formData,
			})
			const data = await res.json()
			if (!res.ok) {
				setImportResult({ imported: 0, updated: 0, errors: [{ row: 0, error: data.error || 'Import failed' }] })
			} else {
				setImportResult({ imported: data.imported || 0, updated: data.updated || 0, errors: data.errors || [] })
				if ((data.imported || 0) + (data.updated || 0) > 0) {
					fetchReportData()
				}
			}
		} catch (err) {
			setImportResult({ imported: 0, errors: [{ row: 0, error: err.message }] })
		} finally {
			setImporting(false)
		}
	}

	const closeImportModal = () => {
		setShowImportModal(false)
		setImportFile(null)
		setImportPreview([])
		setTotalImportRows(0)
		setImportResult(null)
		setImportMode('tenants')
	}

	// CSV/Excel Export handlers
	const handleExport = async (type) => {
		// type: 'tenants' or 'payments'
		try {
			const endpoint = type === 'tenants'
				? `/api/properties/${property.id}/export-tenants/`
				: `/api/properties/${property.id}/export-payments/`
			const res = await authFetch(endpoint)
			if (!res.ok) throw new Error('Export failed')
			const blob = await res.blob()
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = type === 'tenants' ? `${property.propertyName}_tenants.csv` : `${property.propertyName}_payments.csv`
			a.click()
			URL.revokeObjectURL(url)
		} catch (err) {
			console.error('Export error:', err)
			alert('Failed to export data')
		}
	}

	if (view === 'add-tenant') {
		return (
			<AddTenant
				rooms={emptyRooms}
				properties={properties}
				selectedPropertyId={property?.id}
				propertyId={property?.id}
				onPropertyChange={handlePropertyChange}
				onCancel={() => setView('tenants')}
				onSaved={() => {
					fetchReportData()
					setView('tenants')
				}}
			/>
		)
	}



	if (view === 'tenants') {
		return (
			<TenantListView
				property={property}
				onBack={() => setView('reports')}
				onAddTenant={handleAddTenant}
			/>
		)
	}

	if (view === 'payments') {
		return (
			<PaymentHistoryView
				property={property}
				onBack={() => setView('reports')}
			/>
		)
	}

	if (view === 'rent-collected') {
		return (
			<RentCollectedListView
				property={property}
				payments={allPayments}
				partialPayers={partialPayers}
				tenantReceivables={tenantReceivables}
				onBack={() => setView('reports')}
			/>
		)
	}

	if (view === 'balance') {
		if (viewingTenantId) {
			return (
				<TenantProfile
					tenantId={viewingTenantId}
					propertyName={property?.propertyName}
					onBack={() => setViewingTenantId(null)}
				/>
			)
		}
		return (
			<BalanceListView
				property={property}
				onBack={() => setView('reports')}
				onViewTenantProfile={(id) => setViewingTenantId(id)}
			/>
		)
	}

	if (view === 'rooms') {
		if (viewingRoom && viewingTenantId) {
			return (
				<TenantProfile
					tenantId={viewingTenantId}
					propertyName={viewingRoom.property?.propertyName}
					onBack={() => setViewingTenantId(null)}
				/>
			)
		}
		if (viewingRoom) {
			return (
				<RoomProfile
					property={viewingRoom.property}
					room={viewingRoom.rawRoom}
					roomDisplay={viewingRoom.roomDisplay}
					onBack={() => setViewingRoom(null)}
					onViewTenantProfile={(id) => setViewingTenantId(id)}
				/>
			)
		}
		return (
			<RoomsListView
				property={property}
				onBack={() => setView('reports')}
				onSelectRoom={(rawRoom, formattedRoom) => setViewingRoom({ property, rawRoom, roomDisplay: formattedRoom?.room_number })}
			/>
		)
	}

	if (viewingTenantId) {
		return (
			<TenantProfile
				tenantId={viewingTenantId}
				propertyName={property?.propertyName}
				onBack={() => setViewingTenantId(null)}
			/>
		)
	}

	return (
		<div className="w-full h-full flex flex-col bg-gray-50 dark:bg-gray-900">
			{/* Header with Title and Action Buttons */}
			<div className={`sticky top-0 z-20 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-800 px-6 py-5 flex-shrink-0 transition-all duration-500 ${isHeaderVisible ? 'translate-y-0' : '-translate-y-full shadow-none'}`}>
				<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
					<div className="flex items-center gap-4">
						<div className="w-12 h-12 bg-blue-600/10 dark:bg-blue-400/10 rounded-2xl flex items-center justify-center border border-blue-600/20 dark:border-blue-400/20">
							<HiOfficeBuilding className="w-6 h-6 text-blue-600 dark:text-blue-400" />
						</div>
						<div>
							<h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">{property.propertyName}</h1>
							<div className="flex items-center gap-2 mt-0.5">
								<div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
								<p className="text-sm font-medium text-gray-500 dark:text-gray-400">Property Overview & Statistics</p>
							</div>
						</div>
					</div>
					<div className="flex items-center gap-3">
						<button
							onClick={() => setShowImportModal(true)}
							className="flex-1 sm:flex-none px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 active:scale-95 group"
						>
							<svg className="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
							</svg>
							<span>Import CSV</span>
						</button>
					</div>
				</div>
			</div>

			<div className="flex-1 md:overflow-auto space-y-6 pb-28 md:pb-6 scrollbar-thin">
				{/* Quick Reports & Directory (Clickable) */}
				<div className="px-6 pt-6">
					<div className="flex items-center gap-2 mb-4">
						<div className="w-1.5 h-1.5 rounded-full bg-orange-500"></div>
						<h2 className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em]">Management Reports</h2>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
						{/* Tenants Directory */}
						<div
							onClick={() => setView('tenants')}
							className="group relative bg-white dark:bg-gray-800 rounded-2xl p-5 border-2 border-transparent hover:border-blue-500/30 dark:hover:border-blue-500/30 transition-all cursor-pointer overflow-hidden shadow-md hover:shadow-xl active:scale-[0.98]"
						>
							<div className="relative z-10 flex flex-col h-full justify-between">
								<div className="flex items-center justify-between mb-4">
									<div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110">
										<svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
											<path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
										</svg>
									</div>
									<div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
										<span className="text-[10px] font-bold uppercase tracking-tight opacity-0 group-hover:opacity-100 transition-opacity">Open</span>
										<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
									</div>
								</div>
								<div>
									<div className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">Tenant List</div>
									<div className="text-2xl font-black text-gray-900 dark:text-white leading-none whitespace-nowrap">{stats.totalTenants} Residents</div>
								</div>
							</div>
						</div>

						{/* Revenue Ledger */}
						<div
							onClick={() => setView('rent-collected')}
							className="group relative bg-white dark:bg-gray-800 rounded-2xl p-5 border-2 border-transparent hover:border-green-500/30 dark:hover:border-green-500/30 transition-all cursor-pointer overflow-hidden shadow-md hover:shadow-xl active:scale-[0.98]"
						>
							<div className="relative z-10 flex flex-col h-full justify-between">
								<div className="flex items-center justify-between mb-4">
									<div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110">
										<svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
											<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
										</svg>
									</div>
									<div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
										<span className="text-[10px] font-bold uppercase tracking-tight opacity-0 group-hover:opacity-100 transition-opacity">Open</span>
										<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
									</div>
								</div>
								<div>
									<div className="text-[10px] font-black text-gray-400 dark:text-gray-400 uppercase tracking-widest mb-1">Rent Ledger</div>
									<div className="text-2xl font-black text-gray-900 dark:text-white leading-none">₱{stats.rentCollected.toLocaleString()}</div>
								</div>
							</div>
						</div>

						{/* Delinquency Report */}
						<div
							onClick={() => setView('balance')}
							className="group relative bg-white dark:bg-gray-800 rounded-2xl p-5 border-2 border-transparent hover:border-red-500/30 dark:hover:border-red-500/30 transition-all cursor-pointer overflow-hidden shadow-md hover:shadow-xl active:scale-[0.98]"
						>
							<div className="relative z-10 flex flex-col h-full justify-between">
								<div className="flex items-center justify-between mb-4">
									<div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110">
										<svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20">
											<path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
										</svg>
									</div>
									<div className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
										<span className="text-[10px] font-bold uppercase tracking-tight opacity-0 group-hover:opacity-100 transition-opacity">Open</span>
										<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
									</div>
								</div>
								<div>
									<div className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">Delinquency</div>
									<div className="text-2xl font-black text-gray-900 dark:text-white uppercase leading-none">{stats.hasBalance} Accounts</div>
								</div>
							</div>
						</div>

						{/* Room Status */}
						<div
							onClick={() => setView('rooms')}
							className="group relative bg-white dark:bg-gray-800 rounded-2xl p-5 border-2 border-transparent hover:border-orange-500/30 dark:hover:border-orange-500/30 transition-all cursor-pointer overflow-hidden shadow-md hover:shadow-xl active:scale-[0.98]"
						>
							<div className="relative z-10 flex flex-col h-full justify-between">
								<div className="flex items-center justify-between mb-4">
									<div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110">
										<svg className="w-5 h-5 text-orange-600 dark:text-orange-400" fill="currentColor" viewBox="0 0 20 20">
											<path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
										</svg>
									</div>
									<div className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400">
										<span className="text-[10px] font-bold uppercase tracking-tight opacity-0 group-hover:opacity-100 transition-opacity">Open</span>
										<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
									</div>
								</div>
								<div>
									<div className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">Unit Status</div>
									<div className="text-2xl font-black text-gray-900 dark:text-white leading-none">All Units</div>
								</div>
							</div>
						</div>
					</div>
				</div>

				{/* Quick Stats Strip (Informational & Compact) */}
				<div className="px-6">
					<div className="bg-white/50 dark:bg-gray-800/40 backdrop-blur-sm rounded-2xl border border-gray-100 dark:border-gray-700/50 p-4">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-px">
							<div className="flex items-center justify-center gap-4 py-2">
								<div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
									<div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
								</div>
								<div>
									<div className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] mb-0.5">Available Units</div>
									<div className="text-base font-bold text-gray-900 dark:text-white tracking-tight">{stats.vacantSlots} Vacant <span className="text-gray-300 dark:text-gray-600 mx-2">/</span> {stats.totalRooms} Total</div>
								</div>
							</div>

							<div className="flex items-center justify-center gap-4 py-2 md:border-l border-gray-100 dark:border-gray-700/50">
								<div className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-900/20 flex items-center justify-center">
									<div className="w-2 h-2 rounded-full bg-teal-500"></div>
								</div>
								<div>
									<div className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] mb-0.5">Monthly Forecast</div>
									<div className="text-base font-bold text-gray-900 dark:text-white tracking-tight">₱{stats.amountExpected.toLocaleString()} Expected Revenue</div>
								</div>
							</div>
						</div>
					</div>
				</div>

				{/* Tenants Section Grid */}
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-6 px-6">
					{/* Tenant with Balance */}
					<div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden flex flex-col h-full hover:shadow-lg transition-shadow">
						<div className="px-6 py-4 bg-gray-50/50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
							<div className="flex items-center space-x-3">
								<div className="w-9 h-9 bg-red-100 dark:bg-red-900/30 rounded-xl flex items-center justify-center border border-red-200 dark:border-red-800">
									<svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20">
										<path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
									</svg>
								</div>
								<h2 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">Unpaid Balances</h2>
							</div>
							<div className="px-3 py-1 bg-red-100 dark:bg-red-900/30 rounded-full text-[10px] font-bold text-red-700 dark:text-red-400 uppercase tracking-widest">
								{tenantsWithBalance.length} Tenants
							</div>
						</div>
						<div className="flex-1 overflow-y-auto max-h-[400px] scrollbar-thin">
							{tenantsWithBalance.length > 0 ? (
								tenantsWithBalance.map((tenant, idx) => (
									<div key={idx} onClick={() => tenant.tenantId && setViewingTenantId(tenant.tenantId)} className={`group p-4 border-b border-gray-100 dark:border-gray-700 last:border-0 hover:bg-red-50/30 dark:hover:bg-red-900/10 transition-colors flex items-center justify-between gap-4 ${tenant.tenantId ? 'cursor-pointer' : ''}`}>
										<div className="flex items-center gap-3 min-w-0">
											<div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400 font-bold text-sm flex-shrink-0">
												{tenant.name.charAt(0)}
											</div>
											<div className="min-w-0">
												<div className="flex items-center gap-2">
													<span className="text-sm font-bold text-gray-900 dark:text-white truncate group-hover:text-red-600 transition-colors">{tenant.name}</span>
													<span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px] font-bold text-gray-500 dark:text-gray-400">
														{tenant.room}
													</span>
												</div>
												<div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-2">
													<span>Due: {tenant.paymentDue}</span>
													<span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
													<span className="font-medium text-red-500/80">{tenant.status}</span>
												</div>
											</div>
										</div>
										<div className="text-right flex-shrink-0">
											<div className="text-sm font-black text-red-600 dark:text-red-400">
												₱{tenant.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
											</div>
										</div>
									</div>
								))
							) : (
								<div className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
									<div className="flex flex-col items-center gap-2">
										<div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center border border-gray-200 dark:border-gray-700">
											<svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
											</svg>
										</div>
										<span className="font-medium">No tenant with balance</span>
									</div>
								</div>
							)}
						</div>
					</div>

					{/* Tenants due today */}
					<div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden flex flex-col h-full hover:shadow-lg transition-shadow">
						<div className="px-6 py-4 bg-gray-50/50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
							<div className="flex items-center space-x-3">
								<div className="w-9 h-9 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center border border-blue-200 dark:border-blue-800">
									<svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
										<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
									</svg>
								</div>
								<h2 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">Due Today</h2>
							</div>
							{tenantsDueToday.length > 0 && (
								<div className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 rounded-full text-[10px] font-bold text-blue-700 dark:text-blue-400 uppercase tracking-widest">
									{tenantsDueToday.length} Expected
								</div>
							)}
						</div>
						<div className="flex-1 overflow-y-auto max-h-[400px] scrollbar-thin">
							{tenantsDueToday.length > 0 ? (
								tenantsDueToday.map((tenant, idx) => (
									<div key={idx} onClick={() => tenant.tenantId && setViewingTenantId(tenant.tenantId)} className={`group p-4 border-b border-gray-100 dark:border-gray-700 last:border-0 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 transition-colors flex items-center justify-between gap-4 ${tenant.tenantId ? 'cursor-pointer' : ''}`}>
										<div className="flex items-center gap-3 min-w-0">
											<div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm flex-shrink-0">
												{tenant.name.charAt(0)}
											</div>
											<div className="min-w-0">
												<div className="flex items-center gap-2">
													<span className="text-sm font-bold text-gray-900 dark:text-white truncate group-hover:text-blue-600 transition-colors">{tenant.name}</span>
													<span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px] font-bold text-gray-500 dark:text-gray-400">
														{tenant.room}
													</span>
												</div>
												<div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-2">
													<span className="font-semibold text-blue-500/80">{tenant.status}</span>
												</div>
											</div>
										</div>
										<div className="text-right flex-shrink-0">
											<div className="text-sm font-black text-blue-600 dark:text-blue-400">
												₱{tenant.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
											</div>
										</div>
									</div>
								))
							) : (
								<div className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
									<div className="flex flex-col items-center gap-2">
										<div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
											<svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
											</svg>
										</div>
										<span className="font-medium">All caught up! No dues today.</span>
									</div>
								</div>
							)}
						</div>
					</div>
				</div>

				{/* Recent Payment */}
				<div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden mx-6 hover:shadow-lg transition-shadow">
					<div className="px-6 py-4 bg-gray-50/50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
						<div className="flex items-center space-x-3">
							<div className="w-9 h-9 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center border border-green-200 dark:border-green-800">
								<svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
									<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
								</svg>
							</div>
							<h2 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">Recent Activity</h2>
						</div>
						{recentPayments.length > 0 && (
							<div className="px-3 py-1 bg-green-100 dark:bg-green-900/30 rounded-full text-[10px] font-bold text-green-700 dark:text-green-400 uppercase tracking-widest">
								Last {Math.min(recentPayments.length, 15)} Payments
							</div>
						)}
					</div>
					<div className="overflow-y-auto max-h-[500px] scrollbar-thin">
						{recentPayments.length > 0 ? (
							recentPayments.slice(0, 15).map((payment, idx) => (
								<div key={idx} onClick={() => payment.tenantId && setViewingTenantId(payment.tenantId)} className={`group p-4 border-b border-gray-100 dark:border-gray-700 last:border-0 hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors flex items-center justify-between gap-4 ${payment.tenantId ? 'cursor-pointer' : ''}`}>
									<div className="flex items-center gap-4 min-w-0">
										<div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600 dark:text-green-400 font-bold text-sm flex-shrink-0">
											{payment.name.charAt(0)}
										</div>
										<div className="min-w-0">
											<div className="flex items-center gap-2 flex-wrap">
												<span className="text-sm font-bold text-gray-900 dark:text-white truncate group-hover:text-green-600 transition-colors">{payment.name}</span>
												<span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px] font-bold text-gray-500 dark:text-gray-400">
													Room {payment.room}
												</span>
											</div>
											<div className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-2">
												<span>{payment.paymentDate}</span>
												<span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
												<span className="font-medium text-green-600/80">{payment.status}</span>
											</div>
										</div>
									</div>
									<div className="text-right flex-shrink-0">
										<div className="text-base font-black text-gray-900 dark:text-white">
											₱{payment.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
										</div>
									</div>
								</div>
							))
						) : (
							<div className="px-6 py-16 text-center">
								<div className="flex flex-col items-center gap-3">
									<div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center border border-gray-200 dark:border-gray-700 shadow-inner">
										<svg className="w-8 h-8 text-gray-400 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
										</svg>
									</div>
									<div className="flex flex-col gap-1">
										<span className="text-base font-bold text-gray-900 dark:text-white">No transactions yet</span>
										<span className="text-sm text-gray-500 dark:text-gray-400">Recent payments will appear here.</span>
									</div>
								</div>
							</div>
						)}
					</div>
				</div>
			</div>

			{/* CSV Import Modal */}
			{showImportModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={closeImportModal}>
					<div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-gray-100 dark:border-gray-700" onClick={e => e.stopPropagation()}>
						<div className="px-6 py-5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
							<div>
								<h2 className="text-xl font-bold text-gray-900 dark:text-white">
									{importMode === 'payments' ? 'Import Payment History' : 'Import Tenants'} from CSV
								</h2>
								<p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
									{importMode === 'payments'
										? `Bulk import payment records into ${property?.propertyName}`
										: `Bulk add tenants to ${property?.propertyName}`
									}
								</p>
							</div>
							<button onClick={closeImportModal} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-all">
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
							</button>
						</div>

						<div className="p-6 space-y-5">
							{/* Mode toggle */}
							<div className="flex rounded-xl bg-gray-100 dark:bg-gray-900/50 p-1">
								<button
									onClick={() => { setImportMode('tenants'); setImportFile(null); setImportPreview([]); setTotalImportRows(0); setImportResult(null) }}
									className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition-all ${importMode === 'tenants' ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
								>
									Tenants
								</button>
								<button
									onClick={() => { setImportMode('payments'); setImportFile(null); setImportPreview([]); setTotalImportRows(0); setImportResult(null) }}
									className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition-all ${importMode === 'payments' ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
								>
									Payment History
								</button>
							</div>
							{/* Step 1: Download Template */}
							<div className="flex items-center gap-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
								<div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/40 rounded-xl flex items-center justify-center flex-shrink-0">
									<svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
									</svg>
								</div>
								<div className="flex-1">
									<p className="text-sm font-semibold text-blue-900 dark:text-blue-200">Need the right format?</p>
									<p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
										{importMode === 'payments'
											? 'Download the payment CSV template with columns: tenant_id, room, date, amount, type, etc.'
											: 'Download our CSV template with the correct column headers.'
										}
									</p>
								</div>
								<button
									onClick={handleDownloadTemplate}
									className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-all active:scale-95 whitespace-nowrap"
								>
									Download Template
								</button>
							</div>

							{/* Step 2: File picker */}
							<div>
								<label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-2">Select CSV File</label>
								<div
									onClick={() => fileInputRef.current?.click()}
									className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
								>
									<input
										ref={fileInputRef}
										type="file"
										accept=".csv"
										onChange={handleFileSelect}
										className="hidden"
									/>
									{importFile ? (
										<div className="flex items-center justify-center gap-3">
											<svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
											</svg>
											<div className="text-left">
												<p className="text-sm font-semibold text-gray-900 dark:text-white">{importFile.name}</p>
												<p className="text-xs text-gray-500 dark:text-gray-400">{(importFile.size / 1024).toFixed(1)} KB • Click to change</p>
											</div>
										</div>
									) : (
										<div>
											<svg className="w-10 h-10 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
											</svg>
											<p className="text-sm font-medium text-gray-600 dark:text-gray-300">Click to select a CSV file</p>
											<p className="text-xs text-gray-400 mt-1">or drag and drop</p>
										</div>
									)}
								</div>
							</div>

							{/* Step 3: Preview */}
							{importPreview.length > 0 && !importResult && (
								<div>
									<label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-2">
										Preview ({totalImportRows > importPreview.length ? `first ${importPreview.length} of ${totalImportRows} rows` : `${totalImportRows} row${totalImportRows > 1 ? 's' : ''}`})
									</label>
									<div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-xl">
										<table className="w-full text-xs">
											<thead>
												<tr className="bg-gray-50 dark:bg-gray-900/50">
													{Object.keys(importPreview[0]).map(key => (
														<th key={key} className="px-3 py-2 text-left font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">{key}</th>
													))}
												</tr>
											</thead>
											<tbody className="divide-y divide-gray-100 dark:divide-gray-700">
												{importPreview.map((row, idx) => (
													<tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
														{Object.values(row).map((val, i) => (
															<td key={i} className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">{val || '—'}</td>
														))}
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
							)}

							{/* Step 4: Results */}
							{importResult && (
								<div className="space-y-3">
									{(importResult.imported > 0 || importResult.updated > 0) && (
										<div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-800">
											<svg className="w-6 h-6 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
											</svg>
											<span className="text-sm font-semibold text-green-800 dark:text-green-200">
												{importMode === 'payments'
													? `Imported ${importResult.imported} payment record${importResult.imported !== 1 ? 's' : ''}`
													: <>
														{importResult.imported > 0 && `Imported ${importResult.imported} new tenant${importResult.imported > 1 ? 's' : ''}`}
														{importResult.imported > 0 && importResult.updated > 0 && ', '}
														{importResult.updated > 0 && `Updated ${importResult.updated} existing tenant${importResult.updated > 1 ? 's' : ''}`}
													</>
												}
											</span>
										</div>
									)}
									{importResult.errors?.length > 0 && (
										<div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800">
											<p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">
												{importResult.errors.length} error{importResult.errors.length > 1 ? 's' : ''}:
											</p>
											<div className="space-y-1 max-h-40 overflow-y-auto">
												{importResult.errors.map((err, idx) => (
													<p key={idx} className="text-xs text-red-700 dark:text-red-300">
														{err.row > 0 ? `Row ${err.row}: ` : ''}{err.error}
													</p>
												))}
											</div>
										</div>
									)}
								</div>
							)}
						</div>

						<div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3">
							<button
								onClick={closeImportModal}
								className="px-5 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
							>
								{importResult ? 'Close' : 'Cancel'}
							</button>
							{!importResult && (
								<button
									onClick={handleImport}
									disabled={!importFile || importing}
									className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 active:scale-95"
								>
									{importing ? (
										<>
											<div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
											<span>Importing...</span>
										</>
									) : (
										<>
											<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
											</svg>
											<span>Import {totalImportRows > 0 ? `${totalImportRows} ${importMode === 'payments' ? 'Payments' : 'Tenants'}` : ''}</span>
										</>
									)}
								</button>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

export default Reports

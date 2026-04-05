import { useState, useEffect, useRef, useMemo } from 'react'
import { authFetch } from '../auth.js'
import EditTenant from './EditTenant.jsx'
import RemoveTenantModal from './RemoveTenantModal.jsx'
import PaymentConfirmation from './PaymentConfirmation.jsx'
import SendReminderModal from './SendReminderModal.jsx'
import { getUnpaidMonths } from './paymentUtils.js'

const TenantProfile = ({ tenantId, onBack, propertyName }) => {
	const [tenant, setTenant] = useState(null)
	const [rentedRooms, setRentedRooms] = useState([]) // All rooms this tenant is renting (batch rent support)
	const [paymentHistory, setPaymentHistory] = useState([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState(null)
	const [showEditTenant, setShowEditTenant] = useState(false)
	const [showPaymentModal, setShowPaymentModal] = useState(false)
	const [openPaymentAsLate, setOpenPaymentAsLate] = useState(false)
	const [openPaymentAsBalancePayment, setOpenPaymentAsBalancePayment] = useState(false)
	const [paymentModalDefaultAmount, setPaymentModalDefaultAmount] = useState(null)
	const [paymentForMonth, setPaymentForMonth] = useState(null)
	const [showNotesModal, setShowNotesModal] = useState(false)
	const [notesContent, setNotesContent] = useState('')
	const [notesSaving, setNotesSaving] = useState(false)
	const notesEditorRef = useRef(null)
	const notesInitializedRef = useRef(false)
	const [showRemoveModal, setShowRemoveModal] = useState(false)
	const [showReminderModal, setShowReminderModal] = useState(false)
	const [showOverdueReminderModal, setShowOverdueReminderModal] = useState(false)
	const [showDocumentsModal, setShowDocumentsModal] = useState(false)
	const [documents, setDocuments] = useState([])
	const [documentsLoading, setDocumentsLoading] = useState(false)
	const [uploadingDoc, setUploadingDoc] = useState(false)
	const [viewingDocument, setViewingDocument] = useState(null) // Document being viewed in integrated viewer
	// Payment history date filter and pagination
	const PAYMENT_HISTORY_PAGE_SIZE = 20
	const [paymentHistoryDateFrom, setPaymentHistoryDateFrom] = useState('')
	const [paymentHistoryDateTo, setPaymentHistoryDateTo] = useState('')
	const [paymentHistoryPage, setPaymentHistoryPage] = useState(1)
	const [copiedItem, setCopiedItem] = useState(null)

	useEffect(() => {
		fetchTenantData()
	}, [tenantId])

	// Reset to page 1 when date filter changes
	useEffect(() => {
		setPaymentHistoryPage(1)
	}, [paymentHistoryDateFrom, paymentHistoryDateTo])

	// Initialize notes editor content when modal opens
	useEffect(() => {
		if (showNotesModal && notesEditorRef.current && !notesInitializedRef.current) {
			notesEditorRef.current.innerHTML = notesContent || ''
			notesInitializedRef.current = true
		}
		if (!showNotesModal) {
			notesInitializedRef.current = false
		}
	}, [showNotesModal, notesContent])

	// Merge received receivables into payment history (must run before any early return for hooks order)
	const displayPaymentHistory = useMemo(() => {
		const list = [...(paymentHistory || [])]
		const receivables = tenant?.receivables
		const receivedList = Array.isArray(receivables) ? receivables : []
		// Include items marked as received (backend may send true, "true", or 1)
		const received = receivedList.filter(r => r.received === true || r.received === 'true' || r.received === 1).map(r => {
			const receivedDate = r.received_at ? new Date(r.received_at) : null
			// Use actual received time so payment history sorts strictly by transaction time (latest at top)
			const sortTs = receivedDate ? receivedDate.getTime() : null
			return {
				id: r.id,
				timestamp: sortTs,
				date: r.received_at,
				payment_date: receivedDate ? receivedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '',
				amount: parseFloat(r.amount) || 0,
				notes: r.reason || 'Reimbursement',
				payment_type: 'receivable',
				paymentType: 'receivable',
				room_no: tenant?.unit_no || tenant?.room_no,
				method: '-',
				status: 'Received',
				is_receivable: true
			}
		})
		list.push(...received)
		// Normalize to ms so sort works (payment entries may have timestamp/date as ISO string or number from backend)
		const toMs = (item) => {
			const raw = item.timestamp ?? item.date ?? item.payment_date ?? item.created_at
			if (raw == null) return 0
			if (typeof raw === 'number' && !Number.isNaN(raw)) return raw
			const ms = (typeof raw === 'string' || raw instanceof Date) ? new Date(raw).getTime() : 0
			return Number.isNaN(ms) ? 0 : ms
		}
		list.sort((a, b) => {
			const ta = toMs(a)
			const tb = toMs(b)
			return tb - ta
		})
		return list
	}, [paymentHistory, tenant])

	// Filter payment history by date range and paginate
	const filteredAndPaginatedPaymentHistory = useMemo(() => {
		const toMs = (item) => {
			const raw = item.timestamp ?? item.date ?? item.payment_date ?? item.created_at
			if (raw == null) return 0
			if (typeof raw === 'number' && !Number.isNaN(raw)) return raw
			const ms = (typeof raw === 'string' || raw instanceof Date) ? new Date(raw).getTime() : 0
			return Number.isNaN(ms) ? 0 : ms
		}
		let filtered = displayPaymentHistory
		if (paymentHistoryDateFrom) {
			const startMs = new Date(paymentHistoryDateFrom).setHours(0, 0, 0, 0)
			filtered = filtered.filter((p) => toMs(p) >= startMs)
		}
		if (paymentHistoryDateTo) {
			const endMs = new Date(paymentHistoryDateTo).setHours(23, 59, 59, 999)
			filtered = filtered.filter((p) => toMs(p) <= endMs)
		}
		const totalFiltered = filtered.length
		const totalPages = Math.max(1, Math.ceil(totalFiltered / PAYMENT_HISTORY_PAGE_SIZE))
		const page = Math.min(Math.max(1, paymentHistoryPage), totalPages)
		const start = (page - 1) * PAYMENT_HISTORY_PAGE_SIZE
		const paginated = filtered.slice(start, start + PAYMENT_HISTORY_PAGE_SIZE)
		const filteredTotalPaid = filtered.reduce((sum, p) => {
			const amount = typeof p.amount === 'string' ? p.amount.replace(/,/g, '') : p.amount
			return sum + parseFloat(amount || 0)
		}, 0)
		return { paginated, totalFiltered, totalPages, currentPage: page, filteredTotalPaid }
	}, [displayPaymentHistory, paymentHistoryDateFrom, paymentHistoryDateTo, paymentHistoryPage])

	// Due date string for Send Reminder modal - must be before any early return (Rules of Hooks)
	const reminderDueDateStr = useMemo(() => {
		if (!tenant) return ''
		const today = new Date()
		const moveIn = tenant.move_in || tenant.date_of_occupancy
		let moveInDay = 1
		if (moveIn) {
			if (typeof moveIn === 'string' && moveIn.match(/^\d{4}-\d{2}-\d{2}/)) {
				moveInDay = parseInt(moveIn.split('-')[2], 10)
			} else {
				moveInDay = new Date(moveIn).getDate() || 1
			}
		}
		const day = Math.min(Math.max(1, moveInDay), 28)
		let next = new Date(today.getFullYear(), today.getMonth(), day)
		// If we're past this month's due day, show next month
		if (today > next) {
			next = new Date(today.getFullYear(), today.getMonth() + 1, day)
		}
		return next.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
	}, [tenant, tenant?.move_in, tenant?.date_of_occupancy])

	const { paginated: paginatedPaymentHistory, totalFiltered: totalFilteredCount, totalPages: paymentHistoryTotalPages, currentPage: paymentHistoryCurrentPage, filteredTotalPaid } = filteredAndPaginatedPaymentHistory

	// Multi-month unpaid tracking
	const unpaidMonths = useMemo(() => {
		if (!tenant) return []
		const monthlyRent = parseFloat(tenant.payment || tenant.rent || 0)
		if (monthlyRent <= 0) return []
		return getUnpaidMonths({
			moveInDate: tenant.move_in || tenant.date_of_occupancy,
			monthlyRent,
			transactions: paymentHistory,
			advancePaid: tenant.advance_paid !== false,
		})
	}, [tenant, paymentHistory])

	// Key of the latest partial rent payment (by date) — only that row should show "Pay Balance"
	const latestPartialRentPaymentKey = useMemo(() => {
		const toMs = (item) => {
			const raw = item.timestamp ?? item.date ?? item.payment_date ?? item.created_at
			if (raw == null) return 0
			if (typeof raw === 'number' && !Number.isNaN(raw)) return raw
			const ms = (typeof raw === 'string' || raw instanceof Date) ? new Date(raw).getTime() : 0
			return Number.isNaN(ms) ? 0 : ms
		}
		const now = new Date()
		const currentYear = now.getFullYear()
		const currentMonth = now.getMonth()
		const isRent = (p) => (p.payment_type || p.paymentType || 'rent') === 'rent' || (p.payment_type || p.paymentType) === 'monthly_rent'
		const isPartial = (p) => p.payment_status === 'partial' || (p.remaining_balance != null && Number(p.remaining_balance) > 0)
		const inCurrentMonth = (p) => {
			const d = new Date(p.timestamp || p.date || p.payment_date)
			return d.getFullYear() === currentYear && d.getMonth() === currentMonth
		}
		const first = displayPaymentHistory.find((p) => !p.is_receivable && isRent(p) && isPartial(p) && inCurrentMonth(p))
		if (!first) return null
		const key = first.id != null ? `id-${first.id}` : `ts-${toMs(first)}-${first.amount}-${first.room_no || ''}`
		return key
	}, [displayPaymentHistory])

	const getPaymentRowKey = (payment) => {
		if (payment.id != null && !payment.is_receivable) return `id-${payment.id}`
		const raw = payment.timestamp ?? payment.date ?? payment.payment_date ?? payment.created_at
		const ms = raw == null ? 0 : (typeof raw === 'number' ? raw : new Date(raw).getTime())
		return `ts-${ms}-${payment.amount}-${payment.room_no || ''}`
	}

	const handleCopy = (text, item) => {
		if (!text || text === 'N/A') return
		navigator.clipboard.writeText(text).then(() => {
			setCopiedItem(item)
			setTimeout(() => setCopiedItem(null), 2000)
		})
	}

	const fetchTenantData = async ({ silent = false } = {}) => {
		if (!silent) setLoading(true)
		setError(null)
		try {
			// Fetch tenant details from tenant endpoint
			const tenantRes = await authFetch(`/api/tenants/${tenantId}/`)
			if (!tenantRes.ok) {
				throw new Error('Failed to fetch tenant details')
			}
			let tenantData = await tenantRes.json()
			// Use canonical tenant id from server for matching transactions (handles refunds and type coercion)
			const canonicalTenantId = tenantData.tenant_id ?? tenantData.id ?? tenantId

			// Fetch all properties to find tenant's room(s) and payment history
			let allTransactions = []
			let allRentedRooms = [] // Collect all rooms this tenant is renting (batch rent support)
			const propertiesRes = await authFetch('/api/properties/')
			if (propertiesRes.ok) {
				const properties = await propertiesRes.json()

				// Search through property layouts to find this tenant's current/previous room(s)
				let mergedAdvanceDepositFromRoom = false
				for (const property of properties) {
					try {
						const layoutRes = await authFetch(`/api/properties/${property.id}/layouts/`)
						if (layoutRes.ok) {
							const layoutData = await layoutRes.json()
							const layouts = layoutData.layouts || {}

							// Search through all layout variants
							if (typeof layouts === 'object') {
								for (const variant in layouts) {
									const rooms = layouts[variant]
									if (Array.isArray(rooms)) {
										for (const room of rooms) {
											const roomTenant = room.tenant
											if (roomTenant && (roomTenant.tenant_id === tenantId || roomTenant.id === tenantId || String(roomTenant.tenant_id) === String(tenantId) || String(roomTenant.id) === String(tenantId))) {
												// Found the tenant! Merge room data with tenant data
												// Appliances can be stored at room level or tenant level
												const roomAppliances = room.appliances || roomTenant.appliances || []
												// Format room display with section prefix if available
												const roomType = room.type || 'room'
												const roomSection = room.section
												const roomFloor = room.floor || 1
												let displayRoomNo = room.number || tenantData.unit_no
												if (roomType === 'commercial') {
													displayRoomNo = `C${room.number}`
												} else if (roomSection) {
													// Use section initial + room number (e.g., "M1" for Male section room 1)
													displayRoomNo = `${roomSection.charAt(0).toUpperCase()}${room.number}`
												}

												// Add to rented rooms list
												allRentedRooms.push({
													room_number: displayRoomNo,
													floor: roomFloor,
													section: roomSection,
													type: roomType,
													payment: parseFloat(room.payment) || 0,
													property_name: property.name,
													property_id: property.id,
													status: room.status
												})

												// Use first found room's data for main tenant info (or merge if batch)
												if (!tenantData.property_id) {
													tenantData = {
														...tenantData,
														unit_no: displayRoomNo,
														room_no: displayRoomNo,
														room_number_raw: room.number,
														room_type: roomType,
														room_section: roomSection,
														payment: parseFloat(room.payment) || tenantData.payment,
														rent: parseFloat(room.payment) || tenantData.rent,
														occupants: room.occupancy || roomTenant.occupants || 1,
														number_of_occupants: room.occupancy || roomTenant.occupants || 1,
														other_occupants: roomTenant.other_occupants || [],
														appliances: roomAppliances,
														property_name: property.name,
														property_id: property.id,
														room_status: room.status,
														// So PaymentConfirmation shows "Unpaid" tags for advance/deposit
														advance_paid: roomTenant.advance_paid,
														deposit_paid: roomTenant.deposit_paid,
														advance_amount: roomTenant.advance_amount,
														deposit_amount: roomTenant.deposit_amount,
														receivables: Array.isArray(roomTenant.receivables) ? roomTenant.receivables : (tenantData.receivables || [])
													}
												} else if (!mergedAdvanceDepositFromRoom) {
													// API already had property_id; merge advance/deposit and receivables from first room (layout is source of truth)
													mergedAdvanceDepositFromRoom = true
													tenantData = {
														...tenantData,
														advance_paid: roomTenant.advance_paid,
														deposit_paid: roomTenant.deposit_paid,
														advance_amount: roomTenant.advance_amount,
														deposit_amount: roomTenant.deposit_amount,
														receivables: Array.isArray(roomTenant.receivables) ? roomTenant.receivables : (tenantData.receivables || [])
													}
												}
											}

											// Collect payment history for this tenant from any room (include refunds; match by canonical id)
											if (room.transactions && Array.isArray(room.transactions)) {
												const tenantTransactions = room.transactions.filter(t => {
													const tid = t.tenant_id ?? t.id
													if (tid == null) return false
													return tid === canonicalTenantId || tid === parseInt(canonicalTenantId) || String(tid) === String(canonicalTenantId)
												})
												// Format room number with type/section prefix for display
												let formattedRoomNo = room.number
												if ((room.type || 'room') === 'commercial') {
													formattedRoomNo = `C${room.number}`
												} else if (room.section) {
													formattedRoomNo = `${room.section.charAt(0).toUpperCase()}${room.number}`
												}
												tenantTransactions.forEach(t => {
													allTransactions.push({
														...t,
														// Use transaction's room_no if available, otherwise use formatted room number
														room_no: t.room_no || formattedRoomNo,
														property_name: property.name
													})
												})
											}
										}
									}
								}
							}
						}
					} catch (err) {
						console.error('Error fetching property layouts:', err)
					}
				}
			}

			// Sort payment history by timestamp descending
			allTransactions.sort((a, b) => {
				const dateA = new Date(a.timestamp || a.date)
				const dateB = new Date(b.timestamp || b.date)
				return dateB - dateA
			})
			setPaymentHistory(allTransactions)

			// Sort rented rooms by floor then room number
			allRentedRooms.sort((a, b) => {
				if (a.floor !== b.floor) return a.floor - b.floor
				return String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric: true })
			})
			setRentedRooms(allRentedRooms)

			// If tenant is inactive and has preserved data, use it
			if (tenantData.is_active === false) {
				if (tenantData.last_room && !tenantData.unit_no && !tenantData.room_no) {
					tenantData.unit_no = tenantData.last_room
					tenantData.room_no = tenantData.last_room
				}
				if (tenantData.last_payment && !tenantData.payment && !tenantData.rent) {
					tenantData.payment = parseFloat(tenantData.last_payment)
					tenantData.rent = parseFloat(tenantData.last_payment)
				}
			}

			setTenant(tenantData)
		} catch (err) {
			console.error('Error fetching tenant data:', err)
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	// Fetch documents for this tenant
	const fetchDocuments = async () => {
		setDocumentsLoading(true)
		try {
			const res = await authFetch(`/api/tenants/${tenantId}/documents/`)
			if (res.ok) {
				const data = await res.json()
				setDocuments(Array.isArray(data) ? data : data.results || [])
			}
		} catch (err) {
			console.error('Error fetching documents:', err)
		} finally {
			setDocumentsLoading(false)
		}
	}

	// Upload new document
	const handleDocumentUpload = async (files, documentType = 'other', description = '') => {
		if (!files || files.length === 0) return

		setUploadingDoc(true)
		try {
			const formData = new FormData()
			Array.from(files).forEach(file => {
				formData.append('files', file)
			})
			formData.append('document_type', documentType)
			if (description) {
				formData.append('description', description)
			}

			const res = await authFetch(`/api/tenants/${tenantId}/documents/upload/`, {
				method: 'POST',
				body: formData,
			})

			if (res.ok) {
				// Refresh documents list
				await fetchDocuments()
			} else {
				const err = await res.json().catch(() => ({}))
				console.error('Upload failed:', err)
				alert(err.error || err.errors?.join(', ') || 'Upload failed')
			}
		} catch (err) {
			console.error('Error uploading document:', err)
			alert('Failed to upload document')
		} finally {
			setUploadingDoc(false)
		}
	}

	// Delete a document
	const handleDocumentDelete = async (docId) => {
		if (!confirm('Are you sure you want to delete this document?')) return

		try {
			const res = await authFetch(`/api/tenants/${tenantId}/documents/${docId}/`, {
				method: 'DELETE',
			})

			if (res.ok || res.status === 204) {
				setDocuments(docs => docs.filter(d => d.document_id !== docId))
			} else {
				alert('Failed to delete document')
			}
		} catch (err) {
			console.error('Error deleting document:', err)
			alert('Failed to delete document')
		}
	}

	// Set a document as primary ID photo
	const handleSetPrimaryId = async (docId) => {
		try {
			const res = await authFetch(`/api/tenants/${tenantId}/documents/${docId}/`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ is_primary_id: true }),
			})

			if (res.ok) {
				await fetchDocuments()
				// Also refresh tenant data to update the id_photo_url
				fetchTenantData()
			}
		} catch (err) {
			console.error('Error setting primary ID:', err)
		}
	}

	const calculateDaysStayed = () => {
		if (!tenant?.move_in && !tenant?.date_of_occupancy) return 0
		const moveInDate = new Date(tenant.move_in || tenant.date_of_occupancy)
		const endDate = tenant.move_out || tenant.date_removed ? new Date(tenant.move_out || tenant.date_removed) : new Date()
		const diffTime = Math.abs(endDate - moveInDate)
		const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
		return diffDays
	}

	const countLatePayments = () => {
		return paymentHistory.filter(p =>
			p.status?.toLowerCase().includes('late') ||
			p.is_late === true
		).length
	}

	const getLastPaymentDate = () => {
		if (paymentHistory.length === 0) return null
		return paymentHistory[0].payment_date || paymentHistory[0].timestamp || paymentHistory[0].created_at
	}

	const formatDate = (dateStr) => {
		if (!dateStr) return 'N/A'
		const date = new Date(dateStr)
		return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
	}

	const formatShortDate = (dateStr) => {
		if (!dateStr) return 'N/A'
		const date = new Date(dateStr)
		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
	}

	const formatShortDateTime = (timestampStr, fallbackDateStr) => {
		const raw = timestampStr || fallbackDateStr
		if (!raw) return 'N/A'
		const date = new Date(raw)
		if (isNaN(date)) return 'N/A'
		const datePart = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
		// Only show time if the timestamp has a meaningful time (not midnight 00:00)
		const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0
		if (!hasTime) return datePart
		const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
		return `${datePart}, ${timePart}`
	}

	// Build and open print/PDF view: tenant info + transactions in current timeframe
	const openTenantPrintPdf = () => {
		if (!tenant) return
		const toMs = (item) => {
			const raw = item.timestamp ?? item.date ?? item.payment_date ?? item.created_at
			if (raw == null) return 0
			if (typeof raw === 'number' && !Number.isNaN(raw)) return raw
			const ms = (typeof raw === 'string' || raw instanceof Date) ? new Date(raw).getTime() : 0
			return Number.isNaN(ms) ? 0 : ms
		}
		let transactions = [...displayPaymentHistory]
		if (paymentHistoryDateFrom) {
			const startMs = new Date(paymentHistoryDateFrom).setHours(0, 0, 0, 0)
			transactions = transactions.filter((p) => toMs(p) >= startMs)
		}
		if (paymentHistoryDateTo) {
			const endMs = new Date(paymentHistoryDateTo).setHours(23, 59, 59, 999)
			transactions = transactions.filter((p) => toMs(p) <= endMs)
		}
		const totalInRange = transactions.reduce((sum, p) => {
			const amount = typeof p.amount === 'string' ? p.amount.replace(/,/g, '') : p.amount
			return sum + parseFloat(amount || 0)
		}, 0)
		const rangeLabel = paymentHistoryDateFrom && paymentHistoryDateTo
			? `${formatShortDate(paymentHistoryDateFrom)} – ${formatShortDate(paymentHistoryDateTo)}`
			: paymentHistoryDateFrom
				? `from ${formatShortDate(paymentHistoryDateFrom)}`
				: paymentHistoryDateTo
					? `through ${formatShortDate(paymentHistoryDateTo)}`
					: 'All time'
		const getTypeLabel = (payment) => {
			const t = payment.payment_type || payment.paymentType || 'rent'
			if (t === 'receivable') return 'Reimbursement received'
			if (t === 'advance_refund') return 'Advance Refund'
			if (t === 'deposit_refund') return 'Deposit Refund'
			if (t === 'advance') return 'Advance Payment'
			if (t === 'deposit') return 'Deposit Payment'
			if (t === 'utility') return 'Utilities'
			if (t === 'maintenance') return 'Maintenance'
			if (t === 'damages') return 'Damages'
			if (t === 'other') return 'Other'
			return 'Monthly Rent'
		}
		const rows = transactions.map((p) => {
			const amount = typeof p.amount === 'string' ? p.amount.replace(/,/g, '') : p.amount
			const amt = parseFloat(amount || 0)
			const isRefund = p.status === 'refund' || (p.payment_type || p.paymentType || '').includes('refund')
			return `<tr>
				<td class="cell">${formatShortDate(p.date || p.timestamp)}</td>
				<td class="cell">${getTypeLabel(p)}</td>
				<td class="cell num">${isRefund ? '' : '₱'}${amt.toLocaleString()}</td>
				<td class="cell">${p.room_no || tenant.unit_no || tenant.room_no || '—'}</td>
				<td class="cell">${p.method || (p.payment_type === 'receivable' ? '—' : 'Cash')}</td>
				<td class="cell">${p.status || (p.payment_type === 'receivable' ? 'Received' : 'Paid')}</td>
				<td class="cell">${(p.notes || '—').replace(/</g, '&lt;')}</td>
			</tr>`
		}).join('')
		const roomsList = rentedRooms.length > 0
			? rentedRooms.map((r) => `${r.room_number} (₱${(r.payment || 0).toLocaleString()})`).join(', ')
			: (tenant.unit_no || tenant.room_no || 'N/A')
		const receivables = Array.isArray(tenant.receivables) ? tenant.receivables : []
		const outstanding = receivables.filter((r) => !r.received && r.received !== 'true' && r.received !== 1)
		const outstandingTotal = outstanding.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
		const receivablesSection = receivables.length > 0
			? `<div class="section"><div class="section-title">Receivables (tenant owes you)</div><p>Outstanding: ₱${outstandingTotal.toLocaleString()} (${outstanding.length} item(s)). Total all: ₱${receivables.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0).toLocaleString()}.</p></div>`
			: ''
		const html = `
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>Tenant Profile — ${(tenant.full_name || 'Tenant').replace(/</g, '&lt;')}</title>
	<style>
		body { font-family: system-ui, sans-serif; padding: 20px; color: #111; max-width: 900px; margin: 0 auto; }
		h1 { font-size: 1.35rem; margin-bottom: 0.25rem; }
		.meta { color: #666; font-size: 0.9rem; margin-bottom: 20px; }
		.section { margin-bottom: 20px; break-inside: avoid; }
		.section-title { font-size: 1rem; margin-bottom: 8px; border-bottom: 1px solid #333; padding-bottom: 4px; font-weight: 600; }
		.info-table { width: 100%; max-width: 480px; border-collapse: collapse; font-size: 0.9rem; }
		.info-table td { padding: 4px 8px 4px 0; vertical-align: top; }
		.info-table td:first-child { color: #555; width: 140px; }
		.tbl { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-top: 8px; }
		.tbl th, .tbl td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
		.tbl th { background: #1e40af; color: #fff; }
		.tbl .num { text-align: right; }
		.total-row { font-weight: bold; border-top: 2px solid #333; }
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
	<h1>${(tenant.full_name || 'Tenant').replace(/</g, '&lt;')}</h1>
	<p class="meta">${propertyName || 'Tenant Profile'} — Printed ${new Date().toLocaleDateString('en-US', { dateStyle: 'medium' })}</p>
	<div class="section">
		<div class="section-title">Personal information</div>
		<table class="info-table">
			<tr><td>Tenant ID</td><td>${tenant.tenant_id ?? tenant.id ?? '—'}</td></tr>
			<tr><td>Email</td><td>${(tenant.email || '—').replace(/</g, '&lt;')}</td></tr>
			<tr><td>Phone</td><td>${(tenant.phone || '—').replace(/</g, '&lt;')}</td></tr>
			<tr><td>Home location</td><td>${(tenant.home_location || '—').replace(/</g, '&lt;')}</td></tr>
			<tr><td>Work place</td><td>${(tenant.work_place || '—').replace(/</g, '&lt;')}</td></tr>
		</table>
	</div>
	<div class="section">
		<div class="section-title">Occupancy</div>
		<table class="info-table">
			<tr><td>Room(s)</td><td>${roomsList.replace(/</g, '&lt;')}</td></tr>
			<tr><td>Move in</td><td>${formatShortDate(tenant.move_in || tenant.date_of_occupancy)}</td></tr>
			${tenant.move_out || tenant.date_removed ? `<tr><td>Move out</td><td>${formatShortDate(tenant.move_out || tenant.date_removed)}</td></tr>` : ''}
			<tr><td>Rent / payment</td><td>₱${(tenant.payment ?? tenant.rent ?? 0).toLocaleString()}</td></tr>
		</table>
	</div>
	${receivablesSection}
	<div class="section">
		<div class="section-title">Payment history — ${rangeLabel}</div>
		<table class="tbl">
			<thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Room</th><th>Method</th><th>Status</th><th>Notes</th></tr></thead>
			<tbody>${rows || '<tr><td class="cell" colspan="7">No transactions in this timeframe.</td></tr>'}</tbody>
		</table>
		<p style="margin-top:10px;font-weight:600;">Total in range: ₱${totalInRange.toLocaleString()} (${transactions.length} transaction(s))</p>
	</div>
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

	const formatPaymentDate = (dateStr) => {
		if (!dateStr) return 'N/A'
		const date = new Date(dateStr)
		return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
	}

	// Calculate payment status for current month
	const getPaymentStatus = () => {
		if (!tenant) return { status: 'unknown', label: 'Unknown', color: 'gray' }

		const today = new Date()
		today.setHours(0, 0, 0, 0)
		const currentMonth = today.getMonth()
		const currentYear = today.getFullYear()

		// 1. Not paid advance or deposit — show first (advance, then deposit, or both)
		const advancePaid = tenant.advance_paid === true
		const depositPaid = tenant.deposit_paid === true
		if (!advancePaid && !depositPaid) {
			return { status: 'not_paid_advance_deposit', label: 'Not paid advance & deposit', color: 'red' }
		}
		if (!advancePaid) {
			return { status: 'not_paid_advance', label: 'Not paid advance', color: 'amber' }
		}
		if (!depositPaid) {
			return { status: 'not_paid_deposit', label: 'Not paid deposit', color: 'purple' }
		}

		// Get move in date - parse manually to avoid timezone issues
		const moveInDateStr = tenant.move_in || tenant.date_of_occupancy
		if (!moveInDateStr) return { status: 'unknown', label: 'No Move-in Date', color: 'gray' }

		let moveInYear, moveInMonth, moveInDay
		if (typeof moveInDateStr === 'string' && moveInDateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
			const parts = moveInDateStr.split('-')
			moveInYear = parseInt(parts[0], 10)
			moveInMonth = parseInt(parts[1], 10) - 1 // JS months are 0-indexed
			moveInDay = parseInt(parts[2], 10)
		} else {
			const moveIn = new Date(moveInDateStr)
			moveInYear = moveIn.getFullYear()
			moveInMonth = moveIn.getMonth()
			moveInDay = moveIn.getDate()
		}
		const moveIn = new Date(moveInYear, moveInMonth, moveInDay)

		// Check if tenant moved in this month (will need to calculate due date for next month)
		const movedInThisMonth = moveInMonth === currentMonth && moveInYear === currentYear

		// Check payment history for current month (rent) payment — only count explicit rent, not advance/deposit
		const currentMonthPayments = paymentHistory.filter(p => {
			const pt = (p.payment_type || p.paymentType || '').toString().toLowerCase().trim()
			if (pt !== 'rent' && pt !== 'monthly_rent' && pt !== 'monthly rent') return false
			const paymentDate = new Date(p.timestamp || p.date || p.payment_date)
			paymentDate.setHours(0, 0, 0, 0)
			const paymentMonth = paymentDate.getMonth()
			const paymentYear = paymentDate.getFullYear()
			if (paymentMonth !== currentMonth || paymentYear !== currentYear) return false
			// Exclude move-in month payment on or before move-in (likely advance mis-recorded as rent)
			if (paymentMonth === moveInMonth && paymentYear === moveInYear && paymentDate <= moveIn) return false
			return true
		})

		// Payment day: always use move-in day
		const paymentDay = Math.min(Math.max(1, moveInDay), 31)

		// Calculate due date - if tenant moved in this month, first rent is due NEXT month
		let dueDateYear = currentYear
		let dueDateMonth = currentMonth

		if (movedInThisMonth) {
			// Push due date to next month
			dueDateMonth = currentMonth + 1
			if (dueDateMonth > 11) {
				dueDateMonth = 0
				dueDateYear = currentYear + 1
			}
		}

		const lastDayOfDueMonth = new Date(dueDateYear, dueDateMonth + 1, 0).getDate()
		const dueDay = Math.min(paymentDay, lastDayOfDueMonth)
		const dueDate = new Date(dueDateYear, dueDateMonth, dueDay)
		dueDate.setHours(0, 0, 0, 0)

		// If there are rent payments for current month, sum amounts and check full vs partial
		const monthlyRent = parseFloat(tenant.payment || tenant.rent || 0) || 0
		const parsePayAmount = (p) => {
			const raw = p.amount ?? 0
			const str = typeof raw === 'string' ? String(raw).replace(/,/g, '') : String(raw)
			return parseFloat(str) || 0
		}
		if (currentMonthPayments.length > 0) {
			const paidSoFar = currentMonthPayments.reduce((sum, p) => sum + parsePayAmount(p), 0)
			const firstPayment = currentMonthPayments[0]
			const paymentDate = new Date(firstPayment.timestamp || firstPayment.date || firstPayment.payment_date)
			paymentDate.setHours(0, 0, 0, 0)

			// Check if the latest transaction was marked as partial with remaining balance
			const sortedPayments = [...currentMonthPayments].sort((a, b) =>
				new Date(b.timestamp || b.date || b.payment_date) - new Date(a.timestamp || a.date || a.payment_date)
			)
			const latestPayment = sortedPayments[0]
			const hasRemainingBalance = latestPayment.remaining_balance != null && Number(latestPayment.remaining_balance) > 0
			const isMarkedPartial = latestPayment.payment_status === 'partial'

			// If explicitly marked as partial or has remaining balance, show as partial
			if (isMarkedPartial || hasRemainingBalance) {
				const remaining = hasRemainingBalance
					? Number(latestPayment.remaining_balance)
					: Math.max(0, monthlyRent - paidSoFar)
				const onTime = paymentDate <= dueDate
				return {
					status: 'partial',
					label: 'Partial payment',
					color: 'amber',
					paymentDate,
					paidSoFar,
					remainingBalance: remaining,
					message: onTime ? null : 'Payment received late',
					dueDate
				}
			}

			// Fully paid based on sum
			if (paidSoFar >= monthlyRent) {
				if (paymentDate <= dueDate) {
					return { status: 'paid', label: 'Paid', color: 'green', paymentDate }
				}
				return { status: 'late', label: 'Paid Late', color: 'yellow', paymentDate }
			}

			// Paid something but not enough (calculated partial)
			const remaining = Math.max(0, monthlyRent - paidSoFar)
			const onTime = paymentDate <= dueDate
			return {
				status: 'partial',
				label: 'Partial payment',
				color: 'amber',
				paymentDate,
				paidSoFar,
				remainingBalance: remaining,
				message: onTime ? null : 'Payment received late',
				dueDate
			}
		}

		// No rent payment yet — due today, past due, or pending
		const todayOnly = new Date(currentYear, currentMonth, today.getDate())
		// Use the actual dueDate (which may be next month for new tenants)
		const dueDateOnly = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate())

		if (todayOnly.getTime() === dueDateOnly.getTime()) {
			return { status: 'due_today', label: 'Due today', color: 'blue', dueDate, message: 'Payment due today' }
		}
		if (todayOnly > dueDateOnly) {
			const daysOverdue = Math.floor((todayOnly - dueDateOnly) / (1000 * 60 * 60 * 24))
			return {
				status: 'unpaid',
				label: 'Past due',
				color: 'red',
				dueDate,
				daysOverdue,
				message: `Past due for ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''}`
			}
		}
		const daysUntilDue = Math.floor((dueDateOnly - todayOnly) / (1000 * 60 * 60 * 24))
		return {
			status: 'pending',
			label: 'Due Soon',
			color: 'blue',
			dueDate,
			daysUntilDue,
			message: `Due in ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''}`
		}
	}

	// Mark receivable as received
	const handleMarkReceivableReceived = async (receivableId) => {
		if (!tenant) return
		const tenantId = tenant.tenant_id || tenant.id
		try {
			const res = await authFetch(`/api/tenants/${tenantId}/receivables/${receivableId}/received/`, { method: 'POST' })
			if (res.ok) {
				fetchTenantData()
			} else {
				const data = await res.json()
				alert(data.error || 'Failed to mark as received')
			}
		} catch (err) {
			alert('Failed to mark as received: ' + err.message)
		}
	}

	// Handle notes save
	const handleSaveNotes = async () => {
		if (!tenant) return

		setNotesSaving(true)
		try {
			const tenantId = tenant.tenant_id || tenant.id
			const content = notesEditorRef.current ? notesEditorRef.current.innerHTML : notesContent

			const res = await authFetch(`/api/tenants/${tenantId}/`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ notes: content })
			})

			if (res.ok) {
				setShowNotesModal(false)
				// Update local tenant state
				setTenant(prev => ({ ...prev, notes: content }))
				alert('Notes saved successfully')
			} else {
				throw new Error('Failed to save notes')
			}
		} catch (err) {
			console.error('Error saving notes:', err)
			alert('Failed to save notes: ' + err.message)
		} finally {
			setNotesSaving(false)
		}
	}

	// Format text in notes editor
	const formatText = (command, value = null) => {
		document.execCommand(command, false, value)
		notesEditorRef.current?.focus()
	}

	if (loading) {
		return (
			<div className="w-full h-full flex items-center justify-center">
				<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
			</div>
		)
	}

	if (error || !tenant) {
		return (
			<div className="w-full h-full flex items-center justify-center">
				<div className="text-center">
					<div className="text-xl font-semibold text-red-600">Error</div>
					<div className="text-sm text-gray-500 mt-2">{error || 'Tenant not found'}</div>
					<button
						onClick={() => onBack()}
						className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
					>
						Go Back
					</button>
				</div>
			</div>
		)
	}

	const latePaymentsCount = countLatePayments()
	const daysStayed = calculateDaysStayed()
	const lastPaymentDate = getLastPaymentDate()
	const isActive = tenant.is_active !== false
	const paymentStatus = getPaymentStatus()

	// Show EditTenant modal if editing
	if (showEditTenant) {
		return (
			<EditTenant
				tenant={tenant}
				appliances={tenant.appliances || []}
				propertyId={tenant.property_id}
				roomNumber={tenant.unit_no || tenant.room_no}
				roomSection={tenant.room_section}
				roomType={tenant.room_type}
				onClose={() => setShowEditTenant(false)}
				onSuccess={() => {
					setShowEditTenant(false)
					fetchTenantData()
				}}
			/>
		)
	}

	return (
		<div className="w-full h-full max-w-[100vw] bg-gray-50 dark:bg-gray-900 overflow-y-auto overflow-x-hidden pb-32 md:pb-4">
			<div className="w-full max-w-7xl mx-auto p-2 sm:p-4">
				{/* Header */}
				<div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-3 sm:p-4 mb-4">
					{/* Top row: Back button + Name + Status */}
					<div className="flex items-start gap-2 sm:gap-3">
						<button
							type="button"
							onClick={() => onBack()}
							className="p-2.5 bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl shadow-sm border border-gray-200 dark:border-gray-600 transition-all active:scale-90 flex-shrink-0"
						>
							<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
							</svg>
						</button>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2 flex-wrap">
								<h1 className="text-base sm:text-lg md:text-xl font-bold text-gray-900 dark:text-white truncate">
									{tenant.room_type === 'commercial' && tenant.business_name
										? tenant.business_name
										: (tenant.full_name || tenant.name)}
								</h1>
								{tenant.room_type === 'commercial' && tenant.business_name && (
									<span className="px-2 py-0.5 text-[10px] sm:text-xs font-semibold rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400">
										Commercial
									</span>
								)}
								<span className={`px-2 py-0.5 text-[10px] sm:text-xs font-semibold rounded-full ${isActive
									? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
									: 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
									}`}>
									{isActive ? 'Active' : 'Inactive'}
								</span>
								{tenant.blacklisted && (
									<span className="px-2 py-0.5 text-[10px] sm:text-xs font-semibold rounded-full bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 flex items-center gap-1">
										<svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
											<path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
										</svg>
										DNR
									</span>
								)}
							</div>
							<p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 truncate mt-0.5">
								{propertyName} - {rentedRooms.length > 1 ? (
									<span>
										Rooms {rentedRooms.map(r => r.room_number).join(', ')}
										<span className="ml-1 text-purple-600 dark:text-purple-400">({rentedRooms.length})</span>
									</span>
								) : (
									<span>Room {tenant.unit_no || tenant.room_no || 'N/A'}</span>
								)}
							</p>
						</div>
						{/* Desktop action buttons */}
						<div className="hidden md:flex items-center gap-2 flex-shrink-0">
							<button
								onClick={() => {
									setNotesContent(tenant.notes || '')
									setShowNotesModal(true)
								}}
								className="px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 text-sm"
							>
								<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
									<path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
								</svg>
								{tenant.notes ? 'Edit Notes' : 'Add Notes'}
							</button>
							<button
								type="button"
								onClick={openTenantPrintPdf}
								className="px-3 py-2 bg-gray-800 dark:bg-gray-700 text-white rounded-lg hover:bg-gray-900 dark:hover:bg-gray-600 flex items-center gap-2 text-sm"
							>
								<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
									<path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a2 2 0 002 2h6a2 2 0 002-2v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm0 8H7v4h6v-4z" clipRule="evenodd" />
								</svg>
								Print / PDF
							</button>
						</div>
					</div>
					{/* Mobile secondary actions row */}
					<div className="md:hidden grid grid-cols-2 gap-2 mt-3">
						<button
							onClick={() => {
								setNotesContent(tenant.notes || '')
								setShowNotesModal(true)
							}}
							className="flex-1 px-3 py-2.5 bg-purple-600 text-white rounded-lg active:bg-purple-700 flex items-center justify-center gap-2 text-xs font-medium"
						>
							<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
								<path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
							</svg>
							Notes
						</button>
						<button
							type="button"
							onClick={openTenantPrintPdf}
							className="flex-1 px-3 py-2.5 bg-gray-700 dark:bg-gray-600 text-white rounded-lg active:bg-gray-800 flex items-center justify-center gap-2 text-xs font-medium"
						>
							<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
								<path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a2 2 0 002 2h6a2 2 0 002-2v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm0 8H7v4h6v-4z" clipRule="evenodd" />
							</svg>
							Print
						</button>
					</div>
				</div>

				{/* Main Content Grid */}
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
					{/* Personal Information */}
					<div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4">
						<h2 className="text-lg font-semibold mb-3 flex items-center gap-2 text-gray-900 dark:text-white">
							<svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
								<path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
							</svg>
							Personal Information
						</h2>
						<div className="space-y-2">
							{tenant.room_type === 'commercial' && tenant.business_name && (
								<div className="flex flex-col sm:flex-row sm:justify-between sm:items-center group/item hover:bg-gray-50 dark:hover:bg-gray-700/50 px-2 py-2 rounded transition-colors cursor-pointer" onClick={() => handleCopy(tenant.business_name, 'businessName')}>
									<span className="text-gray-600 dark:text-gray-400 text-xs mb-0.5 sm:mb-0">Business Name</span>
									<div className="flex items-center gap-2">
										<span className={`font-medium text-sm ${copiedItem === 'businessName' ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
											{copiedItem === 'businessName' ? 'Copied!' : tenant.business_name}
										</span>
										<svg className="w-4 h-4 text-gray-400 opacity-50 group-hover/item:opacity-100 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											{copiedItem === 'businessName' ? (
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
											) : (
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
											)}
										</svg>
									</div>
								</div>
							)}
							{tenant.room_type === 'commercial' && tenant.business_name && (
								<div className="flex flex-col sm:flex-row sm:justify-between sm:items-center group/item hover:bg-gray-50 dark:hover:bg-gray-700/50 px-2 py-2 rounded transition-colors cursor-pointer" onClick={() => handleCopy(tenant.full_name, 'contactPerson')}>
									<span className="text-gray-600 dark:text-gray-400 text-xs mb-0.5 sm:mb-0">Contact Person</span>
									<div className="flex items-center gap-2">
										<span className={`font-medium text-sm ${copiedItem === 'contactPerson' ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
											{copiedItem === 'contactPerson' ? 'Copied!' : (tenant.full_name || 'N/A')}
										</span>
										<svg className="w-4 h-4 text-gray-400 opacity-50 group-hover/item:opacity-100 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											{copiedItem === 'contactPerson' ? (
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
											) : (
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
											)}
										</svg>
									</div>
								</div>
							)}
							<div className="flex flex-col sm:flex-row sm:justify-between sm:items-center group/item hover:bg-gray-50 dark:hover:bg-gray-700/50 px-2 py-2 rounded transition-colors cursor-pointer" onClick={() => handleCopy(tenant.tenant_id || tenant.id, 'tenantId')}>
								<span className="text-gray-600 dark:text-gray-400 text-xs mb-0.5 sm:mb-0">Tenant ID</span>
								<div className="flex items-center gap-2">
									<span className={`font-medium text-sm ${copiedItem === 'tenantId' ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
										{copiedItem === 'tenantId' ? 'Copied!' : (tenant.tenant_id || tenant.id || 'N/A')}
									</span>
									<svg className="w-4 h-4 text-gray-400 opacity-50 group-hover/item:opacity-100 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										{copiedItem === 'tenantId' ? (
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
										) : (
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
										)}
									</svg>
								</div>
							</div>
							<div className="flex flex-col sm:flex-row sm:justify-between sm:items-center group/item hover:bg-gray-50 dark:hover:bg-gray-700/50 px-2 py-2 rounded transition-colors cursor-pointer" onClick={() => handleCopy(tenant.email, 'email')}>
								<span className="text-gray-600 dark:text-gray-400 text-xs mb-0.5 sm:mb-0">Email</span>
								<div className="flex items-center gap-2">
									<span className={`font-medium text-sm break-all ${copiedItem === 'email' ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
										{copiedItem === 'email' ? 'Copied!' : (tenant.email || 'N/A')}
									</span>
									<svg className="w-4 h-4 text-gray-400 opacity-50 group-hover/item:opacity-100 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										{copiedItem === 'email' ? (
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
										) : (
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
										)}
									</svg>
								</div>
							</div>
							<div className="flex flex-col sm:flex-row sm:justify-between sm:items-center group/item hover:bg-gray-50 dark:hover:bg-gray-700/50 px-2 py-2 rounded transition-colors cursor-pointer" onClick={() => handleCopy(tenant.phone, 'phone')}>
								<span className="text-gray-600 dark:text-gray-400 text-xs mb-0.5 sm:mb-0">Phone</span>
								<div className="flex items-center gap-2">
									<span className={`font-medium text-sm ${copiedItem === 'phone' ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
										{copiedItem === 'phone' ? 'Copied!' : (tenant.phone || 'N/A')}
									</span>
									<svg className="w-4 h-4 text-gray-400 opacity-50 group-hover/item:opacity-100 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										{copiedItem === 'phone' ? (
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
										) : (
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
										)}
									</svg>
								</div>
							</div>
							<div className="flex flex-col sm:flex-row sm:justify-between sm:items-center group/item hover:bg-gray-50 dark:hover:bg-gray-700/50 px-2 py-2 rounded transition-colors cursor-pointer" onClick={() => handleCopy(tenant.home_location, 'home')}>
								<span className="text-gray-600 dark:text-gray-400 text-xs mb-0.5 sm:mb-0">Home Location</span>
								<div className="flex items-center gap-2">
									<span className={`font-medium text-sm break-all ${copiedItem === 'home' ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
										{copiedItem === 'home' ? 'Copied!' : (tenant.home_location || 'N/A')}
									</span>
									<svg className="w-4 h-4 text-gray-400 opacity-50 group-hover/item:opacity-100 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										{copiedItem === 'home' ? (
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
										) : (
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
										)}
									</svg>
								</div>
							</div>
							<div className="flex flex-col sm:flex-row sm:justify-between sm:items-center group/item hover:bg-gray-50 dark:hover:bg-gray-700/50 px-2 py-2 rounded transition-colors cursor-pointer" onClick={() => handleCopy(tenant.work_place, 'work')}>
								<span className="text-gray-600 dark:text-gray-400 text-xs mb-0.5 sm:mb-0">Work Place</span>
								<div className="flex items-center gap-2">
									<span className={`font-medium text-sm break-all ${copiedItem === 'work' ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
										{copiedItem === 'work' ? 'Copied!' : (tenant.work_place || 'N/A')}
									</span>
									<svg className="w-4 h-4 text-gray-400 opacity-50 group-hover/item:opacity-100 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										{copiedItem === 'work' ? (
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
										) : (
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
										)}
									</svg>
								</div>
							</div>
						</div>
					</div>

					{/* Occupancy Information */}
					<div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4">
						<h2 className="text-lg font-semibold mb-3 flex items-center gap-2 text-gray-900 dark:text-white">
							<svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
								<path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.712V17a1 1 0 001 1z" />
							</svg>
							Occupancy Details
						</h2>
						<div className="space-y-2 text-sm text-gray-900 dark:text-white">
							{/* Rented Rooms Section - current rooms + released rooms (batch single-room removal) with strikethrough */}
							{rentedRooms.length > 0 || (tenant.released_rooms && tenant.released_rooms.length > 0) ? (
								<div>
									<div className="flex justify-between items-center mb-2">
										<span className="text-gray-600 dark:text-gray-400">Rented Room{(rentedRooms.length + (tenant.released_rooms?.length || 0)) !== 1 ? 's' : ''}:</span>
										<span className={`text-xs font-medium px-2 py-0.5 rounded-full ${rentedRooms.length > 1
											? 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30'
											: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30'
											}`}>
											{rentedRooms.length > 0 && <span>{rentedRooms.length} current</span>}
											{(tenant.released_rooms?.length || 0) > 0 && (
												<span className={rentedRooms.length > 0 ? 'text-gray-500 ml-1' : ''}>
													{rentedRooms.length > 0 ? '· ' : ''}{(tenant.released_rooms?.length || 0)} released
												</span>
											)}
										</span>
									</div>
									<div className="space-y-1">
										{rentedRooms.map((room, idx) => (
											<div key={idx} className="flex justify-between items-center bg-gray-50 dark:bg-gray-700 px-2 py-1.5 rounded text-xs">
												<span className="flex items-center gap-1.5">
													<svg className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
													</svg>
													<span className="font-medium text-gray-800 dark:text-white">{room.room_number}</span>
													<span className="text-gray-400 dark:text-gray-500">Floor {room.floor}</span>
												</span>
												{room.payment > 0 && (
													<span className="text-green-600 dark:text-green-400 font-medium">₱{room.payment.toLocaleString()}</span>
												)}
											</div>
										))}
										{/* Released rooms (batch single-room removal) - strikethrough, no longer renting */}
										{tenant.released_rooms && tenant.released_rooms.length > 0 && tenant.released_rooms.map((roomLabel, idx) => (
											<div key={`released-${idx}`} className="flex justify-between items-center bg-gray-100 dark:bg-gray-700 px-2 py-1.5 rounded text-xs border border-dashed border-gray-300 dark:border-gray-600">
												<span className="flex items-center gap-1.5">
													<svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
													</svg>
													<span className="font-medium text-gray-500 dark:text-gray-400 line-through">{roomLabel}</span>
													<span className="text-gray-400 dark:text-gray-500 text-xs">(released)</span>
												</span>
											</div>
										))}
										{/* Total rent - show for current rooms only */}
										{rentedRooms.length > 1 && (
											<div className="flex justify-between items-center border-t border-gray-200 dark:border-gray-600 pt-1.5 mt-1.5 text-xs">
												<span className="text-gray-600 dark:text-gray-400">Total Rent:</span>
												<span className="font-semibold text-purple-600 dark:text-purple-400">
													₱{rentedRooms.reduce((sum, r) => sum + (r.payment || 0), 0).toLocaleString()}
												</span>
											</div>
										)}
									</div>
								</div>
							) : (
								/* Fallback for inactive tenants without room data */
								<div className="flex justify-between items-center bg-gray-50 dark:bg-gray-700 px-2 py-1.5 rounded text-xs">
									<span className="flex items-center gap-1.5">
										<svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
										</svg>
										<span className="font-medium text-gray-800 dark:text-white">{tenant.unit_no || tenant.room_no || 'N/A'}</span>
										<span className="text-gray-400 dark:text-gray-500">(Previous)</span>
									</span>
								</div>
							)}
							<div className="flex flex-col sm:flex-row sm:justify-between">
								<span className="text-gray-600 dark:text-gray-400 text-xs">Move In Date</span>
								<span className="font-medium text-sm text-gray-900 dark:text-white">{formatShortDate(tenant.move_in || tenant.date_of_occupancy)}</span>
							</div>
							{(!isActive && (tenant.move_out || tenant.date_removed)) && (
								<div className="flex flex-col sm:flex-row sm:justify-between">
									<span className="text-gray-600 dark:text-gray-400 text-xs">Move Out Date</span>
									<span className="font-medium text-sm text-red-600 dark:text-red-400">{formatShortDate(tenant.move_out || tenant.date_removed)}</span>
								</div>
							)}
							<div className="flex flex-col sm:flex-row sm:justify-between">
								<span className="text-gray-600 dark:text-gray-400 text-xs">Total Days</span>
								<span className="font-medium text-sm text-gray-900 dark:text-white">{daysStayed} days</span>
							</div>
							<div className="flex flex-col sm:flex-row sm:justify-between">
								<span className="text-gray-600 dark:text-gray-400 text-xs">Occupants</span>
								<span className="font-medium text-sm text-gray-900 dark:text-white">{tenant.occupants || tenant.number_of_occupants || 1}</span>
							</div>
							{tenant.other_occupants && tenant.other_occupants.length > 0 && (
								<div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600">
									<span className="text-gray-600 dark:text-gray-400 text-xs">Other Occupants:</span>
									<div className="mt-1 text-xs text-gray-700 dark:text-gray-300">
										{tenant.other_occupants.map((occ, i) => (
											<div key={i}>
												{typeof occ === 'string' ? occ : (occ.full_name || occ.name || 'Unknown')}
												{occ.relationship && ` (${occ.relationship})`}
											</div>
										))}
									</div>
								</div>
							)}
							{/* Appliances Section */}
							{tenant.appliances && tenant.appliances.length > 0 && (
								<div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600">
									<span className="text-gray-600 dark:text-gray-400 text-xs flex items-center gap-1">
										<svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
											<path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
										</svg>
										Appliances ({tenant.appliances.length}):
									</span>
									<div className="mt-1 space-y-1">
										{tenant.appliances.map((app, i) => {
											const name = typeof app === 'string' ? app : (app.name || 'Unknown')
											const surcharge = typeof app === 'object' ? parseFloat(app.surcharge || app.surcharge_amount || 0) : 0
											return (
												<div key={i} className="flex justify-between items-center text-xs bg-orange-50 dark:bg-orange-900/30 px-2 py-1 rounded">
													<span className="text-gray-700 dark:text-gray-300">{name}</span>
													{surcharge > 0 && (
														<span className="text-orange-600 dark:text-orange-400 font-medium">+₱{surcharge.toLocaleString()}</span>
													)}
												</div>
											)
										})}
									</div>
								</div>
							)}
						</div>
					</div>

					{/* Payment Information */}
					<div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4">
						<h2 className="text-lg font-semibold mb-3 flex items-center gap-2 text-gray-900 dark:text-white">
							<svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
								<path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
								<path fillRule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clipRule="evenodd" />
							</svg>
							Payment Details
						</h2>
						<div className="space-y-2 text-sm text-gray-900 dark:text-white">
							{/* Payment Status Banner */}
							{isActive && (
								<div className={`rounded-lg p-2 mb-3 border ${paymentStatus.status === 'paid' ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-700' :
									paymentStatus.status === 'late' ? 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-700' :
										paymentStatus.status === 'partial' ? 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-700' :
											paymentStatus.status === 'unpaid' ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700' :
												paymentStatus.status === 'not_due_yet' ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700' :
													paymentStatus.status === 'pending' || paymentStatus.status === 'due_today' ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700' :
														paymentStatus.status === 'not_paid_advance' ? 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-700' :
															paymentStatus.status === 'not_paid_deposit' ? 'bg-purple-50 dark:bg-purple-900/30 border-purple-200 dark:border-purple-700' :
																paymentStatus.status === 'not_paid_advance_deposit' ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700' :
																	'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600'
									}`}>
									<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
										<div className="flex-1 min-w-0">
											<div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Current Month Status</div>
											<div className={`text-lg font-bold ${paymentStatus.status === 'paid' ? 'text-green-700 dark:text-green-400' :
												paymentStatus.status === 'late' ? 'text-yellow-700 dark:text-yellow-400' :
													paymentStatus.status === 'partial' ? 'text-amber-700 dark:text-amber-400' :
														paymentStatus.status === 'unpaid' ? 'text-red-700 dark:text-red-400' :
															paymentStatus.status === 'not_due_yet' ? 'text-blue-700 dark:text-blue-400' :
																paymentStatus.status === 'pending' || paymentStatus.status === 'due_today' ? 'text-blue-700 dark:text-blue-400' :
																	paymentStatus.status === 'not_paid_advance' ? 'text-amber-700 dark:text-amber-400' :
																		paymentStatus.status === 'not_paid_deposit' ? 'text-purple-700 dark:text-purple-400' :
																			paymentStatus.status === 'not_paid_advance_deposit' ? 'text-red-700 dark:text-red-400' :
																				'text-gray-700 dark:text-gray-300'
												}`}>
												{paymentStatus.label}
											</div>
											{paymentStatus.message && (
												<div className={`text-xs mt-1 ${paymentStatus.status === 'unpaid' ? 'text-red-600 dark:text-red-400' :
													paymentStatus.status === 'not_paid_advance_deposit' ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'
													}`}>
													{paymentStatus.message}
												</div>
											)}
											{paymentStatus.status === 'partial' && paymentStatus.remainingBalance != null && (
												<div className="text-sm mt-2 space-y-0.5">
													<div className="text-amber-800 dark:text-amber-300 font-medium">
														Paid: ₱{(paymentStatus.paidSoFar ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })} · Remaining: ₱{(paymentStatus.remainingBalance ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
													</div>
												</div>
											)}
										</div>
										<div className={`hidden sm:flex w-12 h-12 rounded-full items-center justify-center flex-shrink-0 ${paymentStatus.status === 'paid' ? 'bg-green-100 dark:bg-green-800/50' :
											paymentStatus.status === 'late' ? 'bg-yellow-100 dark:bg-yellow-800/50' :
												paymentStatus.status === 'partial' ? 'bg-amber-100 dark:bg-amber-800/50' :
													paymentStatus.status === 'unpaid' ? 'bg-red-100 dark:bg-red-800/50' :
														paymentStatus.status === 'not_due_yet' ? 'bg-blue-100 dark:bg-blue-800/50' :
															paymentStatus.status === 'pending' || paymentStatus.status === 'due_today' ? 'bg-blue-100 dark:bg-blue-800/50' :
																paymentStatus.status === 'not_paid_advance' ? 'bg-amber-100 dark:bg-amber-800/50' :
																	paymentStatus.status === 'not_paid_deposit' ? 'bg-purple-100 dark:bg-purple-800/50' :
																		paymentStatus.status === 'not_paid_advance_deposit' ? 'bg-red-100 dark:bg-red-800/50' :
																			'bg-gray-100 dark:bg-gray-700'
											}`}>
											{paymentStatus.status === 'paid' ? (
												<svg className="w-6 h-6 text-green-600" fill="currentColor" viewBox="0 0 20 20">
													<path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
												</svg>
											) : paymentStatus.status === 'late' ? (
												<svg className="w-6 h-6 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
													<path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
												</svg>
											) : paymentStatus.status === 'partial' ? (
												<svg className="w-6 h-6 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
													<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
												</svg>
											) : paymentStatus.status === 'not_due_yet' ? (
												<svg className="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
													<path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
												</svg>
											) : paymentStatus.status === 'unpaid' || paymentStatus.status === 'not_paid_advance' || paymentStatus.status === 'not_paid_deposit' || paymentStatus.status === 'not_paid_advance_deposit' ? (
												<svg className="w-6 h-6 text-red-600" fill="currentColor" viewBox="0 0 20 20">
													<path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
												</svg>
											) : (
												<svg className="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
													<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
												</svg>
											)}
										</div>
									</div>
									{(paymentStatus.status === 'not_paid_advance' || paymentStatus.status === 'not_paid_deposit' || paymentStatus.status === 'not_paid_advance_deposit') && (
										<button
											onClick={() => setShowPaymentModal(true)}
											className="mt-3 w-full py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors"
										>
											Record Payment
										</button>
									)}
									{/* Multi-month unpaid buttons */}
									{unpaidMonths.length > 1 && (
										<div className="mt-3 border-t border-gray-200 dark:border-gray-700 pt-3">
											<div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
												<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
												</svg>
												{unpaidMonths.length} months with balance
											</div>
											<div className="space-y-1.5">
												{unpaidMonths.map(m => (
													<button
														key={m.forMonth}
														onClick={() => {
															setPaymentForMonth(m)
															setShowPaymentModal(true)
														}}
														className={`w-full py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-between px-3 ${
															m.isLate
																? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50'
																: m.isDueToday
																	? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-900/50'
																	: m.status === 'partial'
																		? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50'
																		: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50'
														}`}
													>
														<div className="flex items-center gap-2">
															<span className="font-semibold">{m.label}</span>
															{m.isLate && (
																<span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200">
																	{m.daysOverdue}d late
																</span>
															)}
															{m.isDueToday && (
																<span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-orange-200 dark:bg-orange-800 text-orange-800 dark:text-orange-200">
																	Due Today
																</span>
															)}
															{!m.isLate && !m.isDueToday && m.status === 'unpaid' && (
																<span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200">
																	Unpaid
																</span>
															)}
															{m.status === 'partial' && (
																<span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200">
																	Partial
																</span>
															)}
														</div>
														<span className="font-bold">
															{m.status === 'partial'
																? `Bal ₱${m.remainingBalance.toLocaleString()}`
																: `₱${m.monthlyRent.toLocaleString()}`
															}
														</span>
													</button>
												))}
											</div>
										</div>
									)}
									{/* Single-month buttons (only when 0 or 1 unpaid months) */}
									{unpaidMonths.length <= 1 && paymentStatus.status === 'partial' && (paymentStatus.remainingBalance ?? 0) > 0 && (
										<button
											onClick={() => {
												if (unpaidMonths.length === 1) {
													setPaymentForMonth(unpaidMonths[0])
													setShowPaymentModal(true)
												} else {
													setPaymentModalDefaultAmount(paymentStatus.remainingBalance ?? tenant.payment ?? tenant.rent ?? 0)
													setOpenPaymentAsLate(false)
													setOpenPaymentAsBalancePayment(true)
													setShowPaymentModal(true)
												}
											}}
											className="mt-3 w-full py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors"
										>
											Balance Payment — Pay remaining ₱{(paymentStatus.remainingBalance ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
										</button>
									)}
									{unpaidMonths.length <= 1 && paymentStatus.status === 'unpaid' && (
										<button
											onClick={() => {
												if (unpaidMonths.length === 1) {
													setPaymentForMonth(unpaidMonths[0])
													setShowPaymentModal(true)
												} else {
													setPaymentModalDefaultAmount(null)
													setOpenPaymentAsLate(true)
													setShowPaymentModal(true)
												}
											}}
											className="mt-3 w-full py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-normal h-auto min-h-[38px] flex items-center justify-center"
										>
											Confirm Payment (Mark as Late)
										</button>
									)}
									{unpaidMonths.length <= 1 && paymentStatus.status === 'unpaid' && (
										<button
											type="button"
											onClick={() => setShowOverdueReminderModal(true)}
											className="mt-2 w-full py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-normal h-auto min-h-[38px] flex items-center justify-center gap-1.5"
										>
											<svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
											Send Overdue Reminder — {paymentStatus.daysOverdue}d · ₱{((paymentStatus.daysOverdue ?? 0) * 50).toLocaleString()} late fee
										</button>
									)}
									{unpaidMonths.length <= 1 && (paymentStatus.status === 'pending' || paymentStatus.status === 'due_today') && (
										<button
											onClick={() => {
												if (unpaidMonths.length === 1) {
													setPaymentForMonth(unpaidMonths[0])
													setShowPaymentModal(true)
												} else {
													setPaymentModalDefaultAmount(null)
													setOpenPaymentAsLate(false)
													setShowPaymentModal(true)
												}
											}}
											className="mt-3 w-full py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-normal h-auto min-h-[38px] flex items-center justify-center"
										>
											Confirm Payment
										</button>
									)}
								</div>
							)}
							<div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-3 mb-2">
								<div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Monthly Rent</div>
								<div className="text-2xl font-bold text-blue-600 dark:text-blue-400">₱{(tenant.payment || tenant.rent || 0).toLocaleString()}</div>
							</div>
							{tenant.appliances && tenant.appliances.length > 0 && (
								<div className="bg-orange-50 dark:bg-orange-900/30 rounded-lg p-3 mb-2 border border-orange-200 dark:border-orange-700">
									<div className="flex justify-between items-center mb-2">
										<span className="text-xs font-semibold text-orange-800 dark:text-orange-300 uppercase">Appliances with Surcharge</span>
										<span className="text-xs font-bold text-orange-700 dark:text-orange-400">
											Total: +₱{tenant.appliances.reduce((sum, app) => {
												const surcharge = parseFloat(app.surcharge || app.surcharge_amount || 0)
												return sum + surcharge
											}, 0).toLocaleString()}
										</span>
									</div>
									<div className="space-y-1">
										{tenant.appliances.map((app, i) => {
											const surcharge = parseFloat(app.surcharge || app.surcharge_amount || 0)
											return (
												<div key={i} className="flex justify-between items-center text-sm">
													<span className="text-gray-700 dark:text-gray-300 font-medium">{app.name || app}</span>
													<span className="text-orange-700 dark:text-orange-400 font-semibold">+₱{surcharge.toLocaleString()}</span>
												</div>
											)
										})}
									</div>
								</div>
							)}
							<div className="flex flex-col sm:flex-row sm:justify-between">
								<span className="text-gray-600 dark:text-gray-400 text-xs">Payment Day</span>
								<span className="font-medium text-sm text-gray-900 dark:text-white">
									{tenant.payment_day || tenant.preferred_payment_day
										? `Day ${tenant.payment_day || tenant.preferred_payment_day}`
										: 'Not set'}
								</span>
							</div>
							{isActive && (() => {
								// Calculate next payment date using move-in day
								const today = new Date()
								const moveInDateStr = tenant.move_in || tenant.date_of_occupancy
								let moveInDayVal = 1
								if (moveInDateStr) {
									if (typeof moveInDateStr === 'string' && moveInDateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
										moveInDayVal = parseInt(moveInDateStr.split('-')[2], 10)
									} else {
										moveInDayVal = new Date(moveInDateStr).getDate() || 1
									}
								}
								const paymentDay = moveInDayVal
								let nextPaymentDate = new Date(today.getFullYear(), today.getMonth(), Math.min(paymentDay, 28))

								// If current month is already paid or we're past the payment day, show next month
								if (paymentStatus.status === 'paid' || paymentStatus.status === 'late' || today > nextPaymentDate) {
									nextPaymentDate = new Date(today.getFullYear(), today.getMonth() + 1, Math.min(paymentDay, 28))
								}

								return (
									<div className="flex flex-col sm:flex-row sm:justify-between">
										<span className="text-gray-600 dark:text-gray-400 text-xs">Next Payment</span>
										<span className="font-medium text-sm text-blue-600 dark:text-blue-400">
											{nextPaymentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
										</span>
									</div>
								)
							})()}
							{isActive && paymentStatus.dueDate && paymentStatus.status === 'unpaid' && (
								<div className="flex flex-col sm:flex-row sm:justify-between">
									<span className="text-gray-600 dark:text-gray-400 text-xs">Overdue Since</span>
									<span className="font-medium text-sm text-red-600 dark:text-red-400">
										{formatShortDate(paymentStatus.dueDate)}
									</span>
								</div>
							)}
							<div className="flex flex-col sm:flex-row sm:justify-between">
								<span className="text-gray-600 dark:text-gray-400 text-xs">Last Payment</span>
								<span className="font-medium text-sm text-gray-900 dark:text-white">{lastPaymentDate ? formatShortDate(lastPaymentDate) : 'No payments'}</span>
							</div>
							<div className="flex flex-col sm:flex-row sm:justify-between">
								<span className="text-gray-600 dark:text-gray-400 text-xs">Late Payments</span>
								<span className={`font-medium text-sm ${latePaymentsCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
									{latePaymentsCount}
								</span>
							</div>
							<div className="flex flex-col sm:flex-row sm:justify-between">
								<span className="text-gray-600 dark:text-gray-400 text-xs">Total Payments</span>
								<span className="font-medium text-sm text-gray-900 dark:text-white">{displayPaymentHistory.length}</span>
							</div>
						</div>
					</div>
				</div>

				{/* Action Buttons - Stacked on mobile for full width, 5-column on desktop */}
				<div className="w-full flex flex-col md:grid md:grid-cols-3 lg:grid-cols-5 gap-2 md:gap-3 mb-4 mx-0">
					{isActive && (
						<>
							<button
								onClick={() => setShowEditTenant(true)}
								className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors text-sm flex items-center justify-center gap-2"
							>
								<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
								</svg>
								Edit Tenant
							</button>
							<button
								onClick={() => setShowRemoveModal(true)}
								className="w-full px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors text-sm flex items-center justify-center"
							>
								Remove Tenant
							</button>
							<button
								onClick={() => setShowPaymentModal(true)}
								className="w-full px-4 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors text-sm flex items-center justify-center"
							>
								Confirm Payment
							</button>
							<button
								type="button"
								onClick={() => setShowReminderModal(true)}
								className="w-full px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors text-sm flex items-center justify-center"
							>
								Send Reminder
							</button>
						</>
					)}
					<button
						onClick={() => {
							setShowDocumentsModal(true)
							fetchDocuments()
						}}
						className="w-full px-4 py-2.5 bg-gray-700 hover:bg-gray-800 text-white rounded-lg font-medium transition-colors text-sm flex items-center justify-center gap-2"
					>
						<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
							<path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
						</svg>
						View Documents
					</button>
				</div>

				{/* Blacklist Warning */}
				{tenant.blacklisted && (
					<div className="bg-red-50 dark:bg-red-900/30 border-2 border-red-200 dark:border-red-700 rounded-lg p-4 mb-4">
						<div className="flex items-start gap-3">
							<div className="flex-shrink-0">
								<svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20">
									<path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
								</svg>
							</div>
							<div>
								<h3 className="text-lg font-semibold text-red-800 dark:text-red-300">Do Not Rent Again</h3>
								<p className="text-sm text-red-700 dark:text-red-400 mt-1">
									This tenant has been marked as ineligible for future rentals.
								</p>
								{tenant.blacklist_reason && (
									<div className="mt-2 p-2 bg-red-100 dark:bg-red-800/50 rounded text-sm text-red-800 dark:text-red-200">
										<strong>Reason:</strong> {tenant.blacklist_reason}
									</div>
								)}
							</div>
						</div>
					</div>
				)}

				{/* Notes Section - Shows above payment history */}
				{tenant.notes && (
					<div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 mb-4">
						<h2 className="text-lg font-semibold flex items-center gap-2 mb-3 text-gray-900 dark:text-white">
							<svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="currentColor" viewBox="0 0 20 20">
								<path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
							</svg>
							Notes & Remarks
						</h2>
						<div
							className="prose prose-sm max-w-none text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600"
							dangerouslySetInnerHTML={{ __html: tenant.notes }}
						/>
					</div>
				)}

				{/* Receivables (tenant owes owner) - shown above Payment History */}
				{tenant.receivables && tenant.receivables.length > 0 && (
					<div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 mb-4">
						<h2 className="text-lg font-semibold mb-3 flex items-center gap-2 text-gray-900 dark:text-white">
							<svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="currentColor" viewBox="0 0 20 20">
								<path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2h6V6a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm10 2h2a2 2 0 002-2V6a2 2 0 00-2-2h-2v8z" clipRule="evenodd" />
							</svg>
							Receivables (tenant owes you)
						</h2>
						<div className="space-y-2 text-sm">
							{tenant.receivables.map((r) => {
								const amt = parseFloat(r.amount) || 0
								const received = r.received === true
								const dateStr = r.date ? new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
								const receivedAtStr = r.received_at ? new Date(r.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
								return (
									<div key={r.id} className={`rounded-lg p-3 border ${received ? 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600' : 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-700'}`}>
										<div className="flex justify-between items-start">
											<div>
												<div className="font-medium text-gray-800 dark:text-gray-200">{r.reason || 'Reimbursement'}</div>
												<div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Date: {dateStr}</div>
												{received && receivedAtStr && <div className="text-xs text-green-600 dark:text-green-400 mt-0.5">Received: {receivedAtStr}</div>}
											</div>
											<div className="text-right">
												<div className="font-semibold text-gray-900 dark:text-white">₱{amt.toLocaleString()}</div>
												{!received && (
													<button
														type="button"
														onClick={() => handleMarkReceivableReceived(r.id)}
														className="mt-1 text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
													>
														Mark as received
													</button>
												)}
											</div>
										</div>
									</div>
								)
							})}
							<div className="pt-3 mt-3 border-t border-gray-200 dark:border-gray-600 space-y-2">
								<div className="flex justify-between items-center text-sm">
									<span className="text-gray-600 dark:text-gray-400">Still owed (outstanding):</span>
									<span className="font-semibold text-amber-700 dark:text-amber-400">
										₱{(tenant.receivables.filter(r => r.received !== true && r.received !== 'true' && r.received !== 1).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)).toLocaleString()}
										<span className="text-gray-500 dark:text-gray-400 font-normal ml-1">
											({tenant.receivables.filter(r => r.received !== true && r.received !== 'true' && r.received !== 1).length} item{tenant.receivables.filter(r => r.received !== true && r.received !== 'true' && r.received !== 1).length === 1 ? '' : 's'})
										</span>
									</span>
								</div>
								<div className="flex justify-between items-center text-sm">
									<span className="text-gray-600 dark:text-gray-400">Total receivable (all items, including received):</span>
									<span className="font-semibold text-gray-900 dark:text-white">
										₱{(tenant.receivables.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)).toLocaleString()}
									</span>
								</div>
							</div>
						</div>
					</div>
				)}

				{/* Payment History */}
				<div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm">
					<div className="p-4 border-b border-gray-200 dark:border-gray-700">
						<div className="flex flex-wrap items-center justify-between gap-4">
							<h2 className="text-lg font-semibold flex items-center gap-2 text-gray-900 dark:text-white">
								<svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
									<path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
								</svg>
								Payment History
							</h2>
							<div className="flex items-center gap-4 text-sm">
								<div className="flex items-center gap-2">
									<span className="text-gray-600 dark:text-gray-400">Total Paid{paymentHistoryDateFrom || paymentHistoryDateTo ? ' (filtered)' : ''}:</span>
									<span className="font-bold text-green-600 dark:text-green-400">
										₱{filteredTotalPaid.toLocaleString()}
									</span>
								</div>
							</div>
						</div>
						{/* Date range filter */}
						<div className="mt-3 space-y-2">
							<span className="text-sm text-gray-600 dark:text-gray-400 block">Timeframe:</span>
							<div className="flex flex-wrap items-center gap-2">
								<label className="flex items-center gap-1.5 text-sm">
									<span className="text-gray-500 dark:text-gray-400">From</span>
									<input
										type="date"
										value={paymentHistoryDateFrom}
										onChange={(e) => setPaymentHistoryDateFrom(e.target.value)}
										className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white [color-scheme:light] dark:[color-scheme:dark] max-w-[130px]"
									/>
								</label>
								<label className="flex items-center gap-1.5 text-sm">
									<span className="text-gray-500 dark:text-gray-400">To</span>
									<input
										type="date"
										value={paymentHistoryDateTo}
										onChange={(e) => setPaymentHistoryDateTo(e.target.value)}
										className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white [color-scheme:light] dark:[color-scheme:dark] max-w-[130px]"
									/>
								</label>
								<button
									type="button"
									onClick={() => {
										setPaymentHistoryDateFrom('')
										setPaymentHistoryDateTo('')
										setPaymentHistoryPage(1)
									}}
									className="rounded bg-gray-100 dark:bg-gray-700 px-2.5 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 whitespace-nowrap"
								>
									All time
								</button>
								<button
									type="button"
									onClick={() => {
										const end = new Date()
										const start = new Date()
										start.setMonth(start.getMonth() - 3)
										setPaymentHistoryDateFrom(start.toISOString().slice(0, 10))
										setPaymentHistoryDateTo(end.toISOString().slice(0, 10))
										setPaymentHistoryPage(1)
									}}
									className="rounded bg-gray-100 dark:bg-gray-700 px-2.5 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 whitespace-nowrap flex-shrink-0"
								>
									Last 3 months
								</button>
								<button
									type="button"
									onClick={() => {
										const end = new Date()
										const start = new Date()
										start.setMonth(start.getMonth() - 6)
										setPaymentHistoryDateFrom(start.toISOString().slice(0, 10))
										setPaymentHistoryDateTo(end.toISOString().slice(0, 10))
										setPaymentHistoryPage(1)
									}}
									className="rounded bg-gray-100 dark:bg-gray-700 px-2.5 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 whitespace-nowrap flex-shrink-0"
								>
									Last 6 months
								</button>
								<button
									type="button"
									onClick={() => {
										const end = new Date()
										const start = new Date(end.getFullYear(), 0, 1)
										setPaymentHistoryDateFrom(start.toISOString().slice(0, 10))
										setPaymentHistoryDateTo(end.toISOString().slice(0, 10))
										setPaymentHistoryPage(1)
									}}
									className="rounded bg-gray-100 dark:bg-gray-700 px-2.5 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 whitespace-nowrap flex-shrink-0"
								>
									This year
								</button>
							</div>
						</div>
					</div>
					{/* Payment History View: Responsive Grid/Cards for Mobile, Table for Desktop */}
					<div className="max-w-full">
						{/* Desktop Table View */}
						<div className="hidden md:block overflow-x-auto">
							<table className="w-full">
								<thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
									<tr>
										<th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Date</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Type</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Amount</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Room</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Method</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Status</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Notes</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Action</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-200 dark:divide-gray-700">
									{totalFilteredCount === 0 ? (
										<tr>
											<td colSpan="8" className="px-4 py-8 text-center text-gray-500 dark:text-gray-400 text-sm">
												{displayPaymentHistory.length === 0 ? 'No payment history found' : 'No payments in selected timeframe'}
											</td>
										</tr>
									) : (
										paginatedPaymentHistory.map((payment, index) => {
											const amount = typeof payment.amount === 'string' ? payment.amount.replace(/,/g, '') : payment.amount
											const isLate = payment.is_late === true || payment.status?.toLowerCase() === 'late'
											const isRefund = payment.status === 'refund' || payment.payment_type?.includes('refund')
											const paymentType = payment.payment_type || payment.paymentType || 'rent'
											const isPartialRentTransaction = (paymentType === 'rent' || paymentType === 'monthly_rent') && (payment.payment_status === 'partial' || (payment.remaining_balance != null && Number(payment.remaining_balance) > 0))
											const txDate = new Date(payment.timestamp || payment.date)
											const nowDate = new Date()
											const isCurrentMonthTx = txDate.getMonth() === nowDate.getMonth() && txDate.getFullYear() === nowDate.getFullYear()
											const monthStillHasBalance = paymentStatus?.status === 'partial'
											const isLatestPartialRent = latestPartialRentPaymentKey != null && getPaymentRowKey(payment) === latestPartialRentPaymentKey
											const showBalancePaymentBtn = isPartialRentTransaction && isCurrentMonthTx && monthStillHasBalance && isLatestPartialRent
											const isPartialRent = isPartialRentTransaction
											const isReceivable = payment.payment_type === 'receivable' || payment.paymentType === 'receivable'

											const getTypeBadgeStyle = () => {
												if (paymentType === 'receivable') return 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300'
												if (paymentType === 'advance_refund') return 'bg-orange-100 dark:bg-orange-900/50 text-orange-800 dark:text-orange-300'
												if (paymentType === 'deposit_refund') return 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300'
												if (paymentType === 'advance') return 'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300'
												if (paymentType === 'deposit') return 'bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-300'
												if (paymentType === 'utility') return 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300'
												if (paymentType === 'maintenance') return 'bg-teal-100 dark:bg-teal-900/50 text-teal-800 dark:text-teal-300'
												if (paymentType === 'damages') return 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300'
												if (paymentType === 'other') return 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300'
												return 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
											}

											const getTypeLabel = () => {
												if (paymentType === 'receivable') return 'Reimbursement received'
												if (paymentType === 'advance_refund') return 'Advance Refund'
												if (paymentType === 'deposit_refund') return 'Deposit Refund'
												if (paymentType === 'advance') return 'Advance Payment'
												if (paymentType === 'deposit') return 'Deposit Payment'
												if (paymentType === 'utility') return 'Utilities'
												if (paymentType === 'maintenance') return 'Maintenance'
												if (paymentType === 'damages') return 'Damages'
												if (paymentType === 'other') return 'Other'
												return 'Monthly Rent'
											}

											const rowIndex = (paymentHistoryCurrentPage - 1) * PAYMENT_HISTORY_PAGE_SIZE + index
											return (
												<tr key={payment.is_receivable && payment.id ? `rec-${payment.id}` : `row-${rowIndex}`} className="hover:bg-gray-50 dark:hover:bg-gray-700">
													<td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
														{formatShortDateTime(payment.timestamp, payment.date)}
													</td>
													<td className="px-4 py-3 text-sm">
														<span className={`px-2 py-1 rounded-full text-xs font-medium ${getTypeBadgeStyle()}`}>
															{getTypeLabel()}
														</span>
													</td>
													<td className={`px-4 py-3 text-sm font-semibold ${isRefund ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
														<div>
															{isRefund ? '' : 'Received ₱'}{parseFloat(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
															{showBalancePaymentBtn && paymentStatus?.remainingBalance > 0 && (
																<div className="text-amber-600 dark:text-amber-400 text-xs font-medium mt-0.5">Remaining ₱{paymentStatus.remainingBalance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
															)}
														</div>
													</td>
													<td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
														{payment.room_no || tenant.unit_no || tenant.room_no || 'N/A'}
													</td>
													<td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 capitalize">
														{isReceivable ? '-' : (payment.method || payment.payment_method || 'Cash')}
													</td>
													<td className="px-4 py-3 text-sm">
														<span className={`px-2 py-1 rounded-full text-xs font-medium ${isReceivable
															? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300'
															: isRefund
																? 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300'
																: isPartialRent
																	? 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300'
																	: isLate
																		? 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-300'
																		: 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300'
															}`}>
															{isReceivable ? 'Received' : isRefund ? 'Refund' : isPartialRent ? 'Paid (partial)' : isLate ? 'Paid Late' : 'Paid'}
														</span>
													</td>
													<td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
														{payment.notes || '-'}
													</td>
													<td className="px-4 py-3 text-sm">
														{showBalancePaymentBtn && paymentStatus?.remainingBalance > 0 ? (
															<button
																type="button"
																onClick={() => {
																	setPaymentModalDefaultAmount(paymentStatus.remainingBalance)
																	setOpenPaymentAsLate(false)
																	setOpenPaymentAsBalancePayment(true)
																	setShowPaymentModal(true)
																}}
																className="px-2 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-medium"
															>
																Balance Payment
															</button>
														) : (
															<span className="text-gray-400">—</span>
														)}
													</td>
												</tr>
											)
										})
									)}
								</tbody>
							</table>
						</div>

						{/* Mobile Card Layout */}
						<div className="md:hidden space-y-3">
							{totalFilteredCount === 0 ? (
								<div className="py-8 text-center text-gray-500 dark:text-gray-400 text-sm bg-white dark:bg-gray-800 rounded-lg">
									{displayPaymentHistory.length === 0 ? 'No payment history found' : 'No payments in selected timeframe'}
								</div>
							) : (
								paginatedPaymentHistory.map((payment, index) => {
									const amount = typeof payment.amount === 'string' ? payment.amount.replace(/,/g, '') : payment.amount
									const isLate = payment.is_late === true || payment.status?.toLowerCase() === 'late'
									const isRefund = payment.status === 'refund' || payment.payment_type?.includes('refund')
									const isReceivable = payment.payment_type === 'receivable' || payment.paymentType === 'receivable'
									const paymentType = payment.payment_type || payment.paymentType || 'rent'
									const isPartialRentTransaction = (paymentType === 'rent' || paymentType === 'monthly_rent') && (payment.payment_status === 'partial' || (payment.remaining_balance != null && Number(payment.remaining_balance) > 0))
									const txDate = new Date(payment.timestamp || payment.date)
									const nowDate = new Date()
									const isCurrentMonthTx = txDate.getMonth() === nowDate.getMonth() && txDate.getFullYear() === nowDate.getFullYear()
									const monthStillHasBalance = paymentStatus?.status === 'partial'
									const isLatestPartialRent = latestPartialRentPaymentKey != null && getPaymentRowKey(payment) === latestPartialRentPaymentKey
									const showBalancePaymentBtn = isPartialRentTransaction && isCurrentMonthTx && monthStillHasBalance && isLatestPartialRent
									const isPartialRent = isPartialRentTransaction

									const getTypeBadgeStyle = () => {
										if (paymentType === 'receivable') return 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300'
										if (paymentType === 'advance_refund') return 'bg-orange-100 dark:bg-orange-900/50 text-orange-800 dark:text-orange-300'
										if (paymentType === 'deposit_refund') return 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300'
										if (paymentType === 'advance') return 'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300'
										if (paymentType === 'deposit') return 'bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-300'
										if (paymentType === 'utility') return 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300'
										if (paymentType === 'maintenance') return 'bg-teal-100 dark:bg-teal-900/50 text-teal-800 dark:text-teal-300'
										if (paymentType === 'damages') return 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300'
										if (paymentType === 'other') return 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300'
										return 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
									}

									const getTypeLabel = () => {
										if (paymentType === 'receivable') return 'Reimbursement'
										if (paymentType === 'advance_refund') return 'Advance Refund'
										if (paymentType === 'deposit_refund') return 'Deposit Refund'
										if (paymentType === 'advance') return 'Advance Payment'
										if (paymentType === 'deposit') return 'Deposit Payment'
										if (paymentType === 'utility') return 'Utilities'
										if (paymentType === 'maintenance') return 'Maintenance'
										if (paymentType === 'damages') return 'Damages'
										if (paymentType === 'other') return 'Other'
										return 'Monthly Rent'
									}

									const rowIndex = (paymentHistoryCurrentPage - 1) * PAYMENT_HISTORY_PAGE_SIZE + index
									return (
										<div key={payment.is_receivable && payment.id ? `mob-rec-${payment.id}` : `mob-${rowIndex}`} className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
											<div className="flex justify-between items-center mb-2">
												<div className="flex items-center gap-2">
													<span className="text-[10px] font-black text-gray-400 uppercase tracking-tighter">
														{formatShortDate(payment.date || payment.timestamp)}
													</span>
													<span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-tight ${getTypeBadgeStyle()}`}>
														{getTypeLabel()}
													</span>
												</div>
												<span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-tight ${isReceivable
													? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300'
													: isRefund
														? 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300'
														: isPartialRent
															? 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300'
															: isLate
																? 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-300'
																: 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300'
													}`}>
													{isReceivable ? 'Received' : isRefund ? 'Refund' : isPartialRent ? 'Partial' : isLate ? 'Late' : 'Paid'}
												</span>
											</div>

											<div className="flex justify-between items-baseline mb-2">
												<div className={`text-lg font-black ${isRefund ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
													₱{parseFloat(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
												</div>
												<div className="text-[10px] text-gray-500 dark:text-gray-400 font-bold">
													Room {payment.room_no || tenant.unit_no || tenant.room_no || 'N/A'} • {isReceivable ? '-' : (payment.method || payment.payment_method || 'Cash')}
												</div>
											</div>

											{showBalancePaymentBtn && paymentStatus?.remainingBalance > 0 && (
												<div className="text-amber-600 dark:text-amber-400 text-[10px] font-bold mb-2">
													Unpaid: ₱{paymentStatus.remainingBalance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
												</div>
											)}

											{payment.notes && (
												<p className="text-[10px] text-gray-500 dark:text-gray-400 italic mb-2 line-clamp-1 border-l-2 border-gray-200 dark:border-gray-700 pl-2">
													{payment.notes}
												</p>
											)}

											{showBalancePaymentBtn && paymentStatus?.remainingBalance > 0 && (
												<button
													type="button"
													onClick={() => {
														setPaymentModalDefaultAmount(paymentStatus.remainingBalance)
														setOpenPaymentAsLate(false)
														setOpenPaymentAsBalancePayment(true)
														setShowPaymentModal(true)
													}}
													className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white rounded text-[10px] font-black uppercase tracking-widest transition-colors"
												>
													Pay Balance
												</button>
											)}
										</div>
									)
								})
							)}
						</div>
					</div>
					{/* Pagination */}
					{totalFilteredCount > 0 && (
						<div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-2">
							<p className="text-sm text-gray-600 dark:text-gray-400">
								Showing {(paymentHistoryCurrentPage - 1) * PAYMENT_HISTORY_PAGE_SIZE + 1}–{Math.min(paymentHistoryCurrentPage * PAYMENT_HISTORY_PAGE_SIZE, totalFilteredCount)} of {totalFilteredCount}
							</p>
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={() => setPaymentHistoryPage((p) => Math.max(1, p - 1))}
									disabled={paymentHistoryCurrentPage <= 1}
									className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
								>
									Previous
								</button>
								<span className="text-sm text-gray-600 dark:text-gray-400">
									Page {paymentHistoryCurrentPage} of {paymentHistoryTotalPages}
								</span>
								<button
									type="button"
									onClick={() => setPaymentHistoryPage((p) => Math.min(paymentHistoryTotalPages, p + 1))}
									disabled={paymentHistoryCurrentPage >= paymentHistoryTotalPages}
									className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
								>
									Next
								</button>
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Payment Confirmation Modal */}
			{showPaymentModal && (
				<PaymentConfirmation
					tenant={tenant}
					roomNumber={tenant?.unit_no || tenant?.room_no}
					propertyId={tenant?.property_id}
					defaultAmount={paymentForMonth
						? paymentForMonth.remainingBalance
						: (paymentModalDefaultAmount != null ? paymentModalDefaultAmount : (tenant?.payment || tenant?.rent || ''))}
					defaultMarkAsLate={paymentForMonth ? paymentForMonth.isLate : openPaymentAsLate}
					isBalancePayment={paymentForMonth ? paymentForMonth.status === 'partial' : openPaymentAsBalancePayment}
					forMonth={paymentForMonth?.forMonth}
					forMonthLabel={paymentForMonth?.label}
					onClose={() => {
						setPaymentForMonth(null)
						setOpenPaymentAsLate(false)
						setOpenPaymentAsBalancePayment(false)
						setPaymentModalDefaultAmount(null)
						setShowPaymentModal(false)
					}}
					onSuccess={() => fetchTenantData({ silent: true })}
					batchRooms={!paymentForMonth && rentedRooms?.length > 1 ? rentedRooms.map(r => ({
						propertyId: r.property_id,
						roomNumber: r.room_number,
						defaultAmount: r.payment
					})) : undefined}
				/>
			)}

			{/* Notes Modal with Rich Text Editor */}
			{showNotesModal && (
				<div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50">
					<div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl mx-4 overflow-hidden max-h-[90vh] flex flex-col">
						<div className="bg-gradient-to-r from-purple-600 to-purple-700 px-6 py-4">
							<h3 className="text-lg font-semibold text-white">Tenant Notes</h3>
							<p className="text-purple-100 text-sm">Add notes, violations, or important remarks for {tenant.full_name || tenant.name}</p>
						</div>
						<div className="p-6 flex-1 overflow-auto">
							{/* Formatting Toolbar */}
							<div className="flex flex-wrap gap-1 mb-3 p-2 bg-gray-100 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
								<button
									type="button"
									onClick={() => formatText('bold')}
									className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded font-bold text-sm text-gray-700 dark:text-gray-300"
									title="Bold"
								>
									B
								</button>
								<button
									type="button"
									onClick={() => formatText('italic')}
									className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded italic text-sm text-gray-700 dark:text-gray-300"
									title="Italic"
								>
									I
								</button>
								<button
									type="button"
									onClick={() => formatText('underline')}
									className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded underline text-sm text-gray-700 dark:text-gray-300"
									title="Underline"
								>
									U
								</button>
								<div className="w-px bg-gray-300 dark:bg-gray-600 mx-1"></div>
								<button
									type="button"
									onClick={() => formatText('foreColor', '#dc2626')}
									className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-sm text-red-600 font-medium"
									title="Red Text (Violations)"
								>
									A
								</button>
								<button
									type="button"
									onClick={() => formatText('foreColor', '#f59e0b')}
									className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-sm text-yellow-600 font-medium"
									title="Yellow Text (Warnings)"
								>
									A
								</button>
								<button
									type="button"
									onClick={() => formatText('foreColor', '#16a34a')}
									className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-sm text-green-600 font-medium"
									title="Green Text (Positive)"
								>
									A
								</button>
								<button
									type="button"
									onClick={() => formatText('foreColor', '#000000')}
									className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-sm font-medium text-gray-700 dark:text-gray-300"
									title="Black Text"
								>
									A
								</button>
								<div className="w-px bg-gray-300 dark:bg-gray-600 mx-1"></div>
								<button
									type="button"
									onClick={() => formatText('hiliteColor', '#fef08a')}
									className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-sm bg-yellow-200"
									title="Highlight"
								>
									<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
										<path d="M10 2a8 8 0 100 16 8 8 0 000-16z" />
									</svg>
								</button>
								<button
									type="button"
									onClick={() => formatText('hiliteColor', '#fecaca')}
									className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-sm bg-red-200"
									title="Red Highlight"
								>
									<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
										<path d="M10 2a8 8 0 100 16 8 8 0 000-16z" />
									</svg>
								</button>
								<button
									type="button"
									onClick={() => formatText('removeFormat')}
									className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-sm text-gray-500 dark:text-gray-400"
									title="Clear Formatting"
								>
									<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
										<path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
									</svg>
								</button>
								<div className="w-px bg-gray-300 dark:bg-gray-600 mx-1"></div>
								<button
									type="button"
									onClick={() => formatText('insertUnorderedList')}
									className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-sm text-gray-700 dark:text-gray-300"
									title="Bullet List"
								>
									<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
										<path fillRule="evenodd" d="M3 4a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 011-1h9a1 1 0 110 2H8a1 1 0 01-1-1zm0 5a1 1 0 011-1h9a1 1 0 110 2H8a1 1 0 01-1-1zm-3 1a1 1 0 100-2 1 1 0 000 2zm3 4a1 1 0 011-1h9a1 1 0 110 2H8a1 1 0 01-1-1zm-3 1a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
									</svg>
								</button>
								<button
									type="button"
									onClick={() => formatText('insertOrderedList')}
									className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-sm text-gray-700 dark:text-gray-300"
									title="Numbered List"
								>
									<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
										<path d="M3 4a1 1 0 011-1h.5a.5.5 0 01.5.5v3a.5.5 0 01-1 0V4H3.5A.5.5 0 013 3.5zM7 4a1 1 0 011-1h9a1 1 0 110 2H8a1 1 0 01-1-1zm0 5a1 1 0 011-1h9a1 1 0 110 2H8a1 1 0 01-1-1zm0 5a1 1 0 011-1h9a1 1 0 110 2H8a1 1 0 01-1-1z" />
									</svg>
								</button>
							</div>

							{/* Rich Text Editor */}
							<div
								ref={notesEditorRef}
								contentEditable
								suppressContentEditableWarning={true}
								className="min-h-[200px] max-h-[300px] overflow-auto p-4 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
								style={{ whiteSpace: 'pre-wrap' }}
							/>

							{/* Quick Templates */}
							<div className="mt-3">
								<p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Quick Templates:</p>
								<div className="flex flex-wrap gap-2">
									<button
										type="button"
										onClick={() => {
											const template = `<p><strong style="color: #dc2626;">VIOLATION:</strong> </p>`
											if (notesEditorRef.current) {
												notesEditorRef.current.innerHTML += template
												notesEditorRef.current.focus()
											}
										}}
										className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
									>
										+ Violation
									</button>
									<button
										type="button"
										onClick={() => {
											const template = `<p><strong style="color: #f59e0b;">WARNING:</strong> </p>`
											if (notesEditorRef.current) {
												notesEditorRef.current.innerHTML += template
												notesEditorRef.current.focus()
											}
										}}
										className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200"
									>
										+ Warning
									</button>
									<button
										type="button"
										onClick={() => {
											const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
											const template = `<p><strong>[${date}]</strong> </p>`
											if (notesEditorRef.current) {
												notesEditorRef.current.innerHTML += template
												notesEditorRef.current.focus()
											}
										}}
										className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
									>
										+ Date Entry
									</button>
									<button
										type="button"
										onClick={() => {
											const template = `<p><strong style="color: #16a34a;">RESOLVED:</strong> </p>`
											if (notesEditorRef.current) {
												notesEditorRef.current.innerHTML += template
												notesEditorRef.current.focus()
											}
										}}
										className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
									>
										+ Resolved
									</button>
								</div>
							</div>
						</div>

						{/* Modal Actions */}
						<div className="px-6 py-4 bg-gray-50 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-600 flex justify-end gap-3">
							<button
								onClick={() => {
									setShowNotesModal(false)
									setNotesContent('')
								}}
								disabled={notesSaving}
								className="px-4 py-2 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 rounded-lg font-medium transition-colors disabled:opacity-50"
							>
								Cancel
							</button>
							<button
								onClick={handleSaveNotes}
								disabled={notesSaving}
								className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
							>
								{notesSaving ? (
									<>
										<svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
											<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
											<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
										</svg>
										Saving...
									</>
								) : (
									<>
										<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
											<path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
										</svg>
										Save Notes
									</>
								)}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Remove Tenant Modal */}
			{showRemoveModal && (
				<RemoveTenantModal
					tenant={tenant}
					roomNumber={tenant?.last_room}
					onClose={() => setShowRemoveModal(false)}
					onSuccess={() => onBack(true)}
				/>
			)}

			{/* Send reminder modal - same API as Message tab */}
			<SendReminderModal
				open={showReminderModal}
				onClose={() => setShowReminderModal(false)}
				tenantId={tenant?.tenant_id ?? tenant?.id}
				tenantName={tenant?.full_name}
				tenantEmail={tenant?.email || ''}
				monthlyRent={parseFloat(tenant?.payment || tenant?.rent || 0) || 0}
				dueDate={reminderDueDateStr}
			/>
			{/* Overdue reminder modal - pre-filled with overdue message */}
			<SendReminderModal
				open={showOverdueReminderModal}
				onClose={() => setShowOverdueReminderModal(false)}
				tenantId={tenant?.tenant_id ?? tenant?.id}
				tenantName={tenant?.full_name}
				tenantEmail={tenant?.email || ''}
				monthlyRent={parseFloat(tenant?.payment || tenant?.rent || 0) || 0}
				dueDate={reminderDueDateStr}
				overdueMessage={`Good day ${tenant?.full_name || 'Tenant'}! This is an overdue payment notice. Your monthly rent of ₱${(parseFloat(tenant?.payment || tenant?.rent || 0) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })} is ${paymentStatus.daysOverdue} day${paymentStatus.daysOverdue !== 1 ? 's' : ''} overdue. A late fee of ₱50/day has been accumulating, totaling ₱${((paymentStatus.daysOverdue ?? 0) * 50).toLocaleString()} so far. Please settle your balance immediately to avoid further penalties. Thank you!`}
			/>

			{/* Documents Modal */}
			{showDocumentsModal && (
				<div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
					<div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
						{/* Modal Header */}
						<div className="px-6 py-4 border-b bg-gradient-to-r from-gray-700 to-gray-800 text-white">
							<div className="flex items-center justify-between">
								<div>
									<h2 className="text-xl font-bold">Documents</h2>
									<p className="text-sm text-gray-300">{tenant?.full_name}</p>
								</div>
								<button
									onClick={() => setShowDocumentsModal(false)}
									className="p-2 hover:bg-white/10 rounded-lg transition-colors"
								>
									<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
									</svg>
								</button>
							</div>
						</div>

						{/* Upload Section */}
						<div className="px-6 py-4 bg-gray-50 border-b">
							<div className="flex items-center gap-4">
								<select
									id="doc-type-select"
									className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
									defaultValue="other"
								>
									<option value="id_photo">ID Photo (Tenant)</option>
									<option value="id_photo_occupant">ID Photo (Other Occupant)</option>
									<option value="contract">Contract</option>
									<option value="proof_of_billing">Proof of Billing</option>
									<option value="authorization">Authorization</option>
									<option value="other">Other</option>
								</select>
								<label className="flex-1 cursor-pointer">
									<div className="border-2 border-dashed border-gray-300 rounded-lg px-4 py-3 hover:border-blue-400 transition-colors text-center">
										<svg className="w-8 h-8 mx-auto text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
										</svg>
										<span className="text-sm text-gray-600">
											{uploadingDoc ? 'Uploading...' : 'Click to upload'}
										</span>
										<p className="text-xs text-gray-400 mt-1">PDF, PNG, JPG, DOC (max 10MB)</p>
									</div>
									<input
										type="file"
										onChange={(e) => {
											const docType = document.getElementById('doc-type-select').value
											// For occupant ID photos, use id_photo type but add description
											const actualType = docType === 'id_photo_occupant' ? 'id_photo' : docType
											const isOccupant = docType === 'id_photo_occupant'
											handleDocumentUpload(e.target.files, actualType, isOccupant ? 'Other Occupant ID' : '')
											e.target.value = '' // Reset to allow re-selecting same file
										}}
										className="hidden"
										accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.gif,.bmp,.webp"
										multiple
										disabled={uploadingDoc}
									/>
								</label>
							</div>
						</div>

						{/* Documents List */}
						<div className="flex-1 overflow-y-auto p-6">
							{documentsLoading ? (
								<div className="flex items-center justify-center py-12">
									<svg className="w-8 h-8 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
										<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
										<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
									</svg>
								</div>
							) : documents.length === 0 ? (
								<div className="text-center py-12 text-gray-500">
									<svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
									</svg>
									<p>No documents uploaded yet</p>
									<p className="text-sm">Upload ID photos, contracts, or other documents</p>
								</div>
							) : (() => {
								// Group documents: Tenant ID photos, Other Occupant IDs, Other documents
								const tenantIdPhotos = documents.filter(d => d.document_type === 'id_photo' && !d.description?.toLowerCase().includes('other occupant'))
								const occupantIdPhotos = documents.filter(d => d.document_type === 'id_photo' && d.description?.toLowerCase().includes('other occupant'))
								const otherDocs = documents.filter(d => d.document_type !== 'id_photo')

								const renderDocCard = (doc) => {
									const isImage = doc.mime_type?.startsWith('image/')
									const isPdf = doc.mime_type === 'application/pdf'
									const isOccupantId = doc.description?.toLowerCase().includes('other occupant')
									return (
										<div
											key={doc.document_id}
											className={`border rounded-lg p-4 hover:shadow-md transition-shadow ${isOccupantId ? 'border-purple-200 bg-purple-50/30' : 'border-gray-200'
												}`}
										>
											<div className="flex items-start gap-3">
												{/* Thumbnail/Icon */}
												<div className="w-16 h-16 flex-shrink-0 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden">
													{isImage ? (
														<img
															src={doc.file_url || doc.file}
															alt={doc.original_filename}
															className="w-full h-full object-cover"
														/>
													) : isPdf ? (
														<svg className="w-8 h-8 text-red-500" fill="currentColor" viewBox="0 0 20 20">
															<path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
														</svg>
													) : (
														<svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
															<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
														</svg>
													)}
												</div>

												{/* Info */}
												<div className="flex-1 min-w-0">
													<p className="font-medium text-gray-900 truncate" title={doc.original_filename}>
														{doc.original_filename}
													</p>
													<div className="flex flex-wrap gap-1 mt-1">
														<span className={`px-1.5 py-0.5 rounded text-xs ${doc.document_type === 'id_photo'
															? 'bg-blue-100 text-blue-700'
															: doc.document_type === 'contract'
																? 'bg-green-100 text-green-700'
																: doc.document_type === 'proof_of_billing'
																	? 'bg-yellow-100 text-yellow-700'
																	: doc.document_type === 'authorization'
																		? 'bg-orange-100 text-orange-700'
																		: 'bg-gray-100 text-gray-700'
															}`}>
															{doc.document_type_display || doc.document_type}
														</span>
														{doc.is_primary_id && (
															<span className="px-1.5 py-0.5 bg-blue-600 text-white rounded text-xs">Primary</span>
														)}
														{isOccupantId && (
															<span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs">Occupant</span>
														)}
													</div>
													{doc.description && !isOccupantId && (
														<p className="text-xs text-gray-500 mt-0.5 truncate" title={doc.description}>
															{doc.description}
														</p>
													)}
													{isOccupantId && doc.description && (
														<p className="text-xs text-purple-600 mt-0.5 truncate" title={doc.description}>
															{doc.description.replace('Other Occupant: ', '').replace('Other Occupant ID', 'Occupant')}
														</p>
													)}
													<p className="text-xs text-gray-400 mt-0.5">
														{(doc.file_size / 1024).toFixed(1)} KB • {new Date(doc.created_at).toLocaleDateString()}
													</p>
												</div>
											</div>

											{/* Actions */}
											<div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
												<button
													onClick={() => setViewingDocument(doc)}
													className="flex-1 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-sm text-center transition-colors"
												>
													View
												</button>
												<a
													href={doc.file_url || doc.file}
													download={doc.original_filename}
													className="flex-1 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded text-sm text-center transition-colors"
												>
													Download
												</a>
												{isImage && doc.document_type === 'id_photo' && !doc.is_primary_id && !isOccupantId && (
													<button
														onClick={() => handleSetPrimaryId(doc.document_id)}
														className="px-3 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 rounded text-sm transition-colors"
														title="Set as primary ID"
													>
														Set Primary
													</button>
												)}
												<button
													onClick={() => handleDocumentDelete(doc.document_id)}
													className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded text-sm transition-colors"
												>
													Delete
												</button>
											</div>
										</div>
									)
								}

								return (
									<div className="space-y-6">
										{/* Tenant ID Photos */}
										{tenantIdPhotos.length > 0 && (
											<div>
												<h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
													<svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
													</svg>
													Tenant ID Photos ({tenantIdPhotos.length})
												</h3>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													{tenantIdPhotos.map(renderDocCard)}
												</div>
											</div>
										)}

										{/* Other Occupant ID Photos */}
										{occupantIdPhotos.length > 0 && (
											<div>
												<h3 className="text-sm font-semibold text-purple-700 mb-3 flex items-center gap-2">
													<svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
													</svg>
													Other Occupant IDs ({occupantIdPhotos.length})
												</h3>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													{occupantIdPhotos.map(renderDocCard)}
												</div>
											</div>
										)}

										{/* Other Documents */}
										{otherDocs.length > 0 && (
											<div>
												<h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
													<svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
													</svg>
													Other Documents ({otherDocs.length})
												</h3>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													{otherDocs.map(renderDocCard)}
												</div>
											</div>
										)}
									</div>
								)
							})()}
						</div>

						{/* Modal Footer */}
						<div className="px-6 py-4 border-t bg-gray-50 flex justify-end">
							<button
								onClick={() => setShowDocumentsModal(false)}
								className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors"
							>
								Close
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Document Viewer Modal */}
			{viewingDocument && (
				<div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
					<div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[95vh] flex flex-col overflow-hidden">
						{/* Viewer Header */}
						<div className="px-4 py-3 border-b bg-gray-900 text-white flex items-center justify-between">
							<div className="flex items-center gap-3 min-w-0">
								<button
									onClick={() => setViewingDocument(null)}
									className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
									title="Back to documents"
								>
									<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
									</svg>
								</button>
								<div className="min-w-0">
									<h3 className="font-medium truncate" title={viewingDocument.original_filename}>
										{viewingDocument.original_filename}
									</h3>
									<p className="text-xs text-gray-400">
										{viewingDocument.document_type_display || viewingDocument.document_type} • {(viewingDocument.file_size / 1024).toFixed(1)} KB
									</p>
								</div>
							</div>
							<div className="flex items-center gap-2">
								<a
									href={viewingDocument.file_url || viewingDocument.file}
									download={viewingDocument.original_filename}
									className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors flex items-center gap-1.5"
								>
									<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
									</svg>
									Download
								</a>
								<a
									href={viewingDocument.file_url || viewingDocument.file}
									target="_blank"
									rel="noopener noreferrer"
									className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors flex items-center gap-1.5"
								>
									<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
									</svg>
									Open in Tab
								</a>
								<button
									onClick={() => setViewingDocument(null)}
									className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
								>
									<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
									</svg>
								</button>
							</div>
						</div>

						{/* Document Content */}
						<div className="flex-1 overflow-auto bg-gray-100 flex items-center justify-center">
							{viewingDocument.mime_type?.startsWith('image/') ? (
								<img
									src={viewingDocument.file_url || viewingDocument.file}
									alt={viewingDocument.original_filename}
									className="max-w-full max-h-full object-contain"
								/>
							) : viewingDocument.mime_type === 'application/pdf' ? (
								<iframe
									src={viewingDocument.file_url || viewingDocument.file}
									title={viewingDocument.original_filename}
									className="w-full h-full min-h-[70vh]"
									style={{ border: 'none' }}
								/>
							) : (
								<div className="text-center py-12">
									<svg className="w-20 h-20 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
									</svg>
									<p className="text-gray-600 mb-2">Preview not available for this file type</p>
									<p className="text-sm text-gray-500 mb-4">{viewingDocument.mime_type}</p>
									<a
										href={viewingDocument.file_url || viewingDocument.file}
										download={viewingDocument.original_filename}
										className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
									>
										<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
										</svg>
										Download File
									</a>
								</div>
							)}
						</div>
					</div>
				</div>
			)}
		</div >
	)
}

export default TenantProfile

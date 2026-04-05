import { useEffect, useRef, useState, useMemo } from 'react'
import { authFetch } from '../auth'
import EditTenant from './EditTenant.jsx'
import TransferTenant from './TransferTenant.jsx'
import PaymentConfirmation from './PaymentConfirmation.jsx'
import RemoveTenantModal from './RemoveTenantModal.jsx'
import SendReminderModal from './SendReminderModal.jsx'
import { getUnpaidMonths, parseAmount as parseAmountUtil } from './paymentUtils.js'

// Collapsible section component
function CollapsibleSection({ title, icon, defaultOpen = true, children, badge, badgeColor = 'gray' }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  return (
    <div className="mb-4 group/section">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 hover:bg-white dark:hover:bg-gray-700/60 border border-transparent hover:border-gray-200 dark:hover:border-gray-700 transition-all duration-300"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white dark:bg-gray-800 rounded-lg shadow-sm text-gray-400 group-hover/section:text-blue-500 transition-colors">
            {icon}
          </div>
          <div className="flex flex-col items-start">
            <span className="text-xs font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">{title}</span>
          </div>
          {badge && (
            <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-full ${badgeColor === 'green' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
              badgeColor === 'red' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                badgeColor === 'amber' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                  badgeColor === 'blue' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                    'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
              }`}>{badge}</span>
          )}
        </div>
        <svg className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="mt-3 px-1 animate-fade-in">
          {children}
        </div>
      )}
    </div>
  )
}

// Individual Transaction Item component
function TransactionItem({ tx, onViewTenantProfile, onClose, isReceivable }) {
  const txTenantId = tx.tenant_id ?? tx.id
  const canViewProfile = txTenantId != null && typeof onViewTenantProfile === 'function'

  return (
    <div className="group/tx p-4 bg-white dark:bg-gray-800/20 rounded-2xl border border-gray-100 dark:border-gray-800/80 hover:border-blue-200 dark:hover:border-blue-900/50 transition-all duration-300">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div
          className={`text-sm font-bold truncate flex-1 text-gray-900 dark:text-white ${canViewProfile ? 'cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors' : ''}`}
          onClick={canViewProfile ? () => { onViewTenantProfile(txTenantId); if (typeof onClose === 'function') onClose(); } : undefined}
        >
          {tx.name}
        </div>
        <span className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-widest rounded-lg ${isReceivable ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
          tx.payment_type === 'advance' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
            tx.payment_type === 'deposit' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
              'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
          }`}>
          {isReceivable ? 'Reimbursement' : tx.payment_type === 'advance' ? 'Advance' : tx.payment_type === 'deposit' ? 'Deposit' : 'Rent'}
        </span>
      </div>

      <div className="flex items-end justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold text-gray-400">{tx.date}</span>
          {isReceivable && tx.notes && (
            <span className="text-[10px] text-gray-500 italic max-w-[150px] truncate" title={tx.notes}>"{tx.notes}"</span>
          )}
        </div>
        <div className="text-right">
          <div className="text-sm font-black text-green-600 dark:text-green-500">
            ₱{typeof tx.amount === 'number' ? tx.amount.toLocaleString() : (typeof tx.amount === 'string' ? tx.amount : String(tx.amount ?? 0))}
          </div>
          {(tx.payment_type === 'rent' && (tx.payment_status === 'partial' || (tx.remaining_balance != null && Number(tx.remaining_balance) > 0))) && (
            <div className="text-[9px] font-black uppercase text-amber-500 tracking-tighter mt-0.5">
              Partial · Bal ₱{Number(tx.remaining_balance ?? 0).toLocaleString()}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function RoomSidebar({ box, allBoxes, onClose, onSave, onAddTenant, formatRoomDisplay, onViewTenantProfile, onPaymentSuccess, onOpenPaymentModal, onReceivableReceived, onOpenEditModal, onOpenTransferModal, isArchived = false }) {
  const [showEditModal, setShowEditModal] = useState(false)
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showBalancePaymentModal, setShowBalancePaymentModal] = useState(false)
  const [showRemoveModal, setShowRemoveModal] = useState(false)
  const [showReminderModal, setShowReminderModal] = useState(false)
  const [showOverdueReminderModal, setShowOverdueReminderModal] = useState(false)
  const [paymentForMonth, setPaymentForMonth] = useState(null)
  const [copiedItem, setCopiedItem] = useState(null)

  // Handle click-to-copy
  const handleCopy = (text, item) => {
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setCopiedItem(item)
      setTimeout(() => setCopiedItem(null), 2000)
    })
  }

  // Merge received receivables into transaction history (must be before early return for hooks order)
  const displayTransactions = useMemo(() => {
    if (!box) return []
    const list = (box.transactions || []).map(t => ({ ...t, _sort: t.timestamp ?? (t.date ? new Date(t.date).getTime() : 0) }))
    const received = (box.tenant?.receivables || []).filter(r => r.received === true).map(r => ({
      name: box.tenant?.full_name,
      date: r.received_at ? new Date(r.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '',
      amount: parseFloat(r.amount) || 0,
      payment_type: 'receivable',
      notes: r.reason || 'Reimbursement',
      _sort: r.received_at ? new Date(r.received_at).getTime() : 0
    }))
    list.push(...received)
    list.sort((a, b) => (b._sort || 0) - (a._sort || 0))
    return list.slice(0, 5)
  }, [box?.transactions, box?.tenant?.receivables, box?.tenant?.full_name])

  // Helper: only transactions that belong to the CURRENT tenant (not previous occupants of the room)
  const currentTenantId = box?.tenant?.tenant_id ?? box?.tenant?.id
  const isTransactionForCurrentTenant = (t) => {
    if (!currentTenantId) return false
    const tid = t.tenant_id ?? t.id
    if (tid == null) return false
    return String(tid) === String(currentTenantId)
  }

  // Current month rent status: paid, partial (with remaining), due_today, due_soon, past_due, or not_due_yet (new tenant)
  // Uses only transactions for the CURRENT tenant so previous tenant balance is not shown
  const monthlyRentStatus = useMemo(() => {
    if (!box?.tenant) return null
    // Get monthly rent from box.payment, or tenant.payment/rent as fallback
    const monthlyRent = parseFloat(box.payment) || parseFloat(box.tenant?.payment) || parseFloat(box.tenant?.rent) || 0
    if (monthlyRent <= 0) return null
    const allTransactions = box.transactions || []
    const transactions = allTransactions.filter(isTransactionForCurrentTenant)
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()
    const today = new Date(currentYear, currentMonth, now.getDate())

    // Calculate due date based on move-in date
    // Uses same logic as Dashboard: if tenant moved in this month, first rent is due NEXT month
    // (advance payment covers the move-in month)
    const moveInDate = box.tenant.move_in || box.tenant.date_of_occupancy
    let dueDate = null
    if (moveInDate) {
      // Parse date string manually to avoid timezone issues (e.g., "2026-02-01" interpreted as UTC)
      let moveInYear, moveInMonth, dueDay
      if (typeof moveInDate === 'string' && moveInDate.match(/^\d{4}-\d{2}-\d{2}/)) {
        const parts = moveInDate.split('-')
        moveInYear = parseInt(parts[0], 10)
        moveInMonth = parseInt(parts[1], 10) - 1 // JS months are 0-indexed
        dueDay = parseInt(parts[2], 10)
      } else {
        const moveIn = new Date(moveInDate)
        moveInYear = moveIn.getFullYear()
        moveInMonth = moveIn.getMonth()
        dueDay = moveIn.getDate()
      }

      const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate()
      const adjustedDueDay = Math.min(dueDay, lastDayOfMonth)
      dueDate = new Date(currentYear, currentMonth, adjustedDueDay)

      // Check if due date is in the same month as move-in (advance covers it) or before move-in
      const dueDateInMoveInMonth = dueDate.getMonth() === moveInMonth && dueDate.getFullYear() === moveInYear
      const moveInDateObj = new Date(moveInYear, moveInMonth, dueDay)
      const dueDateBeforeMoveIn = dueDate < moveInDateObj

      // If due date is in move-in month or before move-in, push to next month
      if (dueDateInMoveInMonth || dueDateBeforeMoveIn) {
        const nextMonth = currentMonth + 1
        const nextYear = nextMonth > 11 ? currentYear + 1 : currentYear
        const actualNextMonth = nextMonth > 11 ? 0 : nextMonth
        const lastDayOfNextMonth = new Date(nextYear, actualNextMonth + 1, 0).getDate()
        const adjustedDueDayNext = Math.min(dueDay, lastDayOfNextMonth)
        dueDate = new Date(nextYear, actualNextMonth, adjustedDueDayNext)
      }
    }

    const parseAmount = (t) => {
      const raw = t.amount ?? 0
      const str = typeof raw === 'string' ? String(raw).replace(/,/g, '') : String(raw)
      return parseFloat(str) || 0
    }
    const rentTx = transactions.filter(t => {
      const pt = (t.payment_type || '').toString().toLowerCase()
      if (pt !== 'rent' && pt !== 'monthly_rent') return false
      const d = new Date(t.timestamp || t.date)
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear
    })

    if (rentTx.length > 0) {
      const paidSoFar = rentTx.reduce((sum, t) => sum + parseAmount(t), 0)

      // Check if the latest transaction was marked as partial with remaining balance
      const latestTx = rentTx.sort((a, b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date))[0]
      const hasRemainingBalance = latestTx.remaining_balance != null && Number(latestTx.remaining_balance) > 0
      const isMarkedPartial = latestTx.payment_status === 'partial'

      // If explicitly marked as partial or has remaining balance, show as partial
      if (isMarkedPartial || hasRemainingBalance) {
        const remaining = hasRemainingBalance
          ? Number(latestTx.remaining_balance)
          : Math.max(0, monthlyRent - paidSoFar)
        return { status: 'partial', label: 'Partial', remainingBalance: remaining, paidSoFar }
      }

      // Check if fully paid based on sum
      if (paidSoFar >= monthlyRent) {
        return { status: 'paid', label: 'Paid', remainingBalance: 0, paidSoFar }
      }

      // Paid something but not enough (calculated partial)
      const remaining = Math.max(0, monthlyRent - paidSoFar)
      return { status: 'partial', label: 'Partial', remainingBalance: remaining, paidSoFar }
    }

    // No payment made yet - determine if due today, due soon, or past due
    if (dueDate) {
      // Use the actual dueDate (which may be next month for new tenants)
      const dueDateOnly = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate())

      if (today.getTime() === dueDateOnly.getTime()) {
        return { status: 'due_today', label: 'Due Today', remainingBalance: monthlyRent, paidSoFar: 0, message: 'Payment due today' }
      }
      if (today > dueDateOnly) {
        const daysOverdue = Math.floor((today - dueDateOnly) / (1000 * 60 * 60 * 24))
        return {
          status: 'past_due',
          label: 'Past Due',
          remainingBalance: monthlyRent,
          paidSoFar: 0,
          daysOverdue,
          message: `${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue`
        }
      }
      const daysUntilDue = Math.floor((dueDateOnly - today) / (1000 * 60 * 60 * 24))
      return {
        status: 'due_soon',
        label: `Due in ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''}`,
        remainingBalance: monthlyRent,
        paidSoFar: 0,
        daysUntilDue,
        message: `Due in ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''}`
      }
    }

    // Fallback if no due date could be calculated
    return { status: 'due', label: 'Due', remainingBalance: monthlyRent, paidSoFar: 0 }
  }, [box?.tenant, box?.transactions, box?.payment, currentTenantId])

  // Multi-month unpaid tracking
  const unpaidMonths = useMemo(() => {
    if (!box?.tenant) return []
    const monthlyRent = parseFloat(box.payment) || parseFloat(box.tenant?.payment) || parseFloat(box.tenant?.rent) || 0
    if (monthlyRent <= 0) return []
    const allTx = box.transactions || []
    const tenantTx = allTx.filter(isTransactionForCurrentTenant)
    return getUnpaidMonths({
      moveInDate: box.tenant.move_in || box.tenant.date_of_occupancy,
      monthlyRent,
      transactions: tenantTx,
      advancePaid: box.tenant.advance_paid !== false,
    })
  }, [box?.tenant, box?.transactions, box?.payment, currentTenantId])

  // Fallback: show Balance Payment when any current-month rent transaction has remaining_balance (in case sum-based status missed it)
  // Only consider transactions for the CURRENT tenant, not previous occupants
  const balancePaymentFromTransaction = useMemo(() => {
    const monthlyRent = parseFloat(box?.payment) || parseFloat(box?.tenant?.payment) || parseFloat(box?.tenant?.rent) || 0
    if (!box?.tenant || monthlyRent <= 0) return null
    const allTransactions = box.transactions || []
    const transactions = allTransactions.filter(isTransactionForCurrentTenant)
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()
    const partialRent = transactions.filter(t => {
      const pt = (t.payment_type || '').toString().toLowerCase()
      if (pt !== 'rent' && pt !== 'monthly_rent') return false
      const d = new Date(t.timestamp || t.date)
      if (d.getMonth() !== currentMonth || d.getFullYear() !== currentYear) return false
      return t.payment_status === 'partial' || (t.remaining_balance != null && Number(t.remaining_balance) > 0)
    })
    if (partialRent.length === 0) return null
    const latest = partialRent.sort((a, b) => (new Date(b.timestamp || b.date) || 0) - (new Date(a.timestamp || a.date) || 0))[0]
    const rem = Number(latest.remaining_balance) || 0
    if (rem <= 0) return null
    return { remainingBalance: rem, paidSoFar: Math.max(0, monthlyRent - rem) }
  }, [box?.tenant, box?.payment, box?.tenant?.payment, box?.tenant?.rent, box?.transactions, currentTenantId])

  // When monthlyRentStatus says 'paid', use 0 — don't use previous tenant's balance
  const balancePaymentRemaining = monthlyRentStatus?.status === 'paid'
    ? 0
    : (monthlyRentStatus?.status === 'partial' ? monthlyRentStatus.remainingBalance : null) ?? balancePaymentFromTransaction?.remainingBalance ?? 0
  const balancePaymentPaidSoFar = monthlyRentStatus?.status === 'paid'
    ? (monthlyRentStatus?.paidSoFar ?? 0)
    : (monthlyRentStatus?.status === 'partial' ? monthlyRentStatus.paidSoFar : null) ?? balancePaymentFromTransaction?.paidSoFar ?? 0
  // Show Balance Payment button only when there is a remaining balance > 0 (hide for paid)
  const showBalancePayment = Number(balancePaymentRemaining) > 0
  // When remaining is 0, treat as paid for display (show green "Paid", hide Partial line and button)
  const displayAsPaid = !showBalancePayment && monthlyRentStatus?.status === 'partial'

  if (!box) return null

  const update = (patch) => {
    if (typeof onSave === 'function') onSave(box.id, patch)
  }

  const asideRef = useRef(null)

  useEffect(() => {
    if (typeof onClose !== 'function') return
    const onDown = (e) => {
      if (!asideRef.current) return
      // Don't close if any modal is open
      if (showEditModal || showTransferModal || showPaymentModal || showBalancePaymentModal || showRemoveModal || showReminderModal || showOverdueReminderModal || paymentForMonth) return
      if (!asideRef.current.contains(e.target)) onClose()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        // If modal is open, close only the modal
        if (showEditModal) {
          setShowEditModal(false)
        } else if (showTransferModal) {
          setShowTransferModal(false)
        } else if (showPaymentModal) {
          setShowPaymentModal(false)
        } else if (showBalancePaymentModal) {
          setShowBalancePaymentModal(false)
        } else if (showRemoveModal) {
          setShowRemoveModal(false)
        } else if (showReminderModal) {
          setShowReminderModal(false)
        } else if (showOverdueReminderModal) {
          setShowOverdueReminderModal(false)
        } else if (paymentForMonth) {
          setPaymentForMonth(null)
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, showEditModal, showTransferModal, showPaymentModal, showBalancePaymentModal, showRemoveModal, showReminderModal, showOverdueReminderModal, paymentForMonth])

  const isOccupied = box.status === 'occupied'
  const isMaintenance = box.status === 'maintenance'
  const isUnoccupied = box.status === 'available'

  const handleEditSuccess = (updatedData) => {
    // Close the modal immediately - WebSocket will update the UI automatically
    // No optimistic update needed since WebSocket provides real-time updates
    setShowEditModal(false)

    console.debug('Tenant updated, waiting for WebSocket to refresh UI', {
      tenantId: updatedData?.tenant_id || updatedData?.id,
      boxId: box.id
    })
  }

  const handleTransferSuccess = () => {
    setShowTransferModal(false)
    if (typeof onClose === 'function') onClose()
  }

  const handlePaymentSuccess = () => {
    // Don't close modal here — PaymentConfirmation will show the send-confirmation step first
    // Call parent callback to trigger refresh (for Reports tab)
    if (typeof onPaymentSuccess === 'function') {
      onPaymentSuccess()
    }
  }

  const handleOpenBalancePayment = () => {
    setShowBalancePaymentModal(true)
  }

  const handleMarkReceivableReceived = async (receivableId) => {
    if (!box?.tenant) return
    const tenantId = box.tenant.tenant_id ?? box.tenant.id
    try {
      const res = await authFetch(`/api/tenants/${tenantId}/receivables/${receivableId}/received/`, { method: 'POST' })
      if (res.ok && typeof onReceivableReceived === 'function') {
        onReceivableReceived()
      } else if (!res.ok) {
        const data = await res.json()
        alert(data.error || 'Failed to mark as received')
      }
    } catch (err) {
      alert('Failed to mark as received: ' + err.message)
    }
  }

  const handleMaintenanceMode = async () => {
    if (box.tenant) {
      alert('Please remove or transfer the tenant before marking room as under maintenance.')
      return
    }

    const confirmed = window.confirm(
      `Mark Room ${box.number} as Under Maintenance?`
    )

    if (!confirmed) return

    try {
      const response = await authFetch(`/api/properties/${box.propertyId}/rooms/${box.number}/status/`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: 'maintenance', floor: box.floor || 1, section: box.section || '', type: box.type || 'room' })
      })

      if (!response.ok) {
        throw new Error('Failed to update room status')
      }

      // Close the sidebar - WebSocket will update the UI automatically
      if (typeof onClose === 'function') {
        onClose()
      }
    } catch (error) {
      alert('Error updating room status: ' + error.message)
    }
  }

  const handleMarkUnoccupied = async () => {
    const confirmed = window.confirm(
      `Mark Room ${box.number} as Unoccupied?`
    )

    if (!confirmed) return

    try {
      const response = await authFetch(`/api/properties/${box.propertyId}/rooms/${box.number}/status/`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: 'available', floor: box.floor || 1, section: box.section || '', type: box.type || 'room' })
      })

      if (!response.ok) {
        throw new Error('Failed to update room status')
      }

      // Close the sidebar - WebSocket will update the UI automatically
      if (typeof onClose === 'function') {
        onClose()
      }
    } catch (error) {
      alert('Error updating room status: ' + error.message)
    }
  }

  // Compute next payment date based on move-in date anniversary
  // Payment is due on the same day of each month as the move-in date
  // e.g., if moved in March 1, payment is due April 1, May 1, etc.
  const getNextPaymentDate = () => {
    if (!box.tenant) return 'Not Set'
    const moveInDate = box.tenant.move_in || box.tenant.date_of_occupancy
    if (!moveInDate) return 'Not Set'
    try {
      const moveIn = new Date(moveInDate)
      const today = new Date()
      const dueDay = moveIn.getDate()

      // Start from current month
      let nextYear = today.getFullYear()
      let nextMonth = today.getMonth()

      // Handle months with fewer days
      const lastDayOfMonth = new Date(nextYear, nextMonth + 1, 0).getDate()
      const adjustedDueDay = Math.min(dueDay, lastDayOfMonth)
      let dueDate = new Date(nextYear, nextMonth, adjustedDueDay)

      // If we've already passed this month's due date, move to next month
      if (today > dueDate) {
        nextMonth++
        if (nextMonth > 11) {
          nextMonth = 0
          nextYear++
        }
        const lastDayOfNextMonth = new Date(nextYear, nextMonth + 1, 0).getDate()
        const adjustedNextDueDay = Math.min(dueDay, lastDayOfNextMonth)
        dueDate = new Date(nextYear, nextMonth, adjustedNextDueDay)
      }

      return dueDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    } catch (e) {
      return 'Not Set'
    }
  }

  // Render for Occupied rooms
  if (isOccupied) {
    // Calculate base payment from total payment by subtracting appliance surcharges
    const applianceSurchargeTotal = (box.appliances || []).reduce((sum, a) => {
      return sum + (Number(a.surcharge_amount || a.surcharge || 0))
    }, 0)
    const basePayment = (box.payment || 0) - applianceSurchargeTotal

    return (
      <>
        {showEditModal && (
          <EditTenant
            tenant={{
              ...box.tenant,
              payment: basePayment,  // Pass base payment (total - surcharges)
              monthly_rent: basePayment,
              payment_day: box.preferred_payment_day || box.tenant?.payment_day,  // Use box's preferred_payment_day
              preferred_payment_day: box.preferred_payment_day || box.tenant?.preferred_payment_day,
              other_occupants: box.tenant?.other_occupants || []  // Pass other occupants
            }}
            appliances={box.appliances || []}
            propertyId={box.propertyId}
            roomNumber={box.number}
            roomSection={box.section}
            roomType={box.type}
            onClose={() => setShowEditModal(false)}
            onSuccess={handleEditSuccess}
          />
        )}
        {showTransferModal && (
          <TransferTenant
            tenant={box.tenant}
            currentRoom={typeof formatRoomDisplay === 'function' ? formatRoomDisplay(box) : box.number}
            currentFloor={box.floor || 1}
            propertyId={box.propertyId}
            allBoxes={allBoxes}
            onClose={() => setShowTransferModal(false)}
            onSuccess={handleTransferSuccess}
            formatRoomDisplay={formatRoomDisplay}
          />
        )}
        {showPaymentModal && (
          <PaymentConfirmation
            tenant={box.tenant}
            roomNumber={typeof formatRoomDisplay === 'function' ? formatRoomDisplay(box) : box.number}
            propertyId={box.propertyId}
            defaultAmount={monthlyRentStatus?.status === 'partial' ? monthlyRentStatus.remainingBalance : box.payment}
            onClose={() => setShowPaymentModal(false)}
            onSuccess={handlePaymentSuccess}
            batchRooms={(() => {
              if (!box.tenant || !allBoxes || !Array.isArray(allBoxes)) return undefined
              const tid = box.tenant.tenant_id ?? box.tenant.id
              const sameTenant = allBoxes.filter(b => b.tenant && (String(b.tenant.tenant_id) === String(tid) || String(b.tenant.id) === String(tid)))
              if (sameTenant.length <= 1) return undefined
              const propId = box.propertyId ?? box.property_id
              return sameTenant.map(b => ({
                propertyId: b.propertyId ?? b.property_id ?? propId,
                roomNumber: typeof formatRoomDisplay === 'function' ? formatRoomDisplay(b) : (b.room_number ?? b.number),
                defaultAmount: b.payment
              }))
            })()}
          />
        )}
        {showBalancePaymentModal && showBalancePayment && (
          <PaymentConfirmation
            tenant={box.tenant}
            roomNumber={typeof formatRoomDisplay === 'function' ? formatRoomDisplay(box) : box.number}
            propertyId={box.propertyId ?? box.property_id}
            defaultAmount={balancePaymentRemaining ?? 0}
            isBalancePayment={true}
            onClose={() => setShowBalancePaymentModal(false)}
            onSuccess={() => {
              if (typeof onPaymentSuccess === 'function') onPaymentSuccess()
            }}
          />
        )}
        {paymentForMonth && (
          <PaymentConfirmation
            tenant={box.tenant}
            roomNumber={typeof formatRoomDisplay === 'function' ? formatRoomDisplay(box) : box.number}
            propertyId={box.propertyId ?? box.property_id}
            defaultAmount={paymentForMonth.remainingBalance}
            defaultMarkAsLate={paymentForMonth.isLate}
            isBalancePayment={paymentForMonth.status === 'partial'}
            forMonth={paymentForMonth.forMonth}
            forMonthLabel={paymentForMonth.label}
            onClose={() => setPaymentForMonth(null)}
            onSuccess={() => {
              if (typeof onPaymentSuccess === 'function') onPaymentSuccess()
            }}
          />
        )}
        <aside ref={asideRef} className="fixed top-0 right-0 bottom-0 w-full md:w-96 z-[70] bg-white/95 dark:bg-[#0f172a]/95 backdrop-blur-3xl border-l border-gray-200 dark:border-gray-800 shadow-2xl animate-slide-in-right overflow-hidden text-gray-600 dark:text-gray-300 flex flex-col">
          {/* Fixed Header */}
          <div className="flex-shrink-0 bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 dark:from-blue-800 dark:via-blue-900 dark:to-indigo-950 p-6 shadow-lg relative overflow-hidden">
            {/* Decorative background element */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>

            {/* Close button and Room badge */}
            <div className="flex items-center justify-between mb-4 relative z-10">
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 bg-white/20 backdrop-blur-md text-white text-[10px] font-bold uppercase tracking-widest rounded-full border border-white/20">
                  Room {(() => {
                    const type = box.type || 'room'
                    const number = box.number || ''
                    const section = box.section || ''
                    if (type === 'commercial') return `C${number}`
                    if (section) return `${section.charAt(0).toUpperCase()}${number}`
                    return number
                  })()}
                </span>
                <span className="px-3 py-1 bg-green-500 text-white text-[10px] font-bold uppercase tracking-widest rounded-full shadow-lg">
                  Occupied
                </span>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition-all duration-300 hover:rotate-90 active:scale-90 bg-white/10">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Tenant/Business Name */}
            {box.tenant && (
              <div
                className="group inline-flex items-center gap-2 cursor-pointer"
                onClick={() => {
                  const tenantId = box.tenant.tenant_id || box.tenant.id
                  if (tenantId && typeof onViewTenantProfile === 'function') {
                    onViewTenantProfile(tenantId)
                  }
                }}
              >
                <div>
                  <div className="text-2xl font-black text-white group-hover:text-blue-100 transition-colors tracking-tight">
                    {(box.type === 'commercial' && box.tenant.business_name)
                      ? box.tenant.business_name
                      : box.tenant.full_name}
                  </div>
                  {box.type === 'commercial' && box.tenant.business_name && box.tenant.full_name && (
                    <div className="text-sm font-medium text-blue-100/70 mt-0.5">
                      Contact: {box.tenant.full_name}
                    </div>
                  )}
                </div>
                <div className="p-1 px-2 bg-white/10 rounded-lg opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0">
                  <span className="text-[10px] text-white font-bold uppercase tracking-tighter">View Profile</span>
                </div>
              </div>
            )}

            {/* Contact Info */}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-blue-100/80 font-medium">
              {box.tenant?.phone && (
                <div
                  onClick={() => handleCopy(box.tenant.phone, 'phone')}
                  className="flex items-center gap-1.5 px-2 py-1 bg-white/5 hover:bg-white/10 rounded-lg border border-white/5 cursor-pointer transition-all active:scale-[0.98] group/copy"
                >
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {copiedItem === 'phone' ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    )}
                  </svg>
                  <span className={copiedItem === 'phone' ? 'text-green-300' : ''}>
                    {copiedItem === 'phone' ? 'Copied!' : box.tenant.phone}
                  </span>
                  <svg className="w-3.5 h-3.5 text-white/40 group-hover/copy:text-white/80 transition-colors ml-1 overflow-visible" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
              )}
              {box.tenant?.email && (
                <div
                  onClick={() => handleCopy(box.tenant.email, 'email')}
                  className="flex items-center gap-1.5 px-2 py-1 bg-white/5 hover:bg-white/10 rounded-lg border border-white/5 max-w-[200px] cursor-pointer transition-all active:scale-[0.98] group/copy"
                >
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {copiedItem === 'email' ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    )}
                  </svg>
                  <span className={`truncate ${copiedItem === 'email' ? 'text-green-300' : ''}`}>
                    {copiedItem === 'email' ? 'Copied!' : box.tenant.email}
                  </span>
                  <svg className="w-3.5 h-3.5 text-white/40 group-hover/copy:text-white/80 transition-colors ml-1 flex-shrink-0 overflow-visible" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
              )}
            </div>

            {/* Monthly Payment */}
            <div className="mt-5 flex items-end justify-between">
              <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-200/60 leading-none mb-1">Monthly Billing</span>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-white tracking-tighter">₱{(typeof box.payment === 'number' ? box.payment.toLocaleString() : box.payment)}</span>
                  <span className="text-blue-200 text-xs font-bold">/mo</span>
                </div>
              </div>
              {box.appliances && box.appliances.length > 0 && (
                <div className="px-2 py-1 bg-white/10 rounded-lg text-[10px] font-bold text-blue-100 border border-white/10 mb-1">
                  incl. ₱{box.appliances.reduce((sum, a) => sum + (Number(a.surcharge_amount ?? a.surcharge) || 0), 0).toLocaleString()} Surcharge
                </div>
              )}
            </div>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto scrollbar-hide p-4">
            {/* Rent Status Card - Always visible at top */}

            {/* Monthly rent status: paid / partial (remaining) / due_today / due_soon / past_due / not_due_yet */}
            {monthlyRentStatus && (
              <div className={`rounded-2xl p-5 mb-6 border shadow-sm transition-all duration-500 overflow-hidden relative group/status ${(monthlyRentStatus.status === 'paid' || displayAsPaid) ? 'bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-800' :
                monthlyRentStatus.status === 'not_due_yet' ? 'bg-blue-50/50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900/50' :
                  monthlyRentStatus.status === 'due_soon' ? 'bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800' :
                    monthlyRentStatus.status === 'due_today' ? 'bg-orange-50/50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800' :
                      monthlyRentStatus.status === 'past_due' ? 'bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-800' :
                        monthlyRentStatus.status === 'partial' ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800' :
                          'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
                }`}>
                {/* Decorative background circle */}
                <div className={`absolute -right-4 -top-4 w-20 h-20 rounded-full opacity-10 blur-xl ${(monthlyRentStatus.status === 'paid' || displayAsPaid) ? 'bg-green-500' :
                  (monthlyRentStatus.status === 'past_due') ? 'bg-red-500' : 'bg-blue-500'
                  }`}></div>

                <div className="flex items-center justify-between mb-3 relative z-10">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg ${(monthlyRentStatus.status === 'paid' || displayAsPaid) ? 'bg-green-500 text-white' :
                      monthlyRentStatus.status === 'past_due' ? 'bg-red-500 text-white' :
                        'bg-blue-500 text-white'
                      }`}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">Rent Status</span>
                  </div>
                  {(monthlyRentStatus.status === 'past_due' || monthlyRentStatus.status === 'due_today') && (
                    <span className="animate-pulse flex h-2 w-2 rounded-full bg-red-500"></span>
                  )}
                </div>

                <div className={`text-2xl font-black tracking-tight relative z-10 ${(monthlyRentStatus.status === 'paid' || displayAsPaid) ? 'text-green-700 dark:text-green-400' :
                  monthlyRentStatus.status === 'not_due_yet' ? 'text-blue-700 dark:text-blue-400' :
                    monthlyRentStatus.status === 'due_soon' ? 'text-blue-700 dark:text-blue-400' :
                      monthlyRentStatus.status === 'due_today' ? 'text-orange-700 dark:text-orange-400' :
                        monthlyRentStatus.status === 'past_due' ? 'text-red-700 dark:text-red-400' :
                          monthlyRentStatus.status === 'partial' ? 'text-amber-700 dark:text-amber-400' :
                            'text-gray-700 dark:text-gray-300'
                  }`}>
                  {(monthlyRentStatus.status === 'paid' || displayAsPaid) ? 'Fully Paid' : monthlyRentStatus.label}
                </div>

                {(monthlyRentStatus.status === 'not_due_yet' || monthlyRentStatus.status === 'due_today' || monthlyRentStatus.status === 'past_due') && monthlyRentStatus.message && (
                  <div className={`text-xs font-bold mt-1 px-2 py-0.5 rounded-full inline-block relative z-10 ${monthlyRentStatus.status === 'not_due_yet' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
                    monthlyRentStatus.status === 'due_today' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' :
                      monthlyRentStatus.status === 'past_due' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                        'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                    }`}>{monthlyRentStatus.message}</div>
                )}

                {/* Balance Details */}
                {showBalancePayment && (
                  <div className="mt-4 p-3 bg-white/40 dark:bg-gray-900/40 rounded-xl border border-white/50 dark:border-gray-800 relative z-10">
                    <div className="flex justify-between text-xs mb-2">
                      <span className="text-gray-500">Already Paid</span>
                      <span className="font-bold text-gray-900 dark:text-white">₱{(balancePaymentPaidSoFar ?? 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-800">
                      <span className="text-sm font-bold text-gray-800 dark:text-gray-200">Balance Due</span>
                      <span className="text-base font-black text-amber-600 dark:text-amber-400">₱{(balancePaymentRemaining ?? 0).toLocaleString()}</span>
                    </div>

                    {!isArchived && (
                      <button
                        type="button"
                        onClick={handleOpenBalancePayment}
                        className="mt-4 w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 shadow-lg shadow-amber-600/20 active:scale-[0.98]"
                      >
                        Pay Remaining Balance
                      </button>
                    )}
                  </div>
                )}

                {/* Confirm Payment: per-month buttons when multiple unpaid months */}
                {!isArchived && !showBalancePayment && unpaidMonths.length > 1 && (
                  <div className="mt-4 space-y-2">
                    <div className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {unpaidMonths.length} months with balance
                    </div>
                    {unpaidMonths.map(m => (
                      <button
                        key={m.forMonth}
                        type="button"
                        onClick={() => setPaymentForMonth(m)}
                        className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all duration-200 flex items-center justify-between px-4 active:scale-[0.98] ${
                          m.isLate
                            ? 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40'
                            : m.isDueToday
                              ? 'bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/40'
                              : m.status === 'partial'
                                ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40'
                                : 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{m.shortLabel}</span>
                          {m.isLate && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200">
                              {m.daysOverdue}d late
                            </span>
                          )}
                          {m.isDueToday && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-orange-200 dark:bg-orange-800 text-orange-800 dark:text-orange-200">
                              Due Today
                            </span>
                          )}
                          {!m.isLate && !m.isDueToday && m.status === 'unpaid' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200">
                              Unpaid
                            </span>
                          )}
                          {m.status === 'partial' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200">
                              Partial
                            </span>
                          )}
                        </div>
                        <span className="font-black">
                          {m.status === 'partial'
                            ? `Bal ₱${m.remainingBalance.toLocaleString()}`
                            : `₱${m.monthlyRent.toLocaleString()}`
                          }
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Confirm Payment: single button when only 1 or 0 unpaid months */}
                {!isArchived && !showBalancePayment && unpaidMonths.length <= 1 && (monthlyRentStatus.status === 'due_today' || monthlyRentStatus.status === 'past_due' || monthlyRentStatus.status === 'due_soon' || monthlyRentStatus.status === 'due') && (
                  <button
                    type="button"
                    onClick={() => {
                      if (unpaidMonths.length === 1) {
                        setPaymentForMonth(unpaidMonths[0])
                      } else if (typeof onOpenPaymentModal === 'function') {
                        onOpenPaymentModal({ box, allBoxes, formatRoomDisplay })
                        if (typeof onClose === 'function') onClose()
                      } else {
                        setShowPaymentModal(true)
                      }
                    }}
                    className={`mt-4 w-full py-3 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 shadow-lg flex items-center justify-center gap-2 active:scale-[0.98] ${monthlyRentStatus.status === 'past_due'
                      ? 'bg-red-600 hover:bg-red-700 shadow-red-600/20'
                      : monthlyRentStatus.status === 'due_today'
                        ? 'bg-orange-600 hover:bg-orange-700 shadow-orange-600/20'
                        : 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/20'
                      }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    Confirm Payment — ₱{(box.payment || 0).toLocaleString()}
                  </button>
                )}
                {/* Overdue Reminder: only when past due */}
                {!isArchived && monthlyRentStatus.status === 'past_due' && (
                  <button
                    type="button"
                    onClick={() => setShowOverdueReminderModal(true)}
                    className="mt-2 w-full py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 shadow-lg flex items-center justify-center gap-2 active:scale-[0.98]"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    </svg>
                    Send Overdue Reminder — {monthlyRentStatus.daysOverdue}d · ₱{(monthlyRentStatus.daysOverdue * 50).toLocaleString()} late fee
                  </button>
                )}
              </div>
            )}

            {/* Balance Payment only: when we have remaining from a partial tx but monthly status block wasn't shown */}
            {!monthlyRentStatus && showBalancePayment && (
              <div className="rounded p-4 mb-4 border bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Monthly Rent</div>
                <div className="text-lg font-bold text-amber-700 dark:text-amber-300">Partial — balance due</div>
                <div className="mt-2 text-sm text-amber-800 dark:text-amber-200">
                  <span>Paid: ₱{(balancePaymentPaidSoFar ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                  <span className="mx-1">·</span>
                  <span className="font-semibold">Remaining: ₱{(balancePaymentRemaining ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                </div>
                {!isArchived && (
                  <button
                    type="button"
                    onClick={handleOpenBalancePayment}
                    className="mt-3 w-full py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Balance Payment — Pay remaining ₱{(balancePaymentRemaining ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </button>
                )}
              </div>
            )}

            {/* Appliances - Collapsible with inline content */}
            {box.tenant && (
              <CollapsibleSection
                title="Appliances"
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>}
                badge={box.appliances?.length > 0 ? `${box.appliances.length}` : null}
                badgeColor="blue"
                defaultOpen={false}
              >
                <div className="space-y-3 pb-2">
                  {(!box.appliances || box.appliances.length === 0) && (
                    <div className="p-4 bg-gray-50/50 dark:bg-gray-800/30 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 text-center">
                      <p className="text-xs font-medium text-gray-400">No appliances registered.</p>
                    </div>
                  )}
                  {(box.appliances || []).map((a, idx) => (
                    <div key={a.appliance_id || a.id || idx} className="group/item flex items-center justify-between p-3 bg-white dark:bg-gray-800/40 rounded-2xl border border-gray-100 dark:border-gray-700 transition-all duration-300 hover:shadow-md hover:border-blue-100 dark:hover:border-blue-900/50">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center flex-shrink-0 group-hover/item:scale-110 transition-transform">
                          <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                          </svg>
                        </div>
                        <div>
                          <div className="font-bold text-sm text-gray-900 dark:text-white leading-tight">{a.name}</div>
                          <div className="text-[10px] font-black uppercase tracking-tighter text-blue-500 mt-0.5">+₱{Number(a.surcharge_amount || a.surcharge || 0).toLocaleString()}/mo</div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {box.appliances && box.appliances.length > 0 && (
                    <div className="mt-2 p-3 bg-blue-50/30 dark:bg-blue-900/10 rounded-xl border border-blue-100/50 dark:border-blue-900/30">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-gray-500 uppercase tracking-widest">Total Surcharge</span>
                        <span className="font-black text-blue-600 dark:text-blue-400">
                          +₱{box.appliances.reduce((sum, a) => sum + (Number(a.surcharge_amount || a.surcharge || 0)), 0).toLocaleString()}/mo
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </CollapsibleSection>
            )}

            {/* Other Occupants - Collapsible with inline content */}
            {box.tenant && (
              <CollapsibleSection
                title="Other Occupants"
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>}
                badge={box.tenant?.other_occupants?.length > 0 ? `${box.tenant.other_occupants.length}` : null}
                badgeColor="gray"
                defaultOpen={false}
              >
                <div className="space-y-3 pb-2">
                  {(!box.tenant?.other_occupants || box.tenant.other_occupants.length === 0) && (
                    <div className="p-4 bg-gray-50/50 dark:bg-gray-800/30 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 text-center">
                      <p className="text-xs font-medium text-gray-400">No other occupants registered.</p>
                    </div>
                  )}
                  {(box.tenant?.other_occupants || []).map((occupant, idx) => (
                    <div key={idx} className="group/item flex items-center gap-3 p-3 bg-white dark:bg-gray-800/40 rounded-2xl border border-gray-100 dark:border-gray-700 transition-all duration-300 hover:shadow-md">
                      <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/40 flex items-center justify-center flex-shrink-0 group-hover/item:scale-110 transition-transform">
                        <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <div className="font-bold text-sm text-gray-900 dark:text-white leading-tight">{occupant.full_name || 'N/A'}</div>
                        <div className="text-[10px] font-black uppercase tracking-tighter text-gray-400 dark:text-gray-500 mt-0.5">{occupant.relationship || 'Occupant'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* Advance & Deposit Status - Collapsible */}
            {box.tenant && (
              <CollapsibleSection
                title="Initial Payments"
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                badge={box.tenant.advance_paid && box.tenant.deposit_paid ? 'Complete' : 'Pending'}
                badgeColor={box.tenant.advance_paid && box.tenant.deposit_paid ? 'green' : 'red'}
                defaultOpen={!box.tenant.advance_paid || !box.tenant.deposit_paid}
              >
                <div className="grid grid-cols-2 gap-3 pb-2">
                  <div className={`p-4 rounded-2xl border transition-all duration-300 ${box.tenant.advance_paid
                    ? 'bg-green-50/40 border-green-200/50 dark:bg-green-950/10 dark:border-green-800/30'
                    : 'bg-red-50/40 border-red-200/50 dark:bg-red-950/10 dark:border-red-800/30'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className={`p-1.5 rounded-lg ${box.tenant.advance_paid ? 'bg-green-500/20 text-green-600' : 'bg-red-500/20 text-red-600'}`}>
                        {box.tenant.advance_paid ? (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                      </div>
                      <span className={`text-[9px] font-black uppercase tracking-widest ${box.tenant.advance_paid ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                        Advance
                      </span>
                    </div>
                    <div className={`text-base font-black tracking-tight ${box.tenant.advance_paid ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'}`}>
                      {box.tenant.advance_paid ? `₱${(box.tenant.advance_amount || box.payment || 0).toLocaleString()}` : 'Not Paid'}
                    </div>
                  </div>

                  <div className={`p-4 rounded-2xl border transition-all duration-300 ${box.tenant.deposit_paid
                    ? 'bg-green-50/40 border-green-200/50 dark:bg-green-950/10 dark:border-green-800/30'
                    : 'bg-red-50/40 border-red-200/50 dark:bg-red-950/10 dark:border-red-800/30'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className={`p-1.5 rounded-lg ${box.tenant.deposit_paid ? 'bg-green-500/20 text-green-600' : 'bg-red-500/20 text-red-600'}`}>
                        {box.tenant.deposit_paid ? (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                      </div>
                      <span className={`text-[9px] font-black uppercase tracking-widest ${box.tenant.deposit_paid ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                        Deposit
                      </span>
                    </div>
                    <div className={`text-base font-black tracking-tight ${box.tenant.deposit_paid ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'}`}>
                      {box.tenant.deposit_paid ? `₱${(box.tenant.deposit_amount || box.payment || 0).toLocaleString()}` : 'Not Paid'}
                    </div>
                  </div>
                </div>
                {(!box.tenant.advance_paid || !box.tenant.deposit_paid) && (
                  <div className="mt-2 text-[10px] font-bold text-red-600 dark:text-red-400 bg-red-100/50 dark:bg-red-900/20 p-2 rounded-xl text-center border border-red-200/50 dark:border-red-800/30 animate-pulse">
                    Tenant has incomplete initial payment
                  </div>
                )}
              </CollapsibleSection>
            )}

            {/* Receivables/Reimbursements */}
            {box.tenant?.receivables?.length > 0 && (
              <div className="mb-6 p-5 bg-amber-50/50 dark:bg-amber-950/20 rounded-2xl border border-amber-200 dark:border-amber-800 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 w-16 h-16 bg-amber-500/10 rounded-full -mr-8 -mt-8 blur-xl"></div>
                <div className="flex items-center gap-2 mb-4 relative z-10">
                  <div className="p-1.5 bg-amber-500 text-white rounded-lg">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400">Reimbursements</span>
                </div>

                <div className="space-y-3 relative z-10">
                  {box.tenant.receivables.map((r) => {
                    const amt = parseFloat(r.amount) || 0
                    const received = r.received === true
                    const dateStr = r.date ? new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
                    return (
                      <div key={r.id} className={`group/receivable rounded-xl p-3 transition-all duration-300 ${received ? 'bg-white/40 dark:bg-gray-800/20' : 'bg-white dark:bg-gray-800/60 shadow-sm border border-amber-100 dark:border-amber-900/50 hover:border-amber-300'}`}>
                        <div className="flex justify-between items-start gap-3">
                          <div className="flex-1">
                            <div className="font-bold text-sm text-gray-800 dark:text-gray-200 leading-tight">{r.reason || 'Reimbursement'}</div>
                            <div className="text-[10px] font-bold text-gray-400 mt-1">{dateStr}</div>
                            {received && r.received_at && (
                              <div className="text-[10px] font-black uppercase text-green-600 dark:text-green-500 mt-1 flex items-center gap-1">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                Received {new Date(r.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </div>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-black text-gray-900 dark:text-white">₱{amt.toLocaleString()}</div>
                            {!received && !isArchived && (
                              <button
                                type="button"
                                onClick={() => handleMarkReceivableReceived(r.id)}
                                className="mt-2 text-[9px] font-black uppercase tracking-widest px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-all duration-300 shadow-md shadow-green-600/20 active:scale-95"
                              >
                                Mark Paid
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-4 pt-3 border-t border-amber-200 dark:border-amber-800/50 flex justify-between items-center relative z-10">
                  <span className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-500">Outstanding Total</span>
                  <span className="text-sm font-black text-amber-800 dark:text-amber-300">
                    ₱{(box.tenant.receivables.filter(r => r.received !== true).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)).toLocaleString()}
                  </span>
                </div>
              </div>
            )}

            {/* Next Payment and Preferred Day */}
            <div className="bg-white dark:bg-gray-800/40 rounded-2xl p-5 mb-6 border border-gray-100 dark:border-gray-800 shadow-sm group/payment">
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-1.5 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 rounded-lg">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Next Payment Due</span>
                  </div>
                  <div className="text-xl font-black text-gray-900 dark:text-white tracking-tight">
                    {getNextPaymentDate()}
                  </div>
                  <div className="text-[10px] font-Italic text-gray-400 mt-1 uppercase tracking-tighter">Initial Period ends 30 days from move-in</div>
                </div>

                {box.preferred_payment_day && (
                  <div className="flex flex-col items-end shrink-0">
                    <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2">Preferred Day</div>
                    <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900 p-2 pl-3 rounded-xl border border-gray-200 dark:border-gray-700">
                      <span className="text-lg font-black text-blue-600 dark:text-blue-400">
                        {box.preferred_payment_day}
                      </span>
                      <span className="text-[10px] font-bold text-gray-500 uppercase leading-none">
                        {box.preferred_payment_day === 1 || box.preferred_payment_day === 21 || box.preferred_payment_day === 31 ? 'st' :
                          box.preferred_payment_day === 2 || box.preferred_payment_day === 22 ? 'nd' :
                            box.preferred_payment_day === 3 || box.preferred_payment_day === 23 ? 'rd' : 'th'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Transaction History List */}
            {displayTransactions.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4 px-1">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded-lg">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Transaction History</span>
                  </div>
                  {(box.transactions || []).length > 5 && (
                    <span className="text-[10px] font-bold text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                      Last 5 payments
                    </span>
                  )}
                </div>

                <div className="space-y-3">
                  {displayTransactions.map((tx, i) => (
                    <TransactionItem
                      key={i}
                      tx={tx}
                      onViewTenantProfile={onViewTenantProfile}
                      onClose={onClose}
                      isReceivable={tx.payment_type === 'receivable'}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Quick Actions Grid */}
            {!isArchived && <div className="mb-6">
              <div className="flex items-center gap-2 mb-4 px-1">
                <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800"></span>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 dark:text-gray-500">Quick Actions</span>
                <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800"></span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    if (typeof onOpenPaymentModal === 'function') {
                      onOpenPaymentModal({ box, allBoxes, formatRoomDisplay })
                      if (typeof onClose === 'function') onClose()
                    } else {
                      setShowPaymentModal(true)
                    }
                  }}
                  className="flex flex-col items-center justify-center p-4 bg-green-50/50 dark:bg-green-900/10 hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600 dark:text-green-400 rounded-2xl border border-green-100 dark:border-green-800 transition-all duration-300 group/btn"
                >
                  <div className="p-2 bg-green-100/50 dark:bg-green-900/50 rounded-xl mb-2 transition-colors">
                    <svg className="w-5 h-5 font-bold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-wider">Record Payment</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowReminderModal(true)}
                  className="flex flex-col items-center justify-center p-4 bg-blue-50/50 dark:bg-blue-900/10 hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-2xl border border-blue-100 dark:border-blue-800 transition-all duration-300 group/btn"
                >
                  <div className="p-2 bg-blue-100/50 dark:bg-blue-900/50 rounded-xl mb-2 transition-colors">
                    <svg className="w-5 h-5 font-bold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-wider">Send Reminder</span>
                </button>
                <button
                  onClick={() => {
                    if (typeof onOpenTransferModal === 'function') {
                      onOpenTransferModal({ box })
                      if (typeof onClose === 'function') onClose()
                    } else {
                      setShowTransferModal(true)
                    }
                  }}
                  className="flex flex-col items-center justify-center p-4 bg-purple-50/50 dark:bg-purple-900/10 hover:bg-purple-100 dark:hover:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-2xl border border-purple-100 dark:border-purple-800 transition-all duration-300 group/btn"
                >
                  <div className="p-2 bg-purple-100/50 dark:bg-purple-900/50 rounded-xl mb-2 transition-colors">
                    <svg className="w-5 h-5 font-bold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-wider">Transfer</span>
                </button>
                <button
                  onClick={handleMaintenanceMode}
                  className="flex flex-col items-center justify-center p-4 bg-yellow-50/50 dark:bg-yellow-900/10 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 rounded-2xl border border-yellow-100 dark:border-yellow-800 transition-all duration-300 group/btn"
                >
                  <div className="p-2 bg-yellow-100/50 dark:bg-yellow-900/50 rounded-xl mb-2 transition-colors">
                    <svg className="w-5 h-5 font-bold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    </svg>
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-wider">Maintenance</span>
                </button>
              </div>
            </div>}
          </div>

          {/* Fixed Bottom Actions */}
          {!isArchived && (
            <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50 backdrop-blur-md p-6">
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    if (typeof onOpenEditModal === 'function') {
                      onOpenEditModal({ box })
                      if (typeof onClose === 'function') onClose()
                    } else {
                      setShowEditModal(true)
                    }
                  }}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl border border-gray-300 dark:border-gray-700 text-xs font-black uppercase tracking-widest transition-all duration-300 shadow-sm active:scale-[0.98]"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit Profile
                </button>
                <button
                  onClick={() => setShowRemoveModal(true)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 shadow-lg shadow-red-600/20 active:scale-[0.98]"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Remove
                </button>
              </div>
            </div>
          )}
        </aside>

        {/* Remove Tenant Modal */}
        {showRemoveModal && (
          <RemoveTenantModal
            tenant={box.tenant}
            roomNumber={typeof formatRoomDisplay === 'function' ? formatRoomDisplay(box) : box.number}
            propertyId={box.propertyId}
            onClose={() => setShowRemoveModal(false)}
            onSuccess={() => {
              // Trigger layout refresh (same as payment success) to update the map
              if (typeof onPaymentSuccess === 'function') onPaymentSuccess()
              if (typeof onClose === 'function') onClose()
            }}
          />
        )}
        {/* Send reminder modal - same API as Message tab */}
        <SendReminderModal
          open={showReminderModal}
          onClose={() => setShowReminderModal(false)}
          tenantId={box.tenant?.tenant_id ?? box.tenant?.id}
          tenantName={box.tenant?.full_name}
          tenantEmail={box.tenant?.email || ''}
          monthlyRent={box.payment}
          dueDate={getNextPaymentDate()}
        />
        {/* Overdue reminder modal - pre-filled with overdue message */}
        <SendReminderModal
          open={showOverdueReminderModal}
          onClose={() => setShowOverdueReminderModal(false)}
          tenantId={box.tenant?.tenant_id ?? box.tenant?.id}
          tenantName={box.tenant?.full_name}
          tenantEmail={box.tenant?.email || ''}
          monthlyRent={box.payment}
          dueDate={getNextPaymentDate()}
          overdueMessage={`Good day ${box.tenant?.full_name || 'Tenant'}! This is an overdue payment notice. Your monthly rent of ₱${typeof box.payment === 'number' ? box.payment.toLocaleString('en-PH', { minimumFractionDigits: 2 }) : (box.payment ?? '0')} is ${monthlyRentStatus?.daysOverdue ?? 0} day${(monthlyRentStatus?.daysOverdue ?? 0) !== 1 ? 's' : ''} overdue. A late fee of ₱50/day has been accumulating, totaling ₱${((monthlyRentStatus?.daysOverdue ?? 0) * 50).toLocaleString()} so far. Please settle your balance immediately to avoid further penalties. Thank you!`}
        />
      </>
    )
  }

  // Render for Under Maintenance rooms
  if (isMaintenance) {
    return (
      <>
        <div
          className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-[60] md:hidden animate-fade-in"
          onClick={onClose}
        />
        <aside
          ref={asideRef}
          className="fixed top-0 right-0 bottom-0 w-full md:w-[400px] z-[70] bg-white/95 dark:bg-[#0f172a]/95 backdrop-blur-3xl border-l border-gray-200 dark:border-gray-800/50 shadow-[-20px_0_50px_rgba(0,0,0,0.1)] flex flex-col animate-slide-in-right"
        >
          {/* Maintenance Header */}
          <div className="relative overflow-hidden bg-gradient-to-br from-yellow-500 via-yellow-600 to-amber-700 p-6 pt-10 shrink-0">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>
            <div className="absolute bottom-0 left-0 w-24 h-24 bg-black/10 rounded-full -ml-12 -mb-12 blur-2xl"></div>

            <div className="flex justify-between items-start relative z-10 mb-6">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-[10px] font-black uppercase tracking-widest text-white border border-white/20">
                    Room {typeof formatRoomDisplay === 'function' ? formatRoomDisplay(box) : box.number}
                  </span>
                  <span className="px-3 py-1 bg-amber-500 text-white rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg">
                    Maintenance
                  </span>
                </div>
                <h2 className="text-2xl font-black text-white tracking-tight mt-2 flex items-center gap-2">
                  Under Care
                </h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-xl text-white transition-all border border-white/10"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-grow overflow-y-auto p-6 custom-scrollbar space-y-8">
            <div className="text-center py-10 space-y-4">
              <div className="w-20 h-20 bg-yellow-100 dark:bg-yellow-900/30 rounded-3xl flex items-center justify-center mx-auto shadow-xl shadow-yellow-500/10">
                <svg className="w-10 h-10 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900 dark:text-white uppercase tracking-tight">Maintenance Mode</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 max-w-[200px] mx-auto">
                  This room is currently being serviced and cannot be occupied.
                </p>
              </div>
            </div>

            {/* Previous Tenant if any */}
            {box.previousTenant && (
              <CollapsibleSection
                title="Previous Tenant"
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>}
                defaultOpen={false}
              >
                <div className="p-4 bg-gray-50 dark:bg-gray-800/40 rounded-2xl border border-gray-100 dark:border-gray-800">
                  <div className="font-bold text-sm text-gray-900 dark:text-white mb-2">{box.previousTenant.full_name || box.previousTenant.name}</div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                      {box.previousTenant.phone}
                    </div>
                  </div>
                </div>
              </CollapsibleSection>
            )}
          </div>

          <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50 backdrop-blur-md p-6">
            <button
              onClick={handleMarkUnoccupied}
              className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-black uppercase tracking-[0.2em] transition-all shadow-xl shadow-emerald-600/20 active:scale-[0.98]"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Release Room
            </button>
          </div>
        </aside>
      </>
    )
  }

  // Render for Unoccupied/Available rooms
  if (isUnoccupied) {
    return (
      <>
        {/* Backdrop for mobile */}
        <div
          className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-[60] md:hidden animate-fade-in"
          onClick={onClose}
        />

        <aside
          ref={asideRef}
          className="fixed top-0 right-0 bottom-0 w-full md:w-[400px] z-[70] bg-white/95 dark:bg-[#0f172a]/95 backdrop-blur-3xl border-l border-gray-200 dark:border-gray-800/50 shadow-[-20px_0_50px_rgba(0,0,0,0.1)] flex flex-col animate-slide-in-right"
        >
          {/* Available Header */}
          <div className="relative overflow-hidden bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 p-6 pt-10 shrink-0">
            {/* Decorative Elements */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>
            <div className="absolute bottom-0 left-0 w-24 h-24 bg-black/10 rounded-full -ml-12 -mb-12 blur-2xl"></div>

            <div className="flex justify-between items-start relative z-10 mb-6">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-[10px] font-black uppercase tracking-widest text-white border border-white/20 shadow-lg">
                    Room {typeof formatRoomDisplay === 'function' ? formatRoomDisplay(box) : box.number}
                  </span>
                  <span className="px-3 py-1 bg-emerald-500 text-white rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg">
                    Available
                  </span>
                </div>
                <h2 className="text-2xl font-black text-white tracking-tight mt-2 flex items-center gap-2">
                  Ready for Move-in
                </h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-xl text-white transition-all duration-300 border border-white/10 shadow-lg"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-grow overflow-y-auto p-6 custom-scrollbar space-y-8">
            <div className="text-center py-10 space-y-4">
              <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 rounded-3xl flex items-center justify-center mx-auto shadow-xl shadow-emerald-500/10">
                <svg className="w-10 h-10 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900 dark:text-white uppercase tracking-tight">Vacant</h3>

              </div>
            </div>

            <div className="p-5 bg-gray-50 dark:bg-gray-800/40 rounded-2xl border border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-white dark:bg-gray-800 rounded-xl shadow-sm">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Quick Info</span>
              </div>
              <p className="text-xs font-medium text-gray-600 dark:text-gray-300 leading-relaxed">
                Standard rent: <span className="text-gray-900 dark:text-white font-black">₱{Number(box.payment || 0).toLocaleString()}</span>
                <br />
                Registration requires valid ID and advance payment.
              </p>
            </div>

            {/* Previous Tenant if any */}
            {box.previousTenant && (
              <CollapsibleSection
                title="Previous Records"
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                defaultOpen={false}
              >
                <div className="p-4 bg-white dark:bg-gray-800/20 rounded-2xl border border-gray-100 dark:border-gray-800 hover:border-blue-200 dark:hover:border-blue-900/50 transition-all">
                  <div className="font-bold text-sm text-gray-900 dark:text-white mb-1">
                    {box.previousTenant.full_name || box.previousTenant.name}
                  </div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">
                    Last Occupant
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Transaction History for Room */}
            {box.transactions && box.transactions.length > 0 && (
              <div className="mt-8">
                <div className="flex items-center gap-2 mb-4 px-1">
                  <div className="p-1.5 bg-gray-100 dark:bg-gray-800 text-gray-500 rounded-lg">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Room History</span>
                </div>

                <div className="space-y-3">
                  {displayTransactions.slice(0, 3).map((tx, i) => (
                    <TransactionItem
                      key={i}
                      tx={tx}
                      onViewTenantProfile={onViewTenantProfile}
                      onClose={onClose}
                      isReceivable={tx.payment_type === 'receivable'}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Fixed Bottom Actions */}
          {!isArchived && (
            <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50 backdrop-blur-md p-6">
              <button
                onClick={() => {
                  const formattedRoom = typeof formatRoomDisplay === 'function' ? formatRoomDisplay(box) : box.number;
                  if (typeof onAddTenant === 'function') onAddTenant(formattedRoom, box.type || 'room');
                  if (typeof onClose === 'function') onClose();
                }}
                className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-black uppercase tracking-[0.2em] transition-all duration-300 shadow-xl shadow-blue-600/20 active:scale-[0.98]"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Add New Tenant
              </button>
              <button
                onClick={handleMaintenanceMode}
                className="w-full mt-3 flex items-center justify-center gap-3 px-6 py-4 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-2xl text-xs font-black uppercase tracking-widest border border-gray-200 dark:border-gray-700 transition-all active:scale-[0.98]"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                </svg>
                Set Maintenance
              </button>
            </div>
          )}
        </aside>
      </>
    )
  }

  // Fallback (shouldn't happen, but just in case)
  return null
}

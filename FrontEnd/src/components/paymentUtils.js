/**
 * Shared payment calculation utilities.
 * Used by RoomSidebar, TenantProfile, and other components
 * for consistent multi-month balance tracking.
 */

/**
 * Parse a date string manually to avoid timezone issues.
 * Returns { year, month (0-indexed), day } or null.
 */
export function parseDateSafe(dateStr) {
  if (!dateStr) return null
  if (typeof dateStr === 'string' && dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
    const parts = dateStr.split('-')
    return {
      year: parseInt(parts[0], 10),
      month: parseInt(parts[1], 10) - 1,
      day: parseInt(parts[2], 10),
    }
  }
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() }
}

/**
 * Parse a transaction amount safely (handles comma-formatted strings).
 */
export function parseAmount(t) {
  const raw = t.amount ?? 0
  const str = typeof raw === 'string' ? String(raw).replace(/,/g, '') : String(raw)
  return parseFloat(str) || 0
}

/**
 * Check if a transaction is a rent payment.
 */
export function isRentPaymentType(t) {
  const pt = (t.payment_type || '').toString().toLowerCase().trim()
  return pt === 'rent' || pt === 'monthly_rent' || pt === 'monthly rent'
}

/**
 * Get the month key a transaction belongs to.
 * Prefers explicit `for_month` field; falls back to transaction date.
 * Returns "YYYY-MM" string or null.
 */
export function getTransactionMonth(tx) {
  if (tx.for_month) return tx.for_month
  const dateStr = tx.timestamp || tx.date
  if (!dateStr) return null
  const parsed = parseDateSafe(dateStr)
  if (!parsed) return null
  return `${parsed.year}-${String(parsed.month + 1).padStart(2, '0')}`
}

/**
 * Calculate all unpaid or partially-paid months from first rent due to current month.
 *
 * @param {Object} params
 * @param {string|null} params.moveInDate - Tenant's move-in date (ISO string)
 * @param {number} params.monthlyRent - Monthly rent amount
 * @param {Array} params.transactions - All transactions (already filtered to current tenant)
 * @param {boolean} params.advancePaid - Whether advance has been paid
 * @returns {Array<UnpaidMonth>}
 */
export function getUnpaidMonths({ moveInDate, monthlyRent, transactions, advancePaid = true }) {
  if (!moveInDate || monthlyRent <= 0) return []

  const parsed = parseDateSafe(moveInDate)
  if (!parsed) return []

  const moveInDay = parsed.day
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth()
  const today = new Date(currentYear, currentMonth, now.getDate())

  // First rent due = month after move-in (advance covers move-in month)
  let startMonth = parsed.month + 1
  let startYear = parsed.year
  if (startMonth > 11) {
    startMonth = 0
    startYear++
  }

  // Filter only rent transactions
  const rentTransactions = (transactions || []).filter(isRentPaymentType)

  // Group rent transactions by month key
  const txByMonth = {}
  for (const tx of rentTransactions) {
    const monthKey = getTransactionMonth(tx)
    if (!monthKey) continue
    if (!txByMonth[monthKey]) txByMonth[monthKey] = []
    txByMonth[monthKey].push(tx)
  }

  const unpaidMonths = []
  let y = startYear
  let m = startMonth

  while (y < currentYear || (y === currentYear && m <= currentMonth)) {
    const monthKey = `${y}-${String(m + 1).padStart(2, '0')}`
    const lastDay = new Date(y, m + 1, 0).getDate()
    const dueDay = Math.min(moveInDay, lastDay)
    const dueDate = new Date(y, m, dueDay)

    // Get transactions for this month
    const monthTxs = txByMonth[monthKey] || []
    const paidSoFar = monthTxs.reduce((sum, t) => sum + parseAmount(t), 0)

    // Check for explicit partial status on latest transaction
    let remainingBalance = monthlyRent - paidSoFar
    if (monthTxs.length > 0) {
      const latestTx = [...monthTxs].sort((a, b) =>
        new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date)
      )[0]
      const hasExplicitRemaining = latestTx.remaining_balance != null && Number(latestTx.remaining_balance) > 0
      if (hasExplicitRemaining) {
        remainingBalance = Number(latestTx.remaining_balance)
      }
    }

    if (paidSoFar < monthlyRent || remainingBalance > 0) {
      const isCurrentMonth = y === currentYear && m === currentMonth
      const dueDateOnly = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate())
      const isLate = today > dueDateOnly
      const isDueToday = today.getTime() === dueDateOnly.getTime()
      let daysOverdue = 0
      if (isLate) {
        daysOverdue = Math.floor((today - dueDateOnly) / (1000 * 60 * 60 * 24))
      }

      unpaidMonths.push({
        forMonth: monthKey,
        label: new Date(y, m).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        shortLabel: new Date(y, m).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        dueDate,
        monthlyRent,
        paidSoFar,
        remainingBalance: Math.max(0, remainingBalance),
        status: paidSoFar > 0 ? 'partial' : 'unpaid',
        isCurrentMonth,
        isLate: isLate && !isDueToday,
        isDueToday,
        daysOverdue,
      })
    }

    // Advance to next month
    m++
    if (m > 11) {
      m = 0
      y++
    }
  }

  return unpaidMonths
}

/**
 * Returns true if an occupied room box has overdue (unpaid, past-due) rent.
 * Reuses parseDateSafe from this file. Safe to call on any box object.
 */
export function isBoxOverdue(box) {
  if (!box?.tenant || box.status !== 'occupied') return false
  const monthlyRent = parseFloat(box.payment) || parseFloat(box.tenant?.payment) || parseFloat(box.tenant?.rent) || 0
  if (monthlyRent <= 0) return false

  const moveInDate = box.tenant.move_in || box.tenant.date_of_occupancy
  if (!moveInDate) return false
  const parsed = parseDateSafe(moveInDate)
  if (!parsed) return false

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth()
  const today = new Date(currentYear, currentMonth, now.getDate())

  const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate()
  const adjustedDueDay = Math.min(parsed.day, lastDayOfMonth)
  let dueDate = new Date(currentYear, currentMonth, adjustedDueDay)

  // If due date falls in the move-in month or before move-in, push to next month
  const dueDateInMoveInMonth = dueDate.getMonth() === parsed.month && dueDate.getFullYear() === parsed.year
  const moveInDateObj = new Date(parsed.year, parsed.month, parsed.day)
  if (dueDateInMoveInMonth || dueDate < moveInDateObj) {
    const nm = currentMonth + 1 > 11 ? 0 : currentMonth + 1
    const ny = currentMonth + 1 > 11 ? currentYear + 1 : currentYear
    const lastDayNext = new Date(ny, nm + 1, 0).getDate()
    dueDate = new Date(ny, nm, Math.min(parsed.day, lastDayNext))
  }

  const dueDateOnly = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate())
  if (today <= dueDateOnly) return false // not yet due or due today

  // Check if current-month rent has been paid
  const allTransactions = box.transactions || []
  const currentTenantId = box.tenant.tenant_id ?? box.tenant.id
  const rentTx = allTransactions.filter(t => {
    if (currentTenantId != null) {
      const txTid = t.tenant_id ?? t.tenant
      if (txTid != null && String(txTid) !== String(currentTenantId)) return false
    }
    const pt = (t.payment_type || '').toString().toLowerCase()
    if (pt !== 'rent' && pt !== 'monthly_rent' && pt !== 'monthly rent') return false
    const d = new Date(t.timestamp || t.date)
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear
  })

  if (rentTx.length === 0) return true // no payment at all → overdue

  const paidSoFar = rentTx.reduce((sum, t) => {
    const raw = t.amount ?? 0
    return sum + (parseFloat(String(raw).replace(/,/g, '')) || 0)
  }, 0)

  const latestTx = [...rentTx].sort((a, b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date))[0]
  if (latestTx?.payment_status === 'partial') return false
  if (latestTx?.remaining_balance != null && Number(latestTx.remaining_balance) > 0) return false

  return paidSoFar < monthlyRent
}

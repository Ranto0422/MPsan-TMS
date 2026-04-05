import { useState, useEffect } from 'react'
import { authFetch } from '../auth.js'

// Due day always derived from move-in date (consistent across all components)
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

// Last due date that is in the past (same day of month, on or before today)
function getLastDueDateInPast(today, dueDay) {
  if (dueDay == null || dueDay < 1) return null
  let y = today.getFullYear()
  let m = today.getMonth()
  const lastDay = new Date(y, m + 1, 0).getDate()
  const day = Math.min(dueDay, lastDay)
  let due = new Date(y, m, day)
  if (due > today) {
    m -= 1
    if (m < 0) {
      m = 11
      y -= 1
    }
    const lastDayPrev = new Date(y, m + 1, 0).getDate()
    due = new Date(y, m, Math.min(dueDay, lastDayPrev))
  }
  return due
}

// Normalize payment type for comparison (backend may store 'rent', 'Rent', 'monthly_rent', etc.)
function isRentPaymentType(type) {
  const v = (type ?? '').toString().toLowerCase().trim()
  return v === 'rent' || v === 'monthly_rent' || v === 'monthly rent'
}

// Whether there is a rent payment in the same month/year as dueDate
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

function formatRoomNumber(room) {
  const number = room.number ?? ''
  const type = room.type || 'room'
  const section = room.section ?? ''
  if (type === 'commercial') return `C${number}`
  if (section) return `${section.charAt(0).toUpperCase()}${number}`
  return String(number)
}

const BalanceListView = ({ property, onBack, onViewTenantProfile }) => {
  const [tenantsWithBalance, setTenantsWithBalance] = useState([])
  const [filteredTenants, setFilteredTenants] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState('due_date')
  const [sortOrder, setSortOrder] = useState('desc')

  useEffect(() => {
    if (property?.id) {
      fetchTenantsWithBalance()
    } else {
      setTenantsWithBalance([])
      setLoading(false)
    }
  }, [property?.id])

  useEffect(() => {
    filterAndSortTenants()
  }, [tenantsWithBalance, searchQuery, sortField, sortOrder])

  const fetchTenantsWithBalance = async () => {
    setLoading(true)
    try {
      const res = await authFetch(`/api/properties/${property.id}/layouts/`)
      if (!res.ok) {
        setTenantsWithBalance([])
        return
      }
      const data = await res.json()
      const layouts = data.layouts || {}

      const allRooms = []
      if (typeof layouts === 'object') {
        for (const variant in layouts) {
          const arr = layouts[variant]
          if (Array.isArray(arr)) allRooms.push(...arr)
        }
      }

      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const list = []
      for (const room of allRooms) {
        if (!room.tenant || room.status !== 'occupied') continue
        const tenantId = room.tenant.tenant_id ?? room.tenant.id
        const monthlyRent = parseFloat(room.payment) || 0
        const unitNumber = formatRoomNumber(room)
        const baseRow = {
          tenant_id: tenantId,
          full_name: room.tenant.full_name || room.tenant.name || 'N/A',
          email: room.tenant.email || '',
          phone: room.tenant.phone || '',
          move_in: room.tenant.move_in || room.tenant.date_of_occupancy || null,
          payment: monthlyRent,
          unit_number: unitNumber,
        }

        // 1. Rent past due and not paid for that period
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
              if (dueDateOnly > todayOnly) continue
              // First period (due date in same month/year as move-in): if advance is paid, don't treat as rent overdue
              const moveInDate = moveIn ? new Date(moveIn) : null
              if (moveInDate && room.tenant.advance_paid === true &&
                dueDate.getMonth() === moveInDate.getMonth() && dueDate.getFullYear() === moveInDate.getFullYear()) {
                continue
              }
              const rentPaidSum = getRentPaidSumForPeriod(room.transactions, dueDate, tenantId)
              if (rentPaidSum >= monthlyRent) continue // fully paid

              // Skip if due date is TODAY and no payment made yet - they still have time to pay
              const isDueToday = dueDateOnly.getTime() === todayOnly.getTime()
              if (isDueToday && rentPaidSum === 0) continue

              if (rentPaidSum === 0) {
                const daysOverdue = Math.floor((todayOnly - dueDateOnly) / (24 * 60 * 60 * 1000))
                list.push({
                  ...baseRow,
                  type: 'rent_overdue',
                  reason_display: 'Rent overdue',
                  due_date: dueDate.toISOString().split('T')[0],
                  due_date_display: dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                  days_overdue: daysOverdue,
                  amount_owed: monthlyRent,
                  months_owed: 1,
                })
              } else {
                // Partial payment: amount owed = remaining balance
                list.push({
                  ...baseRow,
                  type: 'partial_rent',
                  reason_display: 'Partial rent (remaining)',
                  due_date: dueDate.toISOString().split('T')[0],
                  due_date_display: dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                  days_overdue: Math.floor((todayOnly - dueDateOnly) / (24 * 60 * 60 * 1000)),
                  amount_owed: monthlyRent - rentPaidSum,
                  months_owed: 0,
                })
              }
            }
          }
        }

        // 2. Advance not paid (treat missing/undefined as not paid)
        if (room.tenant.advance_paid !== true) {
          const advanceAmount = parseFloat(room.tenant.advance_amount) || monthlyRent
          list.push({
            ...baseRow,
            type: 'advance_not_paid',
            reason_display: 'Advance not paid',
            due_date: null,
            due_date_display: '—',
            days_overdue: 0,
            amount_owed: advanceAmount,
            months_owed: 0,
          })
        }

        // 3. Deposit not paid (treat missing/undefined as not paid)
        if (room.tenant.deposit_paid !== true) {
          const depositAmount = parseFloat(room.tenant.deposit_amount) || monthlyRent
          list.push({
            ...baseRow,
            type: 'deposit_not_paid',
            reason_display: 'Deposit not paid',
            due_date: null,
            due_date_display: '—',
            days_overdue: 0,
            amount_owed: depositAmount,
            months_owed: 0,
          })
        }
      }

      setTenantsWithBalance(list)
    } catch (err) {
      console.error('Error fetching tenants with balance:', err)
      setTenantsWithBalance([])
    } finally {
      setLoading(false)
    }
  }

  const filterAndSortTenants = () => {
    let result = [...tenantsWithBalance]
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter(
        t =>
          t.full_name?.toLowerCase().includes(q) ||
          String(t.tenant_id).includes(q) ||
          String(t.unit_number).toLowerCase().includes(q)
      )
    }
    result.sort((a, b) => {
      let aVal = a[sortField]
      let bVal = b[sortField]
      if (sortField === 'amount_owed' || sortField === 'days_overdue' || sortField === 'months_owed') {
        aVal = Number(aVal) || 0
        bVal = Number(bVal) || 0
      }
      if (sortField === 'due_date' || sortField === 'reason_display') {
        aVal = aVal ?? ''
        bVal = bVal ?? ''
      }
      if (sortOrder === 'asc') return aVal > bVal ? 1 : aVal < bVal ? -1 : 0
      return aVal < bVal ? 1 : aVal > bVal ? -1 : 0
    })
    setFilteredTenants(result)
  }

  const handleSort = (field) => {
    if (sortField === field) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    else {
      setSortField(field)
      setSortOrder(field === 'due_date' || field === 'days_overdue' || field === 'amount_owed' ? 'desc' : 'asc')
    }
  }


  const totalOwed = filteredTenants.reduce((sum, t) => sum + (t.amount_owed || 0), 0)

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

  // Generate PDF for balance list
  const generateBalanceListPDF = (balances) => {
    const propertyName = property?.propertyName || property?.name || 'Property'

    // Build filter description
    const filterDescription = searchQuery
      ? `Filtered by: "${searchQuery}"`
      : 'All Delinquent Accounts'

    // Print timestamp
    const printTimestamp = new Date().toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    })

    // Calculate summary statistics
    const totalAccounts = balances.length
    const totalOutstanding = balances.reduce((sum, b) => sum + (b.amount_owed || 0), 0)
    const averageOwed = totalAccounts > 0 ? totalOutstanding / totalAccounts : 0

    // Breakdown by type
    const rentOverdue = balances.filter(b => b.type === 'rent_overdue').length
    const partialRent = balances.filter(b => b.type === 'partial_rent').length
    const advanceNotPaid = balances.filter(b => b.type === 'advance_not_paid').length
    const depositNotPaid = balances.filter(b => b.type === 'deposit_not_paid').length

    // Generate table rows
    const tableRows = totalAccounts === 0
      ? '<tr><td colspan="6" style="text-align: center; padding: 40px; color: #999;">No outstanding balances</td></tr>'
      : balances.map(balance => `
          <tr>
            <td><strong>${escapeHtml(balance.full_name)}</strong></td>
            <td style="font-weight: 600;">${escapeHtml(balance.unit_number)}</td>
            <td>${escapeHtml(balance.reason_display)}</td>
            <td>${balance.due_date_display || 'N/A'}</td>
            <td class="center" style="color: #dc2626; font-weight: 600;">${balance.days_overdue || 0}</td>
            <td class="num" style="color: #dc2626; font-weight: 700;">₱${formatCurrency(balance.amount_owed)}</td>
          </tr>
        `).join('')

    // Build complete HTML
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(propertyName)} - Outstanding Balance Report</title>
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
      background: #fef2f2;
      border-radius: 8px;
      border: 2px solid #dc2626;
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
      border-top: 2px solid #991b1b;
      padding-top: 12px;
      margin-top: 8px;
      color: #dc2626;
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
    <div><strong>Report:</strong> Outstanding Balance Report</div>
    <div><strong>Filter:</strong> ${filterDescription}</div>
    <div><strong>Generated:</strong> ${printTimestamp}</div>
  </div>

  <div class="section">
    <table>
      <thead>
        <tr>
          <th>Tenant Name</th>
          <th>Room</th>
          <th>Reason</th>
          <th>Due Date</th>
          <th class="center">Days Overdue</th>
          <th class="num">Amount Owed</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  </div>

  ${totalAccounts > 0 ? `
  <div class="summary">
    <div class="summary-row">
      <span>Total Delinquent Accounts:</span>
      <span><strong>${totalAccounts}</strong></span>
    </div>
    ${rentOverdue > 0 ? `<div class="summary-row"><span>Rent Overdue:</span><span>${rentOverdue}</span></div>` : ''}
    ${partialRent > 0 ? `<div class="summary-row"><span>Partial Rent:</span><span>${partialRent}</span></div>` : ''}
    ${advanceNotPaid > 0 ? `<div class="summary-row"><span>Advance Not Paid:</span><span>${advanceNotPaid}</span></div>` : ''}
    ${depositNotPaid > 0 ? `<div class="summary-row"><span>Deposit Not Paid:</span><span>${depositNotPaid}</span></div>` : ''}
    <div class="summary-row total">
      <span>Total Outstanding Amount:</span>
      <span>₱${formatCurrency(totalOutstanding)}</span>
    </div>
    <div class="summary-row">
      <span>Average Amount Owed:</span>
      <span>₱${formatCurrency(averageOwed)}</span>
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

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-red-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="w-full h-full flex flex-col bg-gray-50 dark:bg-gray-900 font-sans">
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
                {property?.propertyName ?? property?.name ?? 'Outstanding Balance'}
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-widest leading-none">Delinquent Account Overview</p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => generateBalanceListPDF(filteredTenants)}
            className="w-full md:w-auto px-6 py-2.5 bg-gray-900 dark:bg-gray-700 hover:bg-black dark:hover:bg-gray-600 text-white rounded-xl font-bold transition-all flex items-center justify-center space-x-2 shadow-lg shadow-black/10 dark:shadow-none"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            <span className="text-sm">Print</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 pb-20 md:pb-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Delinquent Tenants</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-gray-900 dark:text-white leading-none">{filteredTenants.length}</span>
                  <span className="text-xs font-bold text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full uppercase tracking-tighter">Accounts</span>
                </div>
              </div>
              <div className="p-3 bg-red-50 dark:bg-red-900/30 rounded-2xl text-red-600 dark:text-red-400">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
            </div>

            <div className="bg-gradient-to-br from-red-600 to-red-700 p-5 rounded-2xl shadow-lg shadow-red-600/20 flex items-center justify-between text-white">
              <div>
                <p className="text-[10px] font-black text-red-100 uppercase tracking-widest mb-1">Total Outstanding</p>
                <div className="text-3xl font-black leading-none">₱{totalOwed.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
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
                  placeholder="Search tenant, ID, or room..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all outline-none dark:text-white"
                />
                <svg className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>

            </div>
          </div>

          {/* Tenant List Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                <h2 className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest">Outstanding Obligations</h2>
              </div>
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden border border-gray-100 dark:border-gray-700">
              <table className="w-full text-left border-collapse">
                <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                  <tr>
                    <th onClick={() => handleSort('full_name')} className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest cursor-pointer hover:text-red-600 transition-colors">
                      <div className="flex items-center gap-1">
                        Name {sortField === 'full_name' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('unit_number')} className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest cursor-pointer hover:text-red-600 transition-colors">
                      <div className="flex items-center gap-1">
                        Room {sortField === 'unit_number' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('reason_display')} className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest cursor-pointer hover:text-red-600 transition-colors">
                      <div className="flex items-center gap-1">
                        Reason {sortField === 'reason_display' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('due_date')} className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest cursor-pointer hover:text-red-600 transition-colors">
                      <div className="flex items-center gap-1">
                        Due Date {sortField === 'due_date' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('days_overdue')} className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest cursor-pointer hover:text-red-600 transition-colors">
                      <div className="flex items-center gap-1">
                        Overdue {sortField === 'days_overdue' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('amount_owed')} className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest text-right cursor-pointer hover:text-red-600 transition-colors">
                      <div className="flex items-center justify-end gap-1">
                        Amount {sortField === 'amount_owed' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </div>
                    </th>
                    <th className="px-6 py-4 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                  {filteredTenants.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="px-6 py-12 text-center text-gray-400 font-medium italic">No delinquent accounts found</td>
                    </tr>
                  ) : (
                    filteredTenants.map((tenant) => (
                      <tr
                        key={`${tenant.tenant_id}-${tenant.unit_number}-${tenant.type}`}
                        onClick={() => typeof onViewTenantProfile === 'function' && onViewTenantProfile(tenant.tenant_id)}
                        className="hover:bg-red-50/50 dark:hover:bg-red-900/10 transition-colors cursor-pointer group"
                      >
                        <td className="px-6 py-4">
                          <span className="text-sm font-bold text-gray-900 dark:text-gray-300 group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">
                            {tenant.full_name}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{tenant.unit_number}</td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-tight
                            ${tenant.type === 'rent_overdue' || tenant.type === 'partial_rent' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30' :
                              tenant.type === 'advance_not_paid' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30' :
                                'bg-purple-100 text-purple-700 dark:bg-purple-900/30'}`}>
                            {tenant.reason_display}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{tenant.due_date_display}</td>
                        <td className="px-6 py-4">
                          <span className={`text-sm font-black ${tenant.days_overdue > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
                            {tenant.days_overdue > 0 ? `${tenant.days_overdue}d` : '—'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm font-black text-red-600 dark:text-red-400 text-right">
                          ₱{tenant.amount_owed.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                            <svg className="w-5 h-5 text-red-500 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-3">
              {filteredTenants.length === 0 ? (
                <div className="py-12 text-center text-gray-400 font-medium bg-white dark:bg-gray-800 rounded-2xl">No delinquent accounts found</div>
              ) : (
                filteredTenants.map((tenant) => (
                  <div
                    key={`${tenant.tenant_id}-${tenant.unit_number}-${tenant.type}`}
                    onClick={() => typeof onViewTenantProfile === 'function' && onViewTenantProfile(tenant.tenant_id)}
                    className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 transition-all cursor-pointer active:scale-[0.98] group"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">{tenant.full_name}</h3>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Room {tenant.unit_number || 'N/A'}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest
                        ${tenant.type === 'rent_overdue' || tenant.type === 'partial_rent' ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/30' :
                          tenant.type === 'advance_not_paid' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30' :
                            'bg-purple-50 text-purple-600 dark:bg-purple-900/30'}`}>
                        {tenant.reason_display.split(' (')[0]}
                      </span>
                    </div>

                    <div className="flex items-center justify-between mb-4">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">Due Date</span>
                        <span className="text-xs font-bold text-gray-700 dark:text-gray-300">{tenant.due_date_display}</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">Overdue</span>
                        <span className={`text-xs font-black ${tenant.days_overdue > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                          {tenant.days_overdue > 0 ? `${tenant.days_overdue} Days` : '—'}
                        </span>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-gray-50 dark:border-gray-700/50 flex items-center justify-between">
                      <span className="text-red-500 text-xs font-bold flex items-center gap-1 group-active:translate-x-1 transition-transform">
                        View Profile
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
                      </span>
                      <div className="text-lg font-black text-red-600 dark:text-red-400">
                        ₱{tenant.amount_owed.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BalanceListView

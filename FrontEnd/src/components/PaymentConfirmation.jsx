import React, { useState, useMemo } from 'react'
import { authFetch } from '../auth'

const LATE_FEE_PER_DAY = 50

function getDueDay(tenant) {
  const moveIn = tenant?.move_in || tenant?.date_of_occupancy
  if (moveIn) {
    // Parse manually to avoid timezone issues
    if (typeof moveIn === 'string' && moveIn.match(/^\d{4}-\d{2}-\d{2}/)) {
      return parseInt(moveIn.split('-')[2], 10)
    }
    return new Date(moveIn).getDate()
  }
  return 31
}

function getRentDueDateForPaymentDate(paymentDateStr, dueDay) {
  const d = new Date(paymentDateStr)
  const year = d.getFullYear()
  const month = d.getMonth()
  const prevMonth = month === 0 ? 11 : month - 1
  const prevYear = month === 0 ? year - 1 : year
  const lastDayPrev = new Date(prevYear, prevMonth + 1, 0).getDate()
  const day = Math.min(dueDay, lastDayPrev)
  return new Date(prevYear, prevMonth, day)
}

function getDaysLate(paymentDateStr, dueDate) {
  const pay = new Date(paymentDateStr)
  pay.setHours(0, 0, 0, 0)
  const due = new Date(dueDate)
  due.setHours(0, 0, 0, 0)
  if (pay <= due) return 0
  return Math.floor((pay - due) / (24 * 60 * 60 * 1000))
}

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', icon: '💵' },
  { value: 'gcash', label: 'GCash', icon: '📱' },
  { value: 'bank_transfer', label: 'Bank Transfer', icon: '🏦' },
  { value: 'maya', label: 'Maya', icon: '📲' },
  { value: 'check', label: 'Check', icon: '📝' },
  { value: 'other', label: 'Other', icon: '💳' }
]

const PAYMENT_CATEGORIES = [
  { value: 'rent', label: 'Monthly Rent', icon: '🏠', description: 'Regular monthly rent payment' },
  { value: 'advance', label: 'Advance Payment', icon: '📅', description: 'Advance rent (for move-in or additional)' },
  { value: 'deposit', label: 'Deposit Payment', icon: '🔒', description: 'Security deposit payment' },
  { value: 'utility', label: 'Utilities', icon: '💡', description: 'Electric, water, internet, etc.' },
  { value: 'maintenance', label: 'Maintenance', icon: '🔧', description: 'Repairs and maintenance fees' },
  { value: 'damages', label: 'Damages', icon: '⚠️', description: 'Payment for property damages' },
  { value: 'other', label: 'Other', icon: '📋', description: 'Other fees or charges' },
  { value: 'receivables', label: 'Receivables', icon: '💰', description: 'Amount tenant owes you (e.g. repairs you paid first)' }
]

function roomKey(r) {
  return `${r.propertyId ?? r.property_id}-${r.roomNumber ?? r.room_number}`
}

export default function PaymentConfirmation({ tenant, roomNumber, propertyId, defaultAmount, defaultMarkAsLate, onClose, onSuccess, batchRooms, isBalancePayment, forMonth, forMonthLabel }) {
  // Step state: 'category' -> 'details' | 'batch-details'
  const [step, setStep] = useState(isBalancePayment ? 'details' : 'category')
  const [paymentCategory, setPaymentCategory] = useState(isBalancePayment ? 'rent' : '')
  const [batchMode, setBatchMode] = useState(false)
  const [batchRoomAmounts, setBatchRoomAmounts] = useState({}) // key = roomKey(r), value = amount string

  // Payment details
  const [amount, setAmount] = useState(defaultAmount || '')
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0])
  const [paymentTime, setPaymentTime] = useState(() => {
    const now = new Date()
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  })
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [notes, setNotes] = useState('')
  const [receiptNumber, setReceiptNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sendingConfirmation, setSendingConfirmation] = useState(false)
  const [confirmationResult, setConfirmationResult] = useState(null)

  // Rent-specific options
  const [paymentStatus, setPaymentStatus] = useState(isBalancePayment ? 'full' : 'full') // 'full' or 'partial'
  const [timingStatus, setTimingStatus] = useState(defaultMarkAsLate ? 'late' : 'ontime') // 'ontime' or 'late'
  const [remainingBalance, setRemainingBalance] = useState(isBalancePayment ? '0' : '')
  const [lateFeeAmount, setLateFeeAmount] = useState('')

  // Other category description
  const [otherDescription, setOtherDescription] = useState('')

  // Reimbursement (tenant owes owner - e.g. repairs owner paid first)
  const [reimbAmount, setReimbAmount] = useState('')
  const [reimbReason, setReimbReason] = useState('')
  const [reimbAdding, setReimbAdding] = useState(false)
  const [reimbError, setReimbError] = useState('')
  const [reimbSuccess, setReimbSuccess] = useState('')

  const canBatch = batchRooms && batchRooms.length > 1
  const roomsList = (batchRooms || []).map(r => ({
    propertyId: r.propertyId ?? r.property_id,
    roomNumber: r.roomNumber ?? r.room_number,
    defaultAmount: r.defaultAmount ?? r.payment ?? ''
  }))

  // Check if tenant has unpaid advance/deposit (treat missing/undefined as unpaid)
  const hasUnpaidAdvance = tenant?.advance_paid !== true
  const hasUnpaidDeposit = tenant?.deposit_paid !== true

  const dueDay = useMemo(() => getDueDay(tenant), [tenant])
  const rentDueDate = useMemo(() => {
    if (forMonth) {
      // forMonth is "YYYY-MM" — use that month's due day directly
      const [y, m] = forMonth.split('-').map(Number)
      const monthIdx = m - 1
      const lastDay = new Date(y, monthIdx + 1, 0).getDate()
      return new Date(y, monthIdx, Math.min(dueDay, lastDay))
    }
    return getRentDueDateForPaymentDate(paymentDate, dueDay)
  }, [paymentDate, dueDay, forMonth])
  const daysLate = useMemo(() => getDaysLate(paymentDate, rentDueDate), [paymentDate, rentDueDate])
  const suggestedLateFee = daysLate * LATE_FEE_PER_DAY
  const lateFeeValue = paymentCategory === 'rent' && timingStatus === 'late'
    ? (lateFeeAmount !== '' ? parseFloat(lateFeeAmount) : suggestedLateFee)
    : 0

  // Auto-detect partial payment: when rent amount is less than monthly rent, auto-set to partial
  // Use tenant.payment/rent as the true monthly rent (not defaultAmount which might be remaining balance)
  const actualMonthlyRent = parseFloat(tenant?.payment) || parseFloat(tenant?.rent) || parseFloat(defaultAmount) || 0
  React.useEffect(() => {
    if (paymentCategory !== 'rent' || actualMonthlyRent <= 0 || isBalancePayment) return
    const enteredAmount = parseFloat(amount) || 0
    if (enteredAmount > 0 && enteredAmount < actualMonthlyRent) {
      // Auto-switch to partial and calculate remaining
      setPaymentStatus('partial')
      setRemainingBalance(String(actualMonthlyRent - enteredAmount))
    } else if (enteredAmount >= actualMonthlyRent) {
      // Full payment - reset to full
      setPaymentStatus('full')
      setRemainingBalance('')
    }
  }, [amount, paymentCategory, actualMonthlyRent, isBalancePayment])

  // Get the due date text for display
  const getDueDateText = () => {
    const moveInDate = tenant.move_in || tenant.date_of_occupancy
    if (!moveInDate) return null

    const moveIn = new Date(moveInDate)
    const dueDay = moveIn.getDate()
    const suffix = dueDay === 1 || dueDay === 21 || dueDay === 31 ? 'st'
      : dueDay === 2 || dueDay === 22 ? 'nd'
        : dueDay === 3 || dueDay === 23 ? 'rd' : 'th'
    return `${dueDay}${suffix}`
  }

  const handleCategorySelect = (category) => {
    setPaymentCategory(category)

    // Receivables is a separate flow: amount + reason only, no payment recording
    if (category === 'receivables') {
      setStep('receivable-details')
      setReimbAmount('')
      setReimbReason('')
      setReimbError('')
      setReimbSuccess('')
      return
    }

    if (batchMode && canBatch) {
      const initial = {}
      roomsList.forEach(r => {
        const key = roomKey(r)
        let def = r.defaultAmount
        if (category === 'rent') def = def ?? defaultAmount
        else if (category === 'advance' && hasUnpaidAdvance) def = tenant.advance_amount ?? def
        else if (category === 'deposit' && hasUnpaidDeposit) def = tenant.deposit_amount ?? def
        initial[key] = def !== undefined && def !== null ? String(def) : ''
      })
      setBatchRoomAmounts(initial)
      setStep('batch-details')
      return
    }

    // Pre-fill amount for advance/deposit if tenant has unpaid ones
    if (category === 'advance' && hasUnpaidAdvance) {
      setAmount(tenant.advance_amount || defaultAmount || '')
    } else if (category === 'deposit' && hasUnpaidDeposit) {
      setAmount(tenant.deposit_amount || defaultAmount || '')
    } else if (category === 'rent') {
      setAmount(defaultAmount || '')
    } else {
      setAmount('')
    }

    setStep('details')
  }

  const setBatchAmount = (key, value) => {
    setBatchRoomAmounts(prev => ({ ...prev, [key]: value }))
  }

  const handleBatchSubmit = async (e) => {
    e.preventDefault()
    const payments = roomsList.map(r => {
      const key = roomKey(r)
      const amt = batchRoomAmounts[key] ?? r.defaultAmount ?? ''
      const roomNum = r.roomNumber ?? r.room_number ?? ''
      return {
        property_id: r.propertyId,
        room_number: String(roomNum),
        amount: parseFloat(amt) || 0
      }
    }).filter(p => p.amount > 0)

    if (payments.length === 0) {
      setError('Enter at least one room amount greater than 0')
      return
    }

    if (paymentCategory === 'other' && !otherDescription.trim()) {
      setError('Please provide a description for this payment')
      return
    }

    setLoading(true)
    setError('')

    try {
      const tenantId = tenant.tenant_id || tenant.id
      const isLate = paymentCategory === 'rent' ? timingStatus === 'late' : false
      const lateFee = paymentCategory === 'rent' && isLate ? (parseFloat(lateFeeAmount) || suggestedLateFee) : 0
      let finalNotes = notes
      if (!finalNotes) {
        if (paymentCategory === 'rent') {
          finalNotes = `${paymentStatus === 'partial' ? 'Partial' : 'Full'} rent payment - ${isLate ? 'Late' : 'On-time'}`
          if (paymentStatus === 'partial' && remainingBalance) {
            finalNotes += ` (Remaining: ₱${parseFloat(remainingBalance).toLocaleString()})`
          }
          if (isBalancePayment) {
            finalNotes = `Balance payment - ${finalNotes}`
          }
        } else if (paymentCategory === 'other') {
          finalNotes = otherDescription
        } else {
          const categoryLabel = PAYMENT_CATEGORIES.find(c => c.value === paymentCategory)?.label || paymentCategory
          finalNotes = `${categoryLabel} payment`
        }
      } else if (isBalancePayment && finalNotes) {
        finalNotes = `Balance payment - ${finalNotes}`
      }

      const response = await authFetch(`/api/tenants/${tenantId}/batch-payment/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payments,
          payment_date: paymentDate,
          payment_time: paymentTime || null,
          payment_method: paymentMethod,
          notes: finalNotes,
          is_late: isLate,
          late_fee: lateFee > 0 ? lateFee : undefined,
          receipt_number: receiptNumber || null,
          payment_type: paymentCategory,
          payment_status: paymentCategory === 'rent' ? paymentStatus : 'full',
          remaining_balance: paymentStatus === 'partial' ? parseFloat(remainingBalance) || 0 : 0,
          ...(isBalancePayment ? { is_balance_payment: true } : {}),
          ...(forMonth && paymentCategory === 'rent' ? { for_month: forMonth } : {})
        })
      })

      if (response.ok) {
        try {
          const data = await response.json()
          const results = data.results || []
          const failed = results.filter(r => r.ok === false)
          if (failed.length > 0) {
            setError(
              failed.map(r => `Room ${r.room_number}: ${r.error || 'failed'}`).join('. ')
            )
            return
          }
        } catch (_) { }
        if (typeof onSuccess === 'function') onSuccess()
        setStep('send-confirmation')
      } else {
        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          const data = await response.json()
          setError(data.error || 'Failed to record batch payment')
        } else {
          if (response.status === 404) {
            setError('Batch payment endpoint not found. Restart the backend server (Daphne/Django) so the new route is loaded.')
          } else {
            setError(`Server error (${response.status}). Try restarting the backend if you just added batch payment.`)
          }
        }
      }
    } catch (err) {
      console.error('Batch payment error:', err)
      setError(err.message?.includes('JSON') ? 'Server returned an error page. Restart the backend server and try again.' : 'An error occurred while recording batch payment')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid amount')
      return
    }

    if (paymentCategory === 'other' && !otherDescription.trim()) {
      setError('Please provide a description for this payment')
      return
    }

    setLoading(true)
    setError('')

    try {
      const tenantId = tenant.tenant_id || tenant.id
      const isLate = paymentCategory === 'rent' ? timingStatus === 'late' : false
      const lateFee = paymentCategory === 'rent' && isLate ? (parseFloat(lateFeeAmount) || suggestedLateFee) : 0

      // Build notes based on category and status
      let finalNotes = notes
      if (!finalNotes) {
        if (paymentCategory === 'rent') {
          finalNotes = `${paymentStatus === 'partial' ? 'Partial' : 'Full'} rent payment - ${isLate ? 'Late' : 'On-time'}`
          if (paymentStatus === 'partial' && remainingBalance) {
            finalNotes += ` (Remaining: ₱${parseFloat(remainingBalance).toLocaleString()})`
          }
          if (isBalancePayment) {
            finalNotes = `Balance payment - ${finalNotes}`
          }
        } else if (paymentCategory === 'other') {
          finalNotes = otherDescription
        } else {
          const categoryLabel = PAYMENT_CATEGORIES.find(c => c.value === paymentCategory)?.label || paymentCategory
          finalNotes = `${categoryLabel} payment`
        }
      } else if (isBalancePayment && finalNotes) {
        finalNotes = `Balance payment - ${finalNotes}`
      }

      const response = await authFetch(`/api/tenants/${tenantId}/payment/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          property_id: propertyId,
          room_number: roomNumber,
          amount: parseFloat(amount),
          payment_date: paymentDate,
          payment_time: paymentTime || null,
          payment_method: paymentMethod,
          notes: finalNotes,
          is_late: isLate,
          late_fee: lateFee > 0 ? lateFee : undefined,
          receipt_number: receiptNumber || null,
          payment_type: paymentCategory,
          payment_status: paymentCategory === 'rent' ? paymentStatus : 'full',
          remaining_balance: paymentStatus === 'partial' ? parseFloat(remainingBalance) || 0 : 0,
          ...(isBalancePayment ? { is_balance_payment: true } : {}),
          ...(forMonth && paymentCategory === 'rent' ? { for_month: forMonth } : {})
        })
      })

      if (response.ok) {
        if (typeof onSuccess === 'function') {
          onSuccess()
        }
        setStep('send-confirmation')
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to record payment')
      }
    } catch (err) {
      console.error('Payment error:', err)
      setError('An error occurred while recording payment')
    } finally {
      setLoading(false)
    }
  }

  const handleAddReceivable = async (e) => {
    e.preventDefault()
    const amt = parseFloat(reimbAmount)
    if (!reimbAmount || isNaN(amt) || amt <= 0) {
      setReimbError('Enter a valid amount')
      return
    }
    setReimbAdding(true)
    setReimbError('')
    setReimbSuccess('')
    try {
      const tenantId = tenant.tenant_id || tenant.id
      const res = await authFetch(`/api/tenants/${tenantId}/receivables/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amt,
          reason: (reimbReason || 'Reimbursement').trim() || 'Reimbursement'
        })
      })
      if (res.ok) {
        setReimbAmount('')
        setReimbReason('')
        setReimbSuccess('Receivable added. Tenant owes you ₱' + amt.toLocaleString())
        // Close modal first so user returns to profile (e.g. Tenant Profile); then refresh data.
        // If we only called onSuccess(), the parent's fetchTenantData() sets loading=true and unmounts this modal, then remounts it with step='category'.
        if (typeof onClose === 'function') onClose()
        if (typeof onSuccess === 'function') onSuccess()
      } else {
        const data = await res.json()
        setReimbError(data.error || 'Failed to add receivable')
      }
    } catch (err) {
      setReimbError(err.message || 'Failed to add receivable')
    } finally {
      setReimbAdding(false)
    }
  }

  const handleSendConfirmation = async (channel) => {
    setSendingConfirmation(true)
    setConfirmationResult(null)
    try {
      const tenantId = tenant.tenant_id || tenant.id
      const res = await authFetch(`/api/tenants/${tenantId}/send-payment-confirmation/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          amount: parseFloat(amount) || 0,
          payment_method: paymentMethod,
          payment_date: paymentDate,
          room_number: roomNumber,
          property_id: propertyId,
          payment_type: paymentCategory,
          remaining_balance: paymentStatus === 'partial' ? parseFloat(remainingBalance) || 0 : 0,
          receipt_number: receiptNumber || '',
        }),
      })
      const data = res.ok ? await res.json().catch(() => ({})) : await res.json().catch(() => ({}))
      if (res.ok) {
        setConfirmationResult({ success: true, message: data.detail || 'Sent!' })
      } else {
        setConfirmationResult({ success: false, message: data.error || 'Failed to send' })
      }
    } catch (e) {
      setConfirmationResult({ success: false, message: e.message || 'Failed to send' })
    } finally {
      setSendingConfirmation(false)
    }
  }

  const hasEmail = !!tenant?.email
  const hasPhone = !!(tenant?.phone || tenant?.phone_number)

  // Send Confirmation Step (after payment recorded)
  if (step === 'send-confirmation') {
    return (
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[80] p-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-sm">
          <div className="p-6">
            <div className="text-center mb-5">
              <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Payment Recorded!</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Send a confirmation to {tenant.full_name}?
              </p>
            </div>

            {confirmationResult && (
              <div className={`mb-4 p-3 rounded-lg text-sm ${
                confirmationResult.success
                  ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
                  : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
              }`}>
                {confirmationResult.message}
              </div>
            )}

            {!confirmationResult?.success && (
              <div className="space-y-2 mb-4">
                <button
                  type="button"
                  onClick={() => handleSendConfirmation('email')}
                  disabled={sendingConfirmation || !hasEmail}
                  className={`w-full p-3 rounded-lg border-2 text-left transition-all flex items-center gap-3 ${
                    !hasEmail
                      ? 'opacity-40 cursor-not-allowed border-gray-200 dark:border-gray-600'
                      : 'border-gray-200 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                  }`}
                >
                  <span className="text-xl">📧</span>
                  <div className="flex-1">
                    <div className="font-medium text-gray-900 dark:text-white text-sm">Send via Email</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {hasEmail ? 'Sends to tenant & owner' : 'No email on file'}
                    </div>
                  </div>
                  {sendingConfirmation && (
                    <svg className="animate-spin w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleSendConfirmation('sms')}
                  disabled={sendingConfirmation || !hasPhone}
                  className={`w-full p-3 rounded-lg border-2 text-left transition-all flex items-center gap-3 ${
                    !hasPhone
                      ? 'opacity-40 cursor-not-allowed border-gray-200 dark:border-gray-600'
                      : 'border-gray-200 dark:border-gray-600 hover:border-green-400 hover:bg-green-50 dark:hover:bg-green-900/20'
                  }`}
                >
                  <span className="text-xl">📱</span>
                  <div className="flex-1">
                    <div className="font-medium text-gray-900 dark:text-white text-sm">Send via SMS</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {hasPhone ? 'Sends to tenant only' : 'No phone on file'}
                    </div>
                  </div>
                </button>

                {(hasEmail || hasPhone) && (
                  <button
                    type="button"
                    onClick={() => handleSendConfirmation('both')}
                    disabled={sendingConfirmation || (!hasEmail && !hasPhone)}
                    className="w-full p-3 rounded-lg border-2 text-left transition-all flex items-center gap-3 border-gray-200 dark:border-gray-600 hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                  >
                    <span className="text-xl">📨</span>
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 dark:text-white text-sm">
                        Send via {hasEmail && hasPhone ? 'Both' : hasEmail ? 'Email' : 'SMS'}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {hasEmail && hasPhone
                          ? 'SMS to tenant + Email to tenant & owner'
                          : hasEmail
                          ? 'Email to tenant & owner (no phone on file)'
                          : 'SMS to tenant (no email on file)'}
                      </div>
                    </div>
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
            >
              {confirmationResult?.success ? 'Close' : 'Skip'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Category Selection Step
  if (step === 'category') {
    return (
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[80] p-4 overflow-y-auto scrollbar-hide">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg my-4 max-h-[90vh] flex flex-col">
          <div className="p-6 overflow-y-auto flex-1 scrollbar-hide">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              Record Payment
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              What type of payment is this?
            </p>

            {/* Record for: This room only | Batch (all rooms) */}
            {canBatch && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Record for
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setBatchMode(false)}
                    className={`p-3 rounded-lg border-2 text-center transition-all ${!batchMode
                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-300'
                      }`}
                  >
                    <div className="font-medium">This room only</div>
                    <div className="text-xs opacity-75">Room {roomNumber}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBatchMode(true)}
                    className={`p-3 rounded-lg border-2 text-center transition-all ${batchMode
                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-300'
                      }`}
                  >
                    <div className="font-medium">Batch (all rooms)</div>
                    <div className="text-xs opacity-75">{roomsList.length} rooms</div>
                  </button>
                </div>
              </div>
            )}

            {/* Tenant Info */}
            <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900 rounded-lg">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                {tenant.full_name}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Room: {roomNumber}
              </p>
            </div>

            {/* Unpaid Advance/Deposit Warning */}
            {(hasUnpaidAdvance || hasUnpaidDeposit) && (
              <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-lg">
                <div className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">Unpaid Initial Payment</p>
                    <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                      {hasUnpaidAdvance && hasUnpaidDeposit
                        ? 'Tenant has not paid advance and deposit'
                        : hasUnpaidAdvance
                          ? 'Tenant has not paid advance'
                          : 'Tenant has not paid deposit'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Payment Categories */}
            <div className="space-y-2">
              {PAYMENT_CATEGORIES.map((category) => {
                // Highlight unpaid advance/deposit
                const isHighlighted =
                  (category.value === 'advance' && hasUnpaidAdvance) ||
                  (category.value === 'deposit' && hasUnpaidDeposit)

                return (
                  <button
                    key={category.value}
                    type="button"
                    onClick={() => handleCategorySelect(category.value)}
                    className={`w-full p-3 rounded-lg border-2 text-left transition-all flex items-center gap-3 ${isHighlighted
                        ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 hover:bg-yellow-100 dark:hover:bg-yellow-900/30'
                        : 'border-gray-200 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                      }`}
                  >
                    <span className="text-2xl">{category.icon}</span>
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                        {category.label}
                        {isHighlighted && (
                          <span className="text-xs px-2 py-0.5 bg-yellow-200 text-yellow-800 rounded-full">
                            Unpaid
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{category.description}</div>
                    </div>
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )
              })}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full mt-4 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Receivables-only step: amount tenant owes + reason (no payment recording)
  if (step === 'receivable-details') {
    return (
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[80] p-4 overflow-y-auto scrollbar-hide">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md my-4">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <button
                type="button"
                onClick={() => { setStep('category'); setPaymentCategory(''); setReimbError(''); setReimbSuccess(''); }}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7 7" />
                </svg>
              </button>
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Receivables</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {tenant.full_name} — Room {roomNumber}
                </p>
              </div>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Record an amount the tenant owes you (e.g. repairs you paid first). They will see this in their profile until you mark it as received.
            </p>
            {error && (
              <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-400 text-red-700 dark:text-red-300 rounded text-sm">
                {error}
              </div>
            )}
            {reimbError && (
              <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-400 text-red-700 dark:text-red-300 rounded text-sm">
                {reimbError}
              </div>
            )}
            {reimbSuccess && (
              <div className="mb-4 p-3 bg-green-100 dark:bg-green-900/30 border border-green-400 text-green-700 dark:text-green-300 rounded text-sm">
                {reimbSuccess}
              </div>
            )}
            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount owed (₱)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={reimbAmount}
                  onChange={(e) => { setReimbAmount(e.target.value); setReimbError(''); setReimbSuccess(''); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">What for</label>
                <input
                  type="text"
                  value={reimbReason}
                  onChange={(e) => setReimbReason(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  placeholder="e.g. Repairs, replacement, damages"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddReceivable}
                disabled={reimbAdding}
                className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold disabled:opacity-50"
              >
                {reimbAdding ? 'Adding...' : 'Add receivable'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Batch Payment Details Step
  if (step === 'batch-details') {
    return (
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[80] p-4 overflow-y-auto scrollbar-hide">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg my-4 max-h-[90vh] flex flex-col">
          <div className="p-6 overflow-y-auto flex-1 scrollbar-hide">
            <div className="flex items-center gap-3 mb-4">
              <button
                type="button"
                onClick={() => setStep('category')}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  Batch {PAYMENT_CATEGORIES.find(c => c.value === paymentCategory)?.label || 'Payment'}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {tenant.full_name} – amount per room
                </p>
              </div>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleBatchSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Amount paid per room (₱)
                </label>
                <div className="space-y-3">
                  {roomsList.map((r) => {
                    const key = roomKey(r)
                    return (
                      <div key={key} className="flex items-center gap-3">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-24 shrink-0">
                          {r.roomNumber}
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          value={batchRoomAmounts[key] ?? ''}
                          onChange={(e) => setBatchAmount(key, e.target.value)}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                          placeholder={r.defaultAmount ? `₱${Number(r.defaultAmount).toLocaleString()}` : '0'}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>

              {paymentCategory === 'rent' && (
                <>
                  <div className="mb-4 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setPaymentStatus('full')} className={`p-2 rounded-lg border-2 text-sm ${paymentStatus === 'full' ? 'border-green-500 bg-green-50 dark:bg-green-900/30' : 'border-gray-200 dark:border-gray-600'}`}>Full</button>
                    <button type="button" onClick={() => setPaymentStatus('partial')} className={`p-2 rounded-lg border-2 text-sm ${paymentStatus === 'partial' ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/30' : 'border-gray-200 dark:border-gray-600'}`}>Partial</button>
                  </div>
                  <div className="mb-4 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setTimingStatus('ontime')} className={`p-2 rounded-lg border-2 text-sm ${timingStatus === 'ontime' ? 'border-green-500 bg-green-50 dark:bg-green-900/30' : 'border-gray-200 dark:border-gray-600'}`}>On-time</button>
                    <button type="button" onClick={() => setTimingStatus('late')} className={`p-2 rounded-lg border-2 text-sm ${timingStatus === 'late' ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/30' : 'border-gray-200 dark:border-gray-600'}`}>Late</button>
                  </div>
                </>
              )}

              {paymentCategory === 'other' && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description *</label>
                  <input type="text" value={otherDescription} onChange={(e) => setOtherDescription(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white" required />
                </div>
              )}

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Date</label>
                <input type="date" value={paymentDate} onChange={(e) => { setPaymentDate(e.target.value); if (paymentCategory === 'rent' && timingStatus === 'late') setLateFeeAmount('') }} className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white" required />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Method</label>
                <div className="grid grid-cols-3 gap-2">
                  {PAYMENT_METHODS.map((m) => (
                    <button key={m.value} type="button" onClick={() => setPaymentMethod(m.value)} className={`px-2 py-2 rounded-lg border-2 text-xs ${paymentMethod === m.value ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-600'}`}>
                      <span className="block">{m.icon}</span><span>{m.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Receipt (optional)</label>
                <input type="text" value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="Receipt number" />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes (optional)</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="Notes..." />
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700" disabled={loading}>Cancel</button>
                <button type="submit" className="flex-1 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold disabled:opacity-50" disabled={loading}>
                  {loading ? 'Recording...' : 'Confirm Batch Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    )
  }

  // Payment Details Step (single room)
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[80] p-4 overflow-y-auto scrollbar-hide">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md my-4 max-h-[90vh] flex flex-col">
        <div className="p-6 overflow-y-auto flex-1 scrollbar-hide">
          {/* Header with back button */}
          <div className="flex items-center gap-3 mb-4">
            <button
              type="button"
              onClick={() => setStep('category')}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            >
              <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {PAYMENT_CATEGORIES.find(c => c.value === paymentCategory)?.label || 'Payment'} Details
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {tenant.full_name} - Room {roomNumber}
              </p>
            </div>
          </div>

          {/* Target month banner */}
          {forMonthLabel && paymentCategory === 'rent' && (
            <div className="mb-4 p-3 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 rounded-lg flex items-center gap-2">
              <svg className="w-4 h-4 text-indigo-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
                Payment for: {forMonthLabel}
              </p>
            </div>
          )}

          {/* Due date info for rent */}
          {paymentCategory === 'rent' && !forMonthLabel && getDueDateText() && (
            <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900 rounded-lg">
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Payment due every: <strong>{getDueDateText()}</strong> of the month
              </p>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* Rent-specific: Payment Status (Full/Partial) */}
            {paymentCategory === 'rent' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Payment Status
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentStatus('full')}
                    className={`p-3 rounded-lg border-2 text-center transition-all ${paymentStatus === 'full'
                        ? 'border-green-500 bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                        : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-300'
                      }`}
                  >
                    <div className="font-medium">Full Payment</div>
                    <div className="text-xs opacity-75">Paid in full</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentStatus('partial')}
                    className={`p-3 rounded-lg border-2 text-center transition-all ${paymentStatus === 'partial'
                        ? 'border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                        : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-300'
                      }`}
                  >
                    <div className="font-medium">Partial Payment</div>
                    <div className="text-xs opacity-75">Still owes balance</div>
                  </button>
                </div>
              </div>
            )}

            {/* Rent-specific: Timing Status (On-time/Late) */}
            {paymentCategory === 'rent' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Timing Status
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setTimingStatus('ontime'); setLateFeeAmount('') }}
                    className={`p-3 rounded-lg border-2 text-center transition-all ${timingStatus === 'ontime'
                        ? 'border-green-500 bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                        : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-300'
                      }`}
                  >
                    <div className="font-medium">On-time</div>
                    <div className="text-xs opacity-75">Paid by due date</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setTimingStatus('late'); setLateFeeAmount('') }}
                    className={`p-3 rounded-lg border-2 text-center transition-all ${timingStatus === 'late'
                        ? 'border-yellow-500 bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                        : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-300'
                      }`}
                  >
                    <div className="font-medium">Late</div>
                    <div className="text-xs opacity-75">Paid after due date</div>
                  </button>
                </div>
              </div>
            )}

            {/* Late fee: days late + editable amount (rent, late only) */}
            {paymentCategory === 'rent' && timingStatus === 'late' && (
              <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-1">
                  {daysLate} day{daysLate !== 1 ? 's' : ''} late (₱{LATE_FEE_PER_DAY}/day)
                </p>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Late payment fee (₱)
                </label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={lateFeeAmount}
                  onChange={(e) => setLateFeeAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  placeholder={`Suggested: ₱${suggestedLateFee} (editable)`}
                />
              </div>
            )}

            {/* Amount */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Amount Paid (₱)
              </label>
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                required
              />
            </div>

            {/* Remaining Balance (for partial payments) */}
            {paymentCategory === 'rent' && paymentStatus === 'partial' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Remaining Balance (₱)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={remainingBalance}
                  onChange={(e) => setRemainingBalance(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  placeholder="Amount still owed"
                />
              </div>
            )}

            {/* Other description */}
            {paymentCategory === 'other' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Payment Description *
                </label>
                <input
                  type="text"
                  value={otherDescription}
                  onChange={(e) => setOtherDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  placeholder="e.g., Late fee, Parking fee, etc."
                  required
                />
              </div>
            )}

            {/* Payment Date & Time */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Payment Date &amp; Time
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => { setPaymentDate(e.target.value); if (paymentCategory === 'rent' && timingStatus === 'late') setLateFeeAmount('') }}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  required
                />
                <input
                  type="time"
                  value={paymentTime}
                  onChange={(e) => setPaymentTime(e.target.value)}
                  className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Time helps improve ML-based notification scheduling</p>
            </div>

            {/* Payment Method */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Payment Method
              </label>
              <div className="grid grid-cols-3 gap-2">
                {PAYMENT_METHODS.map((method) => (
                  <button
                    key={method.value}
                    type="button"
                    onClick={() => setPaymentMethod(method.value)}
                    className={`px-2 py-2 rounded-lg border-2 text-xs font-medium transition-colors flex flex-col items-center gap-1 ${paymentMethod === method.value
                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                        : 'border-gray-200 hover:border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-500'
                      }`}
                  >
                    <span className="text-base">{method.icon}</span>
                    <span>{method.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Receipt Number */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Receipt Number (Optional)
              </label>
              <input
                type="text"
                value={receiptNumber}
                onChange={(e) => setReceiptNumber(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                placeholder="e.g., RCP-2026-0001"
              />
            </div>

            {/* Notes */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Notes (Optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows="2"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                placeholder="Add any notes about this payment..."
              />
            </div>

            {/* Summary */}
            <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Payment Summary</div>
              {isBalancePayment && (
                <div className="mb-2 text-sm font-medium text-blue-700 dark:text-blue-300">Payment toward outstanding balance</div>
              )}
              <div className="flex justify-between items-baseline gap-3">
                <span className="font-medium text-gray-900 dark:text-white">
                  {PAYMENT_CATEGORIES.find(c => c.value === paymentCategory)?.label}
                </span>
                <span className="text-lg font-bold text-green-600 shrink-0">
                  ₱{parseFloat(amount || 0).toLocaleString()}
                </span>
              </div>
              {paymentCategory === 'rent' && timingStatus === 'late' && lateFeeValue > 0 && (
                <div className="flex justify-between items-baseline gap-3 mt-2 text-amber-700 dark:text-amber-300">
                  <span className="text-sm font-medium">Late payment fee</span>
                  <span className="font-semibold shrink-0">₱{lateFeeValue.toLocaleString()}</span>
                </div>
              )}
              {paymentCategory === 'rent' && timingStatus === 'late' && lateFeeValue > 0 && (
                <div className="flex justify-between items-baseline gap-3 mt-2 pt-2 border-t border-gray-200 dark:border-gray-600">
                  <span className="font-medium text-gray-900 dark:text-white">Total</span>
                  <span className="text-lg font-bold text-green-600 shrink-0">
                    ₱{(parseFloat(amount || 0) + lateFeeValue).toLocaleString()}
                  </span>
                </div>
              )}
              {paymentCategory === 'rent' && paymentStatus === 'partial' && (
                <div className="flex justify-between items-baseline gap-3 mt-2 text-orange-700 dark:text-orange-300">
                  <span className="text-sm font-medium">Remaining balance</span>
                  <span className="font-semibold shrink-0">₱{parseFloat(remainingBalance || 0).toLocaleString()}</span>
                </div>
              )}
              {paymentCategory === 'rent' && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {isBalancePayment && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                      Balance
                    </span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full ${paymentStatus === 'full'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-orange-100 text-orange-700'
                    }`}>
                    {paymentStatus === 'full' ? 'Full' : 'Partial'}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${timingStatus === 'ontime'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-yellow-100 text-yellow-700'
                    }`}>
                    {timingStatus === 'ontime' ? 'On-time' : 'Late'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loading}
              >
                {loading ? 'Recording...' : 'Confirm Payment'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

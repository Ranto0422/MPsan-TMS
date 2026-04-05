import React, { useState, useEffect } from 'react'
import { authFetch } from '../auth.js'

/**
 * Modal to compose and send a reminder message to a single tenant via SMS, email, or both.
 * Prefilled with tenant name, monthly rent, due date; user can edit, then Send -> Confirm Yes -> send.
 */
export default function SendReminderModal({ open, onClose, tenantId, tenantName, tenantEmail, monthlyRent, dueDate, onSuccess, overdueMessage }) {
  const [messageText, setMessageText] = useState('')
  const [channel, setChannel] = useState('sms')
  const [step, setStep] = useState('compose') // 'compose' | 'confirm' | 'success'
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [successMessage, setSuccessMessage] = useState(null)

  useEffect(() => {
    if (open) {
      const rentStr = typeof monthlyRent === 'number' ? monthlyRent.toLocaleString('en-PH', { minimumFractionDigits: 2 }) : (monthlyRent ?? '0')
      const defaultMsg = overdueMessage
        ? overdueMessage
        : `Good day ${tenantName || 'Tenant'}! This is a reminder that your monthly rent of ₱${rentStr} is due on ${dueDate || 'the due date'}. Please settle on or before the due date. Thank you!`
      setMessageText(defaultMsg)
      setChannel('sms')
      setStep('compose')
      setError(null)
      setSuccessMessage(null)
    }
  }, [open, tenantName, monthlyRent, dueDate, overdueMessage])

  const handleSend = () => {
    if (!messageText.trim()) {
      setError('Please enter a message.')
      return
    }
    setError(null)
    setStep('confirm')
  }

  const handleConfirmYes = async () => {
    if (!tenantId) {
      setError('Tenant ID is missing.')
      return
    }
    setSending(true)
    setError(null)
    try {
      const res = await authFetch('/api/messages/send/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: messageText.trim(),
          tenant_ids: [tenantId],
          channel: channel,
        }),
      })
      const data = res.ok ? await res.json().catch(() => ({})) : await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.detail || data?.message || `Send failed (${res.status})`)
        return
      }
      const parts = []
      if (data?.recipients > 0) parts.push(`SMS sent`)
      if (data?.email_recipients > 0) parts.push(`Email sent`)
      setSuccessMessage(parts.length > 0 ? parts.join(' & ') + ' successfully!' : 'Message sent successfully!')
      setStep('success')
      if (typeof onSuccess === 'function') onSuccess()
    } catch (e) {
      setError(e?.message || 'Failed to send message.')
    } finally {
      setSending(false)
    }
  }

  const handleConfirmNo = () => {
    setStep('compose')
  }

  if (!open) return null

  const hasEmail = !!tenantEmail

  const channelBtn = (value, label) => (
    <button
      type="button"
      onClick={() => setChannel(value)}
      disabled={value !== 'sms' && !hasEmail}
      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
        channel === value
          ? 'bg-blue-600 text-white border-blue-600'
          : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
      } ${value !== 'sms' && !hasEmail ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {step === 'compose' ? (overdueMessage ? 'Send overdue reminder' : 'Send reminder') : step === 'confirm' ? 'Confirm send' : 'Done'}
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          {successMessage && (
            <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 flex items-center gap-3">
              <svg className="w-6 h-6 text-green-600 dark:text-green-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="text-sm font-medium text-green-800 dark:text-green-200">{successMessage}</span>
            </div>
          )}
          {step === 'compose' && (
            <>
              {/* Channel selector */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Send via</label>
                <div className="flex gap-2">
                  {channelBtn('sms', 'SMS')}
                  {channelBtn('email', 'Email')}
                  {channelBtn('both', 'Both')}
                </div>
                {!hasEmail && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">Email unavailable — tenant has no email on file.</p>
                )}
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-400">
                {channel === 'sms' ? 'Message will be sent via SMS.' :
                 channel === 'email' ? 'Reminder will be sent via email.' :
                 'Reminder will be sent via both SMS and email.'}
                {' '}Edit the text below if needed, then press Send.
              </p>
              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
                placeholder="Enter your message..."
              />
            </>
          )}
          {step === 'confirm' && (
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Are you sure you want to send this message to {tenantName || 'this tenant'} via {channel === 'both' ? 'SMS and email' : channel.toUpperCase()}?
            </p>
          )}
        </div>
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex flex-wrap gap-2 justify-end shrink-0">
          {step === 'compose' && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSend}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium"
              >
                Send
              </button>
            </>
          )}
          {step === 'confirm' && (
            <>
              <button
                type="button"
                onClick={handleConfirmNo}
                disabled={sending}
                className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                No
              </button>
              <button
                type="button"
                onClick={handleConfirmYes}
                disabled={sending}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50"
              >
                {sending ? 'Sending…' : 'Yes'}
              </button>
            </>
          )}
          {step === 'success' && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

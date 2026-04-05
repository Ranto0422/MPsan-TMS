import { useState, useRef, useEffect } from 'react'
import { authFetch } from '../auth.js'
import { usePushNotifications } from '../usePushNotifications.js'

const MESSAGE_DAY_OPTIONS = [
	{ value: 7, label: '7 days before', description: 'Early reminder' },
	{ value: 5, label: '5 days before', description: '' },
	{ value: 3, label: '3 days before', description: '' },
	{ value: 2, label: '2 days before', description: '' },
	{ value: 1, label: '1 day before', description: 'Final reminder' },
	{ value: 0, label: 'On due date', description: 'Due day notice' },
]

const PLACEHOLDERS = [
	{ key: '[Tenant Name]', description: 'Tenant\'s full name' },
	{ key: '[Payment Amount]', description: 'Monthly rent amount' },
	{ key: '[Days Left]', description: 'Days until due date' },
	{ key: '[Due Date]', description: 'Payment due date' },
	{ key: '[Room Number]', description: 'Room/unit number' },
	{ key: '[Balance]', description: 'Outstanding balance' },
]

export default function AutomatedMessageSettings({ property, onBack, embedded = false }) {
	const [messageTemplate, setMessageTemplate] = useState(
		'Good Day [Tenant Name]! This is a reminder that your rent payment of ₱[Payment Amount] is due in [Days Left] days. Please settle on or before [Due Date]. Thank you!'
	)
	const [messageDays, setMessageDays] = useState(new Set([7, 2, 0]))
	const [hour, setHour] = useState(8)
	const [minute, setMinute] = useState(0)
	const [ampm, setAmpm] = useState('AM')
	const [automatedMessaging, setAutomatedMessaging] = useState(true)
	const [pwaNotificationsEnabled, setPwaNotificationsEnabled] = useState(true)
	const [smsEnabled, setSmsEnabled] = useState(true)
	const [emailEnabled, setEmailEnabled] = useState(true)
	const [emailCopyToOwner, setEmailCopyToOwner] = useState(true)
	const [ownerEmail, setOwnerEmail] = useState('')
	const [emailSubjectTemplate, setEmailSubjectTemplate] = useState('Rent Payment Reminder - [Room Number]')
	const [sendingNow, setSendingNow] = useState(false)
	const [sendNowError, setSendNowError] = useState(null)
	const [sendNowSuccess, setSendNowSuccess] = useState(null)
	const [sendNowChannel, setSendNowChannel] = useState('sms')
	const [saving, setSaving] = useState(false)
	const [saveSuccess, setSaveSuccess] = useState(false)
	const [saveError, setSaveError] = useState(null)
	const [loadingSettings, setLoadingSettings] = useState(true)
	const [generationStats, setGenerationStats] = useState(null)
	const textareaRef = useRef(null)

	// Test messaging: send to your phone/email today at a time you select
	const [testPhone, setTestPhone] = useState('')
	const [testEmail, setTestEmail] = useState('')
	const [testHour, setTestHour] = useState(14)
	const [testMinute, setTestMinute] = useState(30)
	const [testAmpm, setTestAmpm] = useState('PM')
	const [testSendingNow, setTestSendingNow] = useState(false)
	const [testSendError, setTestSendError] = useState(null)
	const [testSendSuccess, setTestSendSuccess] = useState(null)
	const [schedulingTest, setSchedulingTest] = useState(false)
	const [scheduleTestError, setScheduleTestError] = useState(null)
	const [scheduleTestSuccess, setScheduleTestSuccess] = useState(null)

	// SMS Gateway Diagnostic
	const [diagLoading, setDiagLoading] = useState(false)
	const [diagResult, setDiagResult] = useState(null)
	const [diagError, setDiagError] = useState(null)
	const [testSendDiagLoading, setTestSendDiagLoading] = useState(false)
	const [testSendDiagResult, setTestSendDiagResult] = useState(null)

	// Scheduled messages status (test messages)
	const [scheduledLoading, setScheduledLoading] = useState(false)
	const [scheduledData, setScheduledData] = useState(null)
	const [processingScheduled, setProcessingScheduled] = useState(false)
	const [processResult, setProcessResult] = useState(null)

	// Automated scheduled messages
	const [automatedMessagesLoading, setAutomatedMessagesLoading] = useState(false)
	const [automatedMessagesData, setAutomatedMessagesData] = useState(null)
	const [processingAutomated, setProcessingAutomated] = useState(false)
	const [automatedProcessResult, setAutomatedProcessResult] = useState(null)

	// Per-tenant schedules
	const [tenantSchedulesLoading, setTenantSchedulesLoading] = useState(false)
	const [tenantSchedulesData, setTenantSchedulesData] = useState(null)
	const [editingScheduleRoom, setEditingScheduleRoom] = useState(null)
	const [editScheduleDays, setEditScheduleDays] = useState(new Set())
	const [editScheduleHour, setEditScheduleHour] = useState(9)
	const [editScheduleMinute, setEditScheduleMinute] = useState(0)
	const [editScheduleAmpm, setEditScheduleAmpm] = useState('AM')
	const [savingSchedule, setSavingSchedule] = useState(false)

	// ML Predictions
	const [mlPredictions, setMlPredictions] = useState({})
	const [mlPredicting, setMlPredicting] = useState(false)
	const [mlBatchUpdating, setMlBatchUpdating] = useState(false)
	const [mlBatchResult, setMlBatchResult] = useState(null)

	// Push Notifications
	const pushNotifications = usePushNotifications()
	const [pushTestLoading, setPushTestLoading] = useState(false)
	const [pushTestResult, setPushTestResult] = useState(null)

	// Sub-tab navigation
	const [subTab, setSubTab] = useState('settings') // 'settings' | 'monitor' | 'test'

	// Detect iOS/iPadOS
	const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
	const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
		window.navigator.standalone === true

	// Load existing settings on mount
	useEffect(() => {
		if (!property?.id) return

		const loadSettings = async () => {
			setLoadingSettings(true)
			try {
				const res = await authFetch(`/api/messages/automated-settings/${property.id}/`)
				if (res.ok) {
					const data = await res.json()
					// Update state with loaded settings
					if (data.message_template) {
						setMessageTemplate(data.message_template)
					}
					if (data.message_days) {
						setMessageDays(new Set(data.message_days))
					}
					if (typeof data.enabled === 'boolean') {
						setAutomatedMessaging(data.enabled)
					}
					if (typeof data.pwa_notifications_enabled === 'boolean') {
						setPwaNotificationsEnabled(data.pwa_notifications_enabled)
					}
					if (typeof data.sms_enabled === 'boolean') {
						setSmsEnabled(data.sms_enabled)
					}
					if (typeof data.email_enabled === 'boolean') {
						setEmailEnabled(data.email_enabled)
					}
					if (typeof data.email_copy_to_owner === 'boolean') {
						setEmailCopyToOwner(data.email_copy_to_owner)
					}
					if (data.owner_email !== undefined) {
						setOwnerEmail(data.owner_email || '')
					}
					if (data.email_subject_template) {
						setEmailSubjectTemplate(data.email_subject_template)
					}
					// Handle time - convert from 24h to 12h format
					if (data.formatted_time) {
						setHour(data.formatted_time.hour)
						setMinute(data.formatted_time.minute)
						setAmpm(data.formatted_time.ampm)
					} else if (data.send_hour !== undefined) {
						let h = data.send_hour
						let ap = 'AM'
						if (h >= 12) {
							ap = 'PM'
							if (h > 12) h -= 12
						}
						if (h === 0) h = 12
						setHour(h)
						setMinute(data.send_minute || 0)
						setAmpm(ap)
					}
				}
			} catch (e) {
				console.error('Failed to load automated message settings:', e)
			} finally {
				setLoadingSettings(false)
			}
		}

		loadSettings()
	}, [property?.id])

	const handlePushTest = async () => {
		setPushTestLoading(true)
		setPushTestResult(null)
		const result = await pushNotifications.sendTest(
			'Test Notification',
			'This is a test push notification from MP-SAN TMS!'
		)
		setPushTestResult(result)
		setPushTestLoading(false)
	}

	const toggleDay = (value) => {
		setMessageDays(prev => {
			const next = new Set(prev)
			if (next.has(value)) next.delete(value)
			else next.add(value)
			return next
		})
	}

	const insertPlaceholder = (placeholder) => {
		const textarea = textareaRef.current
		if (!textarea) return

		const start = textarea.selectionStart
		const end = textarea.selectionEnd
		const text = messageTemplate
		const before = text.substring(0, start)
		const after = text.substring(end)

		setMessageTemplate(before + placeholder + after)

		// Set cursor position after inserted placeholder
		setTimeout(() => {
			textarea.focus()
			textarea.selectionStart = textarea.selectionEnd = start + placeholder.length
		}, 0)
	}

	const handleSendNow = async () => {
		const text = (messageTemplate || '').trim()
		if (!text) {
			setSendNowError('Please enter a message to send.')
			return
		}
		if (!property?.id) {
			setSendNowError('Property is required.')
			return
		}
		setSendNowError(null)
		setSendNowSuccess(null)
		setSendingNow(true)
		try {
			const res = await authFetch('/api/messages/send/', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: text,
					property_id: property.id,
					channel: sendNowChannel,
				}),
			})
			const data = res.ok ? await res.json().catch(() => ({})) : await res.json().catch(() => ({}))
			if (!res.ok) {
				const detail = data?.detail || data?.message || `Send failed (${res.status})`
				const extra = data?.error ? ` ${data.error}` : ''
				setSendNowError(detail + extra)
				return
			}
			const parts = []
			if (data?.recipients > 0) parts.push(`SMS sent to ${data.recipients} tenant(s)`)
			if (data?.email_recipients > 0) parts.push(`Email sent to ${data.email_recipients} tenant(s)`)
			setSendNowSuccess(parts.length > 0 ? parts.join(', ') + '!' : `Message sent to ${data?.recipients ?? 0} tenant(s)!`)
			setTimeout(() => setSendNowSuccess(null), 5000)
		} catch (e) {
			setSendNowError(e?.message || 'Failed to send message.')
		} finally {
			setSendingNow(false)
		}
	}

	const handleSaveSettings = async () => {
		if (!property?.id) {
			setSaveError('Property is required.')
			return
		}

		setSaving(true)
		setSaveError(null)
		setSaveSuccess(false)
		setGenerationStats(null)

		try {
			const res = await authFetch(`/api/messages/automated-settings/${property.id}/`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					enabled: automatedMessaging,
					pwa_notifications_enabled: pwaNotificationsEnabled,
					sms_enabled: smsEnabled,
					email_enabled: emailEnabled,
					email_copy_to_owner: emailCopyToOwner,
					owner_email: ownerEmail,
					email_subject_template: emailSubjectTemplate,
					message_template: messageTemplate,
					message_days: Array.from(messageDays),
					hour: hour,
					minute: minute,
					ampm: ampm,
					regenerate_messages: true,
				}),
			})

			const data = await res.json().catch(() => ({}))

			if (!res.ok) {
				const detail = data?.detail || data?.message || `Save failed (${res.status})`
				setSaveError(detail)
				return
			}

			setSaveSuccess(true)

			// Show generation stats if available
			if (data.generation_stats) {
				setGenerationStats(data.generation_stats)
			}

			setTimeout(() => {
				setSaveSuccess(false)
				setGenerationStats(null)
			}, 8000)
		} catch (e) {
			setSaveError(e?.message || 'Failed to save settings.')
		} finally {
			setSaving(false)
		}
	}

	// Check SMS gateway status (GET diagnostic)
	const handleCheckGateway = async () => {
		setDiagLoading(true)
		setDiagError(null)
		setDiagResult(null)
		try {
			const res = await authFetch('/api/messages/diagnostic/', { method: 'GET' })
			const data = await res.json().catch(() => ({}))
			setDiagResult(data)
		} catch (e) {
			setDiagError(e?.message || 'Failed to check gateway.')
		} finally {
			setDiagLoading(false)
		}
	}

	// Fetch scheduled messages status
	const handleFetchScheduled = async () => {
		setScheduledLoading(true)
		try {
			const res = await authFetch('/api/messages/scheduled/', { method: 'GET' })
			const data = await res.json().catch(() => ({}))
			setScheduledData(data)
		} catch (e) {
			setScheduledData({ error: e?.message || 'Failed to fetch' })
		} finally {
			setScheduledLoading(false)
		}
	}

	// Manually process scheduled messages
	const handleProcessScheduled = async () => {
		setProcessingScheduled(true)
		setProcessResult(null)
		try {
			const res = await authFetch('/api/messages/scheduled/', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
			})
			const data = await res.json().catch(() => ({}))
			setProcessResult(data)
			// Refresh list
			handleFetchScheduled()
		} catch (e) {
			setProcessResult({ error: e?.message || 'Failed to process' })
		} finally {
			setProcessingScheduled(false)
		}
	}

	// Clear all pending scheduled messages
	const [clearingScheduled, setClearingScheduled] = useState(false)
	const handleClearScheduled = async () => {
		if (!confirm('Delete all pending scheduled messages?')) return
		setClearingScheduled(true)
		setProcessResult(null)
		try {
			const res = await authFetch('/api/messages/scheduled/', {
				method: 'DELETE',
			})
			const data = await res.json().catch(() => ({}))
			setProcessResult(data)
			// Refresh list
			handleFetchScheduled()
		} catch (e) {
			setProcessResult({ error: e?.message || 'Failed to clear' })
		} finally {
			setClearingScheduled(false)
		}
	}

	// Fetch automated scheduled messages
	const handleFetchAutomatedMessages = async () => {
		setAutomatedMessagesLoading(true)
		try {
			const url = property?.id
				? `/api/messages/automated/?property_id=${property.id}&status=pending`
				: '/api/messages/automated/?status=pending'
			const res = await authFetch(url, { method: 'GET' })
			const data = await res.json().catch(() => ({}))
			setAutomatedMessagesData(data)
		} catch (e) {
			setAutomatedMessagesData({ error: e?.message || 'Failed to fetch' })
		} finally {
			setAutomatedMessagesLoading(false)
		}
	}

	// Manually process automated messages
	const handleProcessAutomated = async () => {
		setProcessingAutomated(true)
		setAutomatedProcessResult(null)
		try {
			const res = await authFetch('/api/messages/automated/', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					regenerate: false,
					property_id: property?.id
				}),
			})
			const data = await res.json().catch(() => ({}))
			setAutomatedProcessResult(data)
			// Refresh list
			handleFetchAutomatedMessages()
		} catch (e) {
			setAutomatedProcessResult({ error: e?.message || 'Failed to process' })
		} finally {
			setProcessingAutomated(false)
		}
	}

	// Cancel all pending automated messages
	const [clearingAutomated, setClearingAutomated] = useState(false)
	const handleClearAutomated = async () => {
		if (!confirm('Cancel all pending automated messages?')) return
		setClearingAutomated(true)
		setAutomatedProcessResult(null)
		try {
			const url = property?.id
				? `/api/messages/automated/?property_id=${property.id}`
				: '/api/messages/automated/'
			const res = await authFetch(url, {
				method: 'DELETE',
			})
			const data = await res.json().catch(() => ({}))
			setAutomatedProcessResult(data)
			// Refresh list
			handleFetchAutomatedMessages()
		} catch (e) {
			setAutomatedProcessResult({ error: e?.message || 'Failed to cancel' })
		} finally {
			setClearingAutomated(false)
		}
	}

	// Fetch tenant schedules
	const handleFetchTenantSchedules = async () => {
		if (!property?.id) return
		setTenantSchedulesLoading(true)
		setMlPredictions({}) // Clear previous predictions
		try {
			const res = await authFetch(`/api/messages/tenant-schedules/${property.id}/`)
			const data = await res.json().catch(() => ({}))
			setTenantSchedulesData(data)
			// Automatically fetch ML predictions for all tenants
			if (data.tenants && data.tenants.length > 0) {
				await handleFetchAllPredictions(data.tenants)
			}
		} catch (e) {
			setTenantSchedulesData({ error: e?.message || 'Failed to fetch' })
		} finally {
			setTenantSchedulesLoading(false)
		}
	}

	// Start editing a tenant's schedule
	const handleStartEditSchedule = (tenant) => {
		setEditingScheduleRoom(tenant.room_number)
		setEditScheduleDays(new Set(tenant.message_days || []))
		// Parse time
		const hour24 = tenant.send_hour ?? 9
		const minute = tenant.send_minute ?? 0
		const ampm = hour24 >= 12 ? 'PM' : 'AM'
		let hour12 = hour24 > 12 ? hour24 - 12 : hour24
		if (hour12 === 0) hour12 = 12
		setEditScheduleHour(hour12)
		setEditScheduleMinute(minute)
		setEditScheduleAmpm(ampm)
	}

	const handleCancelEditSchedule = () => {
		setEditingScheduleRoom(null)
	}

	const handleToggleScheduleDay = (day) => {
		setEditScheduleDays(prev => {
			const next = new Set(prev)
			if (next.has(day)) {
				next.delete(day)
			} else {
				next.add(day)
			}
			return next
		})
	}

	const handleSaveTenantSchedule = async (roomNumber, tenantName) => {
		setSavingSchedule(true)
		try {
			const res = await authFetch('/api/messages/tenant-schedules/', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					property: property.id,
					room_number: roomNumber,
					tenant_name: tenantName,
					message_days: Array.from(editScheduleDays).sort((a, b) => b - a),
					hour: editScheduleHour,
					minute: editScheduleMinute,
					ampm: editScheduleAmpm,
					use_custom_schedule: true
				})
			})
			if (res.ok) {
				setEditingScheduleRoom(null)
				handleFetchTenantSchedules()
			} else {
				const err = await res.json().catch(() => ({}))
				alert(err.detail || 'Failed to save schedule')
			}
		} catch (e) {
			alert(e?.message || 'Failed to save schedule')
		} finally {
			setSavingSchedule(false)
		}
	}

	const handleResetTenantSchedule = async (roomNumber) => {
		if (!confirm('Reset to property defaults?')) return
		try {
			const res = await authFetch(`/api/messages/tenant-schedules/?property_id=${property.id}&room_number=${encodeURIComponent(roomNumber)}`, {
				method: 'DELETE'
			})
			if (res.ok) {
				handleFetchTenantSchedules()
			}
		} catch (e) {
			alert(e?.message || 'Failed to reset')
		}
	}

	// ML Prediction - Fetch all predictions
	const handleFetchAllPredictions = async (tenants) => {
		if (!property?.id || !tenants?.length) return
		setMlPredicting(true)
		try {
			const predictions = {}
			// Fetch predictions for all tenants in parallel
			const promises = tenants.map(async (tenant) => {
				try {
					const res = await authFetch('/api/ml/predict-notification-time/', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							property_id: property.id,
							room_number: tenant.room_number,
							tenant_layout_id: tenant.tenant_layout_id || tenant.tenant_id
						})
					})
					if (res.ok) {
						const data = await res.json()
						predictions[tenant.room_number] = data
					}
				} catch (e) {
					// Silently fail for individual predictions
					console.error(`Failed to predict for ${tenant.room_number}:`, e)
				}
			})
			await Promise.all(promises)
			setMlPredictions(predictions)
		} catch (e) {
			console.error('Failed to fetch ML predictions:', e)
		} finally {
			setMlPredicting(false)
		}
	}

	// ML Prediction - Single tenant
	const handlePredictTenant = async (tenant) => {
		if (!property?.id) return
		setMlPredicting(true)
		try {
			const res = await authFetch('/api/ml/predict-notification-time/', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					property_id: property.id,
					room_number: tenant.room_number,
					tenant_layout_id: tenant.tenant_layout_id || tenant.tenant_id
				})
			})
			if (res.ok) {
				const data = await res.json()
				setMlPredictions(prev => ({
					...prev,
					[tenant.room_number]: data
				}))
			} else {
				const err = await res.json().catch(() => ({}))
				alert(err.detail || 'ML prediction failed')
			}
		} catch (e) {
			alert(e?.message || 'Failed to get ML prediction')
		} finally {
			setMlPredicting(false)
		}
	}

	// ML Prediction - Apply prediction to tenant
	const handleApplyMlPrediction = async (tenant) => {
		const prediction = mlPredictions[tenant.room_number]
		if (!prediction) return
		
		const hour24 = prediction.optimal_hour
		const ampm = hour24 >= 12 ? 'PM' : 'AM'
		let hour12 = hour24 > 12 ? hour24 - 12 : hour24
		if (hour12 === 0) hour12 = 12
		
		setEditingScheduleRoom(tenant.room_number)
		setEditScheduleHour(hour12)
		setEditScheduleMinute(0)
		setEditScheduleAmpm(ampm)
		// Keep existing message days or use defaults
		setEditScheduleDays(new Set(tenant.message_days || []))
	}

	// ML Prediction - Batch update all tenants
	const handleBatchUpdateMl = async () => {
		if (!property?.id) return
		if (!confirm('Apply all ML predictions to tenant schedules? This will update their notification times.')) return
		
		setMlBatchUpdating(true)
		setMlBatchResult(null)
		try {
			const res = await authFetch('/api/ml/batch-update-schedules/', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					property_id: property.id,
					min_confidence: 0.5 // Default minimum confidence
				})
			})
			if (res.ok) {
				const data = await res.json()
				setMlBatchResult(data)
				// Refresh tenant schedules
				handleFetchTenantSchedules()
			} else {
				const err = await res.json().catch(() => ({}))
				setMlBatchResult({ error: err.detail || 'Batch update failed' })
			}
		} catch (e) {
			setMlBatchResult({ error: e?.message || 'Failed to batch update' })
		} finally {
			setMlBatchUpdating(false)
		}
	}

	// Send test message immediately to your phone/email using diagnostic endpoint (shows full details)
	const handleSendTestNow = async () => {
		const phone = (testPhone || '').trim()
		const email = (testEmail || '').trim()
		if (!phone && !email) {
			setTestSendError('Enter a phone number or email to receive the test.')
			return
		}
		const text = (messageTemplate || '').trim()
		if (!text) {
			setTestSendError('Message template is empty.')
			return
		}
		setTestSendError(null)
		setTestSendSuccess(null)
		setTestSendDiagResult(null)
		setTestSendingNow(true)
		try {
			const payload = { message: text }
			if (phone) payload.phone = phone
			if (email) payload.email = email
			const res = await authFetch('/api/messages/diagnostic/', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			})
			const data = await res.json().catch(() => ({}))
			setTestSendDiagResult(data)
			if (res.ok) {
				const channels = [phone && 'SMS', email && 'email'].filter(Boolean).join(' & ')
				setTestSendSuccess(`Test ${channels} sent! Check your ${phone ? 'phone' : ''}${phone && email ? ' and ' : ''}${email ? 'inbox' : ''} in a moment.`)
			} else {
				setTestSendError(data?.detail || `Send failed (${res.status})`)
			}
		} catch (e) {
			setTestSendError(e?.message || 'Failed to send test.')
		} finally {
			setTestSendingNow(false)
		}
	}

	// Schedule test message for today at the selected time
	const handleScheduleTest = async () => {
		const phone = (testPhone || '').trim()
		const email = (testEmail || '').trim()
		if (!phone && !email) {
			setScheduleTestError('Enter a phone number or email to receive the test.')
			return
		}
		const text = (messageTemplate || '').trim()
		if (!text) {
			setScheduleTestError('Message template is empty.')
			return
		}
		const today = new Date()
		let h = testHour
		if (testAmpm === 'PM' && h !== 12) h += 12
		if (testAmpm === 'AM' && h === 12) h = 0
		const sendAt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, testMinute, 0)
		if (sendAt <= new Date()) {
			setScheduleTestError('Please select a time in the future.')
			return
		}
		const sendAtISO = sendAt.toISOString()
		setScheduleTestError(null)
		setScheduleTestSuccess(null)
		setSchedulingTest(true)
		try {
			const payload = {
				message: text,
				send_at: sendAtISO,
			}
			if (phone) payload.test_phone = phone
			if (email) payload.test_email = email
			const res = await authFetch('/api/messages/schedule-test/', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			})
			const data = res.ok ? await res.json().catch(() => ({})) : await res.json().catch(() => ({}))
			if (!res.ok) {
				setScheduleTestError(data?.detail || data?.message || `Schedule failed (${res.status})`)
				return
			}
			const channels = [phone && 'SMS', email && 'email'].filter(Boolean).join(' & ')
			setScheduleTestSuccess(`Test ${channels} scheduled for today at ${testHour}:${String(testMinute).padStart(2, '0')} ${testAmpm}. You will receive the message at that time.`)
			setTimeout(() => setScheduleTestSuccess(null), 8000)
		} catch (e) {
			setScheduleTestError(e?.message || 'Failed to schedule test.')
		} finally {
			setSchedulingTest(false)
		}
	}

	const hours = Array.from({ length: 12 }, (_, i) => i + 1)
	const minutes = Array.from({ length: 60 }, (_, i) => i)

	// Preview message with sample data
	const previewMessage = messageTemplate
		.replace('[Tenant Name]', 'Juan Dela Cruz')
		.replace('[Payment Amount]', '5,000')
		.replace('[Days Left]', '3')
		.replace('[Due Date]', 'February 15, 2026')
		.replace('[Room Number]', 'M4')
		.replace('[Balance]', '0')

	const content = (
		<div className="space-y-6">
			{/* Loading indicator */}
			{loadingSettings && (
				<div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl flex items-center gap-3">
					<svg className="animate-spin w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24">
						<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
						<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
					</svg>
					<p className="text-sm text-blue-800 dark:text-blue-200">Loading settings...</p>
				</div>
			)}

			{/* Sub-tab Navigation */}
			<div className="bg-gray-100/50 dark:bg-gray-700/50 p-1.5 rounded-xl flex relative shadow-inner max-w-full">
				<div
					className={`absolute top-1.5 bottom-1.5 rounded-lg bg-white dark:bg-gray-600 shadow-sm transition-all duration-300 ease-out ${
						subTab === 'settings'
							? 'left-1.5 w-[calc(33.333%-4px)]'
							: subTab === 'monitor'
							? 'left-[calc(33.333%+1px)] w-[calc(33.333%-4px)]'
							: 'left-[calc(66.666%+2px)] w-[calc(33.333%-4px)]'
					}`}
					aria-hidden="true"
				/>
				<button
					type="button"
					onClick={() => setSubTab('settings')}
					className={`relative z-10 flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors duration-200 flex items-center justify-center gap-2 ${
						subTab === 'settings'
							? 'text-blue-600 dark:text-white'
							: 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
					}`}
				>
					<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
					</svg>
					Settings
				</button>
				<button
					type="button"
					onClick={() => setSubTab('monitor')}
					className={`relative z-10 flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors duration-200 flex items-center justify-center gap-2 ${
						subTab === 'monitor'
							? 'text-blue-600 dark:text-white'
							: 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
					}`}
				>
					<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
					</svg>
					Monitor
				</button>
				<button
					type="button"
					onClick={() => setSubTab('test')}
					className={`relative z-10 flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors duration-200 flex items-center justify-center gap-2 ${
						subTab === 'test'
							? 'text-blue-600 dark:text-white'
							: 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
					}`}
				>
					<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
					</svg>
					Test & Diagnose
				</button>
			</div>

			{/* ===== SETTINGS TAB ===== */}
			{subTab === 'settings' && (
			<>

			{/* Warning note */}
			<div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl flex items-start gap-3">
				<svg className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
					<path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
				</svg>
				<p className="text-sm text-amber-800 dark:text-amber-200">
					<strong>Note:</strong> Automated messages will be sent to all tenants based on their individual payment due dates.
				</p>
			</div>

			{/* Master Toggle */}
			<div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
				<div className="flex items-center justify-between">
					<div>
						<h3 className="text-base font-semibold text-gray-900 dark:text-white">Automated Messaging</h3>
						<p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
							Automatically send payment reminders to tenants
						</p>
					</div>
					<button
						type="button"
						role="switch"
						aria-checked={automatedMessaging}
						onClick={() => setAutomatedMessaging(v => !v)}
						className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${automatedMessaging ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
							}`}
					>
						<span className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition ${automatedMessaging ? 'translate-x-5' : 'translate-x-0'
							}`} />
					</button>
				</div>

				{/* Notification Channel Toggles */}
				{automatedMessaging && (
					<div className="mt-5 pt-5 border-t border-gray-200 dark:border-gray-700 space-y-4">
						<p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">
							Notification Channels
						</p>

						{/* PWA Push Notifications Toggle */}
						<div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
							<div className="flex items-center gap-3">
								<div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
									<svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
									</svg>
								</div>
								<div>
									<p className="text-sm font-medium text-gray-900 dark:text-white">PWA Push Notifications</p>
									<p className="text-xs text-gray-500 dark:text-gray-400">
										Get due date reminders on your device (no SMS cost)
									</p>
								</div>
							</div>
							<button
								type="button"
								role="switch"
								aria-checked={pwaNotificationsEnabled}
								onClick={() => setPwaNotificationsEnabled(v => !v)}
								className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${pwaNotificationsEnabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
									}`}
							>
								<span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${pwaNotificationsEnabled ? 'translate-x-5' : 'translate-x-0'
									}`} />
							</button>
						</div>

						{/* SMS to Tenants Toggle */}
						<div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
							<div className="flex items-center gap-3">
								<div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center">
									<svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
									</svg>
								</div>
								<div>
									<p className="text-sm font-medium text-gray-900 dark:text-white">SMS to Tenants</p>
									<p className="text-xs text-gray-500 dark:text-gray-400">
										Send reminders to tenant phones via SMS gateway
									</p>
								</div>
							</div>
							<button
								type="button"
								role="switch"
								aria-checked={smsEnabled}
								onClick={() => setSmsEnabled(v => !v)}
								className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${smsEnabled ? 'bg-green-600' : 'bg-gray-300 dark:bg-gray-600'
									}`}
							>
								<span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${smsEnabled ? 'translate-x-5' : 'translate-x-0'
									}`} />
							</button>
						</div>

						{/* Email Notifications Toggle */}
						<div className="flex items-center justify-between p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
							<div className="flex items-center gap-3">
								<div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center">
									<svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
									</svg>
								</div>
								<div>
									<p className="text-sm font-medium text-gray-900 dark:text-white">Email Notifications</p>
									<p className="text-xs text-gray-500 dark:text-gray-400">
										Send reminders to tenants with email addresses
									</p>
								</div>
							</div>
							<button
								type="button"
								role="switch"
								aria-checked={emailEnabled}
								onClick={() => setEmailEnabled(v => !v)}
								className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${emailEnabled ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'
									}`}
							>
								<span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${emailEnabled ? 'translate-x-5' : 'translate-x-0'
									}`} />
							</button>
						</div>

						{/* Email Settings - visible when email is enabled */}
						{emailEnabled && (
							<div className="space-y-3 p-3 bg-purple-50/50 dark:bg-purple-900/10 rounded-lg border border-purple-200 dark:border-purple-800">
								{/* CC Owner Toggle */}
								<div className="flex items-center justify-between">
									<div>
										<p className="text-sm font-medium text-gray-900 dark:text-white">CC Owner/Manager</p>
										<p className="text-xs text-gray-500 dark:text-gray-400">
											Send a copy of tenant emails to owner
										</p>
									</div>
									<button
										type="button"
										role="switch"
										aria-checked={emailCopyToOwner}
										onClick={() => setEmailCopyToOwner(v => !v)}
										className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${emailCopyToOwner ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'
											}`}
									>
										<span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${emailCopyToOwner ? 'translate-x-5' : 'translate-x-0'
											}`} />
									</button>
								</div>

								{/* Owner Email Input */}
								{emailCopyToOwner && (
									<div>
										<label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
											Owner/Manager Email
										</label>
										<input
											type="email"
											value={ownerEmail}
											onChange={e => setOwnerEmail(e.target.value)}
											placeholder="owner@example.com"
											className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
										/>
									</div>
								)}

								{/* Email Subject Template */}
								<div>
									<label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
										Email Subject Template
									</label>
									<input
										type="text"
										value={emailSubjectTemplate}
										onChange={e => setEmailSubjectTemplate(e.target.value)}
										placeholder="Rent Payment Reminder - [Room Number]"
										className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
									/>
									<p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
										Use placeholders: [Tenant Name], [Room Number], [Days Left], [Due Date]
									</p>
								</div>
							</div>
						)}

						{/* Info about PWA notifications */}
						{pwaNotificationsEnabled && !pushNotifications.isSubscribed && (
							<div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
								<div className="flex items-start gap-2">
									<svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
									</svg>
									<div>
										<p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
											Enable Push Notifications
										</p>
										<p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
											You need to subscribe to push notifications to receive due date reminders on this device.
										</p>
										<button
											type="button"
											onClick={() => pushNotifications.subscribe()}
											disabled={pushNotifications.loading}
											className="mt-2 px-3 py-1.5 text-xs font-medium bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors disabled:opacity-50"
										>
											{pushNotifications.loading ? 'Subscribing...' : 'Enable Notifications'}
										</button>
									</div>
								</div>
							</div>
						)}

						{/* Warning if both are disabled */}
						{!pwaNotificationsEnabled && !smsEnabled && (
							<div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
								<div className="flex items-center gap-2 text-red-700 dark:text-red-300">
									<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
									</svg>
									<p className="text-sm">
										Both channels are disabled. No notifications will be sent.
									</p>
								</div>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Message Template */}
			<div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 transition-opacity ${!automatedMessaging ? 'opacity-50 pointer-events-none' : ''}`}>
				<h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Message Template</h3>

				<textarea
					ref={textareaRef}
					value={messageTemplate}
					onChange={e => setMessageTemplate(e.target.value)}
					className="w-full p-4 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					rows={4}
					placeholder="Type your message template..."
				/>

				{/* Placeholders */}
				<div className="mt-4">
					<p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">
						Click to insert placeholder:
					</p>
					<div className="flex flex-wrap gap-2">
						{PLACEHOLDERS.map(({ key, description }) => (
							<button
								key={key}
								type="button"
								onClick={() => insertPlaceholder(key)}
								className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
								title={description}
							>
								{key}
							</button>
						))}
					</div>
				</div>

				{/* Preview */}
				<div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
					<p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">
						Preview:
					</p>
					<div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
						<p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
							{previewMessage || 'Your message preview will appear here...'}
						</p>
					</div>
				</div>
			</div>

			{/* Schedule */}
			<div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 transition-opacity ${!automatedMessaging ? 'opacity-50 pointer-events-none' : ''}`}>
				<h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Schedule</h3>

				<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
					{/* Message Days */}
					<div>
						<h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Send reminders on:</h4>
						<div className="space-y-2">
							{MESSAGE_DAY_OPTIONS.map(({ value, label, description }) => (
								<label
									key={value}
									className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer border transition-colors ${messageDays.has(value)
										? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
										: 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
										}`}
								>
									<input
										type="checkbox"
										checked={messageDays.has(value)}
										onChange={() => toggleDay(value)}
										className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
									/>
									<div className="flex-1">
										<span className="text-sm font-medium text-gray-900 dark:text-white">{label}</span>
										{description && (
											<span className="text-xs text-gray-500 dark:text-gray-400 ml-2">{description}</span>
										)}
									</div>
								</label>
							))}
						</div>
					</div>

					{/* Message Time */}
					<div>
						<h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Send at:</h4>
						<div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
							<div className="flex items-center gap-2">
								<select
									value={hour}
									onChange={e => setHour(Number(e.target.value))}
									className="px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-medium text-lg focus:ring-2 focus:ring-blue-500"
								>
									{hours.map(h => (
										<option key={h} value={h}>{h}</option>
									))}
								</select>
								<span className="text-gray-500 dark:text-gray-400 font-bold text-xl">:</span>
								<select
									value={minute}
									onChange={e => setMinute(Number(e.target.value))}
									className="px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-medium text-lg focus:ring-2 focus:ring-blue-500"
								>
									{minutes.map(m => (
										<option key={m} value={m}>{String(m).padStart(2, '0')}</option>
									))}
								</select>
								<select
									value={ampm}
									onChange={e => setAmpm(e.target.value)}
									className="px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-medium text-lg focus:ring-2 focus:ring-blue-500"
								>
									<option value="AM">AM</option>
									<option value="PM">PM</option>
								</select>
							</div>
							<p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
								Messages will be sent at {hour}:{String(minute).padStart(2, '0')} {ampm} local time
							</p>
						</div>
					</div>
				</div>
			</div>

			{/* Save Settings */}
			<div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
				<div className="flex items-center justify-between gap-4">
					<div>
						<h3 className="text-base font-semibold text-gray-900 dark:text-white">Save Automated Settings</h3>
						<p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
							Save your settings and generate scheduled messages for all tenants
						</p>
					</div>
					<button
						type="button"
						onClick={handleSaveSettings}
						disabled={saving || loadingSettings}
						className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors flex items-center gap-2 flex-shrink-0"
					>
						{saving ? (
							<>
								<svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
									<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
									<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
								</svg>
								Saving...
							</>
						) : (
							<>
								<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
								</svg>
								Save Settings
							</>
						)}
					</button>
				</div>

				{saveError && (
					<div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-200">
						{saveError}
					</div>
				)}

				{saveSuccess && (
					<div className="mt-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-200">
						<div className="flex items-center gap-2">
							<svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
								<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
							</svg>
							Settings saved successfully!
						</div>
						{generationStats && (
							<div className="mt-2 text-xs text-green-700 dark:text-green-300">
								<p>Generated {generationStats.messages_created} message(s) for {generationStats.tenants_processed} tenant(s)</p>
								{generationStats.messages_skipped > 0 && (
									<p>Skipped {generationStats.messages_skipped} (already scheduled or past due)</p>
								)}
							</div>
						)}
					</div>
				)}
			</div>

			</>
			)}

			{/* ===== MONITOR TAB ===== */}
			{subTab === 'monitor' && (
			<>

			{/* Monitor info banner */}
			<div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl flex items-start gap-3">
				<svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
					<path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
				</svg>
				<p className="text-sm text-blue-800 dark:text-blue-200">
					View tenant schedules, upcoming messages, and send messages manually.
				</p>
			</div>

			{/* Per-Tenant Schedules */}
			<div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
				<div className="flex items-start justify-between gap-4 mb-4">
					<div>
						<h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
							Tenant Schedules
							<span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs font-medium rounded-full">
								<svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
									<path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
									<path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
								</svg>
								ML-Powered
							</span>
						</h3>
						<p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
							ML predictions are automatically loaded. Click "Apply All" to update all schedules.
						</p>
					</div>
					<div className="flex gap-2 flex-wrap">
						<button
							type="button"
							onClick={handleFetchTenantSchedules}
							disabled={tenantSchedulesLoading}
							className="px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-700 dark:text-gray-200 font-medium rounded-lg transition-colors text-sm"
						>
							{tenantSchedulesLoading ? 'Loading...' : 'Refresh'}
						</button>
						<button
							type="button"
							onClick={handleBatchUpdateMl}
							disabled={mlBatchUpdating || !property?.id || Object.keys(mlPredictions).length === 0}
							className="px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors text-sm flex items-center gap-2"
						>
							{mlBatchUpdating ? (
								<>
									<svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
										<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
										<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
									</svg>
									Applying...
								</>
							) : (
								<>
									<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
										<path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
									</svg>
									Apply All Predictions
								</>
							)}
						</button>
					</div>
				</div>

				{/* ML Loading Indicator */}
				{mlPredicting && tenantSchedulesData?.tenants && tenantSchedulesData.tenants.length > 0 && (
					<div className="mb-4 p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
						<div className="flex items-center gap-3">
							<svg className="animate-spin w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24">
								<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
								<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
							</svg>
							<span className="text-sm text-purple-700 dark:text-purple-300">
								Generating ML predictions for all tenants...
							</span>
						</div>
					</div>
				)}

				{/* ML Predictions Summary */}
				{!mlPredicting && Object.keys(mlPredictions).length > 0 && tenantSchedulesData?.tenants && (
					<div className="mb-4 p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
						<div className="flex items-start gap-3">
							<svg className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
								<path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
								<path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
							</svg>
							<div className="flex-1">
								<p className="text-sm text-purple-700 dark:text-purple-300">
									<span className="font-semibold">{Object.keys(mlPredictions).length} ML predictions</span> generated based on tenant payment behavior patterns.
									Review the predictions below and click "Apply All Predictions" to update all schedules, or apply individually.
								</p>
							</div>
						</div>
					</div>
				)}

				{/* ML Batch Update Result */}
				{mlBatchResult && (
					<div className={`mb-4 p-3 rounded-lg ${mlBatchResult.error ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200' : 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'} text-sm`}>
						{mlBatchResult.error ? (
							mlBatchResult.error
						) : (
							<div>
								<p className="font-semibold mb-1">ML Optimization Complete!</p>
								<p>Updated: {mlBatchResult.updated} tenants, Skipped: {mlBatchResult.skipped} (low confidence)</p>
								{mlBatchResult.results && mlBatchResult.results.length > 0 && (
									<details className="mt-2">
										<summary className="cursor-pointer text-xs font-medium">View details</summary>
										<div className="mt-2 space-y-1 text-xs">
											{mlBatchResult.results.map((r, i) => (
												<div key={i} className="flex justify-between">
													<span>{r.tenant_name} ({r.room_number})</span>
													<span className={r.updated ? 'text-green-700 dark:text-green-300' : 'text-gray-600 dark:text-gray-400'}>
														{r.updated ? `✓ ${r.optimal_hour}:00 (${(r.confidence * 100).toFixed(0)}%)` : `✗ Low confidence`}
													</span>
												</div>
											))}
										</div>
									</details>
								)}
							</div>
						)}
					</div>
				)}

				{tenantSchedulesData?.tenants && tenantSchedulesData.tenants.length > 0 ? (
					<div className="space-y-3">
						{/* Default settings info */}
						<div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm text-gray-600 dark:text-gray-400">
							Property defaults: Days [{tenantSchedulesData.default_message_days?.join(', ')}],
							Time {(() => {
								const h = tenantSchedulesData.default_send_hour ?? 9
								const m = tenantSchedulesData.default_send_minute ?? 0
								const ampm = h >= 12 ? 'PM' : 'AM'
								const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h)
								return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`
							})()}
						</div>

						{/* Tenant list */}
						<div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-x-auto">
							<table className="w-full text-sm">
								<thead className="bg-gray-50 dark:bg-gray-700">
									<tr>
										<th className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">Tenant</th>
										<th className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">Room</th>
										<th className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">Reminder Days</th>
										<th className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">Send Time</th>
										<th className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">
											<span className="flex items-center gap-1">
												<svg className="w-3 h-3 text-purple-500" fill="currentColor" viewBox="0 0 20 20">
													<path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
													<path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
												</svg>
												ML Prediction
											</span>
										</th>
										<th className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">Actions</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-200 dark:divide-gray-700">
									{tenantSchedulesData.tenants.map((tenant) => {
										const isEditing = editingScheduleRoom === tenant.room_number
										return (
											<tr key={tenant.room_number} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
												<td className="px-3 py-2 text-gray-900 dark:text-gray-100">{tenant.tenant_name}</td>
												<td className="px-3 py-2 font-mono text-xs text-gray-700 dark:text-gray-300">{tenant.room_number}</td>
												<td className="px-3 py-2">
													{isEditing ? (
														<div className="flex flex-wrap gap-1">
															{[7, 5, 3, 2, 1, 0].map(day => (
																<button
																	key={day}
																	type="button"
																	onClick={() => handleToggleScheduleDay(day)}
																	className={`px-2 py-1 text-xs rounded ${editScheduleDays.has(day)
																		? 'bg-blue-500 text-white'
																		: 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300'
																		}`}
																>
																	{day === 0 ? 'Due' : `${day}d`}
																</button>
															))}
														</div>
													) : (
														<span className="text-gray-700 dark:text-gray-300">
															{tenant.message_days?.map(d => d === 0 ? 'Due' : `${d}d`).join(', ') || 'Default'}
														</span>
													)}
												</td>
												<td className="px-3 py-2">
													{isEditing ? (
														<div className="flex items-center gap-1">
															<select
																value={editScheduleHour}
																onChange={(e) => setEditScheduleHour(parseInt(e.target.value))}
																className="w-14 px-1 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
															>
																{[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(h => (
																	<option key={h} value={h}>{h}</option>
																))}
															</select>
															<span className="text-gray-500">:</span>
															<select
																value={editScheduleMinute}
																onChange={(e) => setEditScheduleMinute(parseInt(e.target.value))}
																className="w-14 px-1 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
															>
																{[0, 15, 30, 45].map(min => (
																	<option key={min} value={min}>{min.toString().padStart(2, '0')}</option>
																))}
															</select>
															<select
																value={editScheduleAmpm}
																onChange={(e) => setEditScheduleAmpm(e.target.value)}
																className="w-14 px-1 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
															>
																<option value="AM">AM</option>
																<option value="PM">PM</option>
															</select>
														</div>
													) : (
														<span className={`text-gray-700 dark:text-gray-300 ${tenant.has_custom_schedule ? 'font-medium text-blue-600 dark:text-blue-400' : ''}`}>
															{tenant.send_time_display}
															{tenant.has_custom_schedule && <span className="ml-1 text-xs">(custom)</span>}
														</span>
													)}
												</td>
												<td className="px-3 py-2">
													{mlPredictions[tenant.room_number] ? (
														<div className="flex flex-col gap-1">
															<div className="flex items-center gap-2">
																<span className="text-sm font-semibold text-purple-700 dark:text-purple-300">
																	{mlPredictions[tenant.room_number].optimal_hour}:00
																</span>
																<span className={`text-xs px-1.5 py-0.5 rounded-full ${
																	mlPredictions[tenant.room_number].confidence >= 0.7
																		? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
																		: mlPredictions[tenant.room_number].confidence >= 0.5
																		? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
																		: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
																}`}>
																	{(mlPredictions[tenant.room_number].confidence * 100).toFixed(0)}%
																</span>
															</div>
															<button
																type="button"
																onClick={() => handleApplyMlPrediction(tenant)}
																className="text-xs px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 hover:bg-purple-200 dark:hover:bg-purple-800/50 text-purple-700 dark:text-purple-300 rounded font-medium"
															>
																Apply
															</button>
														</div>
													) : (
														<button
															type="button"
															onClick={() => handlePredictTenant(tenant)}
															disabled={mlPredicting}
															className="text-xs px-2 py-1 bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/30 disabled:opacity-50 text-purple-700 dark:text-purple-300 rounded border border-purple-200 dark:border-purple-800 flex items-center gap-1"
														>
															<svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
																<path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
																<path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
															</svg>
															Predict
														</button>
													)}
												</td>
												<td className="px-3 py-2">
													{isEditing ? (
														<div className="flex gap-1">
															<button
																type="button"
																onClick={() => handleSaveTenantSchedule(tenant.room_number, tenant.tenant_name)}
																disabled={savingSchedule}
																className="px-2 py-1 text-xs bg-green-500 hover:bg-green-600 text-white rounded"
															>
																{savingSchedule ? '...' : 'Save'}
															</button>
															<button
																type="button"
																onClick={handleCancelEditSchedule}
																className="px-2 py-1 text-xs bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 rounded"
															>
																Cancel
															</button>
														</div>
													) : (
														<div className="flex gap-1">
															<button
																type="button"
																onClick={() => handleStartEditSchedule(tenant)}
																className="px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-800/50 text-blue-700 dark:text-blue-300 rounded"
															>
																Edit
															</button>
															{tenant.has_custom_schedule && (
																<button
																	type="button"
																	onClick={() => handleResetTenantSchedule(tenant.room_number)}
																	className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-400 rounded"
																>
																	Reset
																</button>
															)}
														</div>
													)}
												</td>
											</tr>
										)
									})}
								</tbody>
							</table>
						</div>
					</div>
				) : tenantSchedulesData?.error ? (
					<p className="text-sm text-red-500">{tenantSchedulesData.error}</p>
				) : !tenantSchedulesLoading && !tenantSchedulesData ? (
					<p className="text-sm text-gray-500 dark:text-gray-400">Click "Refresh" to load tenant schedules.</p>
				) : tenantSchedulesLoading ? (
					<p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
				) : (
					<p className="text-sm text-gray-500 dark:text-gray-400 italic">No active tenants found.</p>
				)}
			</div>

			{/* Automated Messages Queue */}
			<div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
				<div className="flex items-start justify-between gap-4 mb-4">
					<div>
						<h3 className="text-base font-semibold text-gray-900 dark:text-white">Upcoming Automated Messages</h3>
						<p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
							View scheduled payment reminders for tenants
						</p>
					</div>
					<div className="flex gap-2 flex-wrap">
						<button
							type="button"
							onClick={handleFetchAutomatedMessages}
							disabled={automatedMessagesLoading}
							className="px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-700 dark:text-gray-200 font-medium rounded-lg transition-colors text-sm"
						>
							{automatedMessagesLoading ? 'Loading...' : 'Refresh'}
						</button>
						<button
							type="button"
							onClick={handleProcessAutomated}
							disabled={processingAutomated}
							className="px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors text-sm"
						>
							{processingAutomated ? 'Sending...' : 'Send Due Now'}
						</button>
						<button
							type="button"
							onClick={handleClearAutomated}
							disabled={clearingAutomated}
							className="px-3 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors text-sm"
						>
							{clearingAutomated ? 'Cancelling...' : 'Cancel All'}
						</button>
					</div>
				</div>

				{automatedProcessResult && (
					<div className={`mb-4 p-3 rounded-lg ${automatedProcessResult.error ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200' : 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'} text-sm`}>
						{automatedProcessResult.error || automatedProcessResult.detail}
						{automatedProcessResult.process_stats && (
							<span className="ml-2">
								(Sent: {automatedProcessResult.process_stats.sent_count}, Failed: {automatedProcessResult.process_stats.failed_count})
							</span>
						)}
					</div>
				)}

				{automatedMessagesData && (
					<div className="space-y-3">
						{/* Summary */}
						<div className="flex flex-wrap gap-4 text-sm">
							<div className="px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
								<span className="text-gray-500 dark:text-gray-400">Total Pending:</span>
								<span className="ml-2 font-semibold text-gray-900 dark:text-white">{automatedMessagesData.total_pending ?? '?'}</span>
							</div>
							<div className="px-3 py-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
								<span className="text-orange-700 dark:text-orange-300">Ready to Send:</span>
								<span className="ml-2 font-semibold text-orange-900 dark:text-orange-100">{automatedMessagesData.ready_to_send ?? '?'}</span>
							</div>
							<div className="px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
								<span className="text-gray-500 dark:text-gray-400">Server Time:</span>
								<span className="ml-2 font-mono text-xs text-gray-700 dark:text-gray-300">{automatedMessagesData.server_time ? new Date(automatedMessagesData.server_time).toLocaleString() : '?'}</span>
							</div>
						</div>

						{/* Messages list */}
						{automatedMessagesData.messages && automatedMessagesData.messages.length > 0 ? (
							<div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-x-auto">
								<table className="w-full text-sm">
									<thead className="bg-gray-50 dark:bg-gray-700">
										<tr>
											<th className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">Tenant</th>
											<th className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">Room</th>
											<th className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">Send At</th>
											<th className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">Due Date</th>
											<th className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">Days Before</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-gray-200 dark:divide-gray-700">
										{automatedMessagesData.messages.map((m) => {
											const sendAt = new Date(m.send_at)
											const now = new Date()
											const isDue = sendAt <= now
											return (
												<tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
													<td className="px-3 py-2 text-gray-900 dark:text-gray-100">{m.tenant_name || 'Unknown'}</td>
													<td className="px-3 py-2 font-mono text-xs text-gray-700 dark:text-gray-300">{m.room_number}</td>
													<td className="px-3 py-2 text-gray-700 dark:text-gray-300">
														{sendAt.toLocaleString()}
														{isDue && (
															<span className="ml-2 text-xs px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded">DUE</span>
														)}
													</td>
													<td className="px-3 py-2 text-gray-700 dark:text-gray-300">{m.due_date}</td>
													<td className="px-3 py-2">
														<span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">
															{m.days_before_due === 0 ? 'Due day' : `${m.days_before_due} days`}
														</span>
													</td>
												</tr>
											)
										})}
									</tbody>
								</table>
							</div>
						) : (
							<p className="text-sm text-gray-500 dark:text-gray-400 italic">No pending automated messages. Save settings to generate messages based on tenant due dates.</p>
						)}
					</div>
				)}

				{!automatedMessagesData && !automatedMessagesLoading && (
					<p className="text-sm text-gray-500 dark:text-gray-400">Click "Refresh" to load upcoming automated messages.</p>
				)}
			</div>

			{/* Send Now */}
			<div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
				<div className="space-y-3">
					<div className="flex items-start justify-between gap-4">
						<div>
							<h3 className="text-base font-semibold text-gray-900 dark:text-white">Send Now</h3>
							<p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
								Immediately send the message template to all tenants in this property
							</p>
						</div>
						<button
							type="button"
							onClick={handleSendNow}
							disabled={sendingNow || !messageTemplate.trim()}
							className="px-5 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center gap-2 flex-shrink-0"
						>
							{sendingNow ? (
								<>
									<svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
										<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
										<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
									</svg>
									Sending...
								</>
							) : (
								<>
									<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
									</svg>
									Send Now
								</>
							)}
						</button>
					</div>

					{/* Channel selector */}
					<div>
						<label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Send via</label>
						<div className="flex gap-2">
							{[['sms', 'SMS'], ['email', 'Email'], ['both', 'Both']].map(([value, label]) => (
								<button
									key={value}
									type="button"
									onClick={() => setSendNowChannel(value)}
									className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
										sendNowChannel === value
											? 'bg-orange-600 text-white border-orange-600'
											: 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
									}`}
								>
									{label}
								</button>
							))}
						</div>
					</div>
				</div>

				{sendNowError && (
					<div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-200">
						{sendNowError}
					</div>
				)}

				{sendNowSuccess && (
					<div className="mt-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-200">
						{sendNowSuccess}
					</div>
				)}
			</div>

			</>
			)}

			{/* ===== TEST & DIAGNOSE TAB ===== */}
			{subTab === 'test' && (
			<>

			{/* Test & Diagnose info banner */}
			<div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl flex items-start gap-3">
				<svg className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
					<path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
				</svg>
				<p className="text-sm text-amber-800 dark:text-amber-200">
					These tools are for testing and diagnostics only. They do not affect your production automated messages.
				</p>
			</div>

			{/* SMS Gateway Diagnostic */}
			<div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
				<div className="flex items-start justify-between gap-4 mb-4">
					<div>
						<h3 className="text-base font-semibold text-gray-900 dark:text-white">SMS Gateway Status</h3>
						<p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
							Check if the SMS gateway (Android SMS Gateway) is configured and reachable
						</p>
					</div>
					<button
						type="button"
						onClick={handleCheckGateway}
						disabled={diagLoading}
						className="px-4 py-2 bg-gray-600 hover:bg-gray-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors flex items-center gap-2 flex-shrink-0"
					>
						{diagLoading ? (
							<>
								<svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
									<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
									<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
								</svg>
								Checking...
							</>
						) : (
							<>
								<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
								Check Gateway
							</>
						)}
					</button>
				</div>

				{diagError && (
					<div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-200">
						{diagError}
					</div>
				)}

				{diagResult && (
					<div className="space-y-3">
						{/* Configuration status */}
						<div className={`p-3 rounded-lg border ${diagResult.configured ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'}`}>
							<div className="flex items-center gap-2">
								{diagResult.configured ? (
									<svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
										<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
									</svg>
								) : (
									<svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20">
										<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
									</svg>
								)}
								<span className={`font-medium ${diagResult.configured ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}`}>
									{diagResult.configured ? 'Credentials Configured' : 'Credentials Not Configured'}
								</span>
							</div>
							{diagResult.username && (
								<p className="text-xs text-gray-600 dark:text-gray-400 mt-1 ml-7">Username: {diagResult.username}</p>
							)}
							{diagResult.base_url && (
								<p className="text-xs text-gray-600 dark:text-gray-400 mt-1 ml-7">URL: {diagResult.base_url}</p>
							)}
						</div>

						{/* Health check */}
						{diagResult.health_check && (
							<div className={`p-3 rounded-lg border ${diagResult.health_check.ok ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'}`}>
								<div className="flex items-center gap-2">
									{diagResult.health_check.ok ? (
										<svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
											<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
										</svg>
									) : (
										<svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
											<path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
										</svg>
									)}
									<span className={`font-medium ${diagResult.health_check.ok ? 'text-green-800 dark:text-green-200' : 'text-yellow-800 dark:text-yellow-200'}`}>
										Health Check: {diagResult.health_check.ok ? 'OK' : diagResult.health_check.error || `HTTP ${diagResult.health_check.status_code}`}
									</span>
								</div>
							</div>
						)}

						{/* Devices */}
						{diagResult.devices && (
							<div className={`p-3 rounded-lg border ${diagResult.devices.ok ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'}`}>
								<div className="flex items-center gap-2">
									{diagResult.devices.ok ? (
										<svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
											<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
										</svg>
									) : (
										<svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20">
											<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
										</svg>
									)}
									<span className={`font-medium ${diagResult.devices.ok ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}`}>
										{diagResult.devices.ok
											? `Authentication OK - ${diagResult.devices.count || 0} device(s) registered`
											: `Authentication Failed: ${diagResult.devices.error || `HTTP ${diagResult.devices.status_code}`}`
										}
									</span>
								</div>
								{diagResult.devices.ok && diagResult.devices.devices && diagResult.devices.devices.length > 0 && (
									<div className="mt-2 ml-7 text-xs text-gray-600 dark:text-gray-400">
										{diagResult.devices.devices.map((d, i) => (
											<p key={i}>{d.name || d.id} {d.lastSeen ? `(last seen: ${new Date(d.lastSeen).toLocaleString()})` : ''}</p>
										))}
									</div>
								)}
							</div>
						)}
					</div>
				)}
			</div>

			{/* Push Notifications */}
			<div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
				<div className="flex items-start justify-between gap-4 mb-4">
					<div>
						<h3 className="text-base font-semibold text-gray-900 dark:text-white">Browser Push Notifications</h3>
						<p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
							Get notified when SMS messages are sent, fail, or when tenant payments are due
						</p>
					</div>
					{pushNotifications.isSupported && (
						<div className="flex items-center gap-2 flex-wrap">
							{pushNotifications.isSubscribed ? (
								<>
									<button
										type="button"
										onClick={pushNotifications.unsubscribe}
										disabled={pushNotifications.loading}
										className="px-3 py-2 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 font-medium rounded-lg transition-colors text-sm"
									>
										{pushNotifications.loading ? 'Processing...' : 'Disable'}
									</button>
									<button
										type="button"
										onClick={pushNotifications.reset}
										disabled={pushNotifications.loading}
										className="px-3 py-2 bg-orange-100 dark:bg-orange-900/30 hover:bg-orange-200 dark:hover:bg-orange-900/50 text-orange-700 dark:text-orange-300 font-medium rounded-lg transition-colors text-sm"
										title="Clear old subscriptions and re-subscribe (use if notifications stopped working)"
									>
										Reset
									</button>
								</>
							) : (
								<button
									type="button"
									onClick={pushNotifications.subscribe}
									disabled={pushNotifications.loading}
									className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors text-sm"
								>
									{pushNotifications.loading ? 'Processing...' : 'Enable Notifications'}
								</button>
							)}
						</div>
					)}
				</div>

				{!pushNotifications.isSupported && (
					<div className="p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-sm text-yellow-800 dark:text-yellow-200">
						{isIOS && !isStandalone ? (
							<>
								<p className="font-medium mb-2 flex items-center gap-2">
									<svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
										<path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
									</svg>
									Add to Home Screen Required
								</p>
								<div className="text-xs space-y-2">
									<p>To receive push notifications on iPhone/iPad:</p>
									<ol className="list-decimal list-inside ml-2 space-y-1">
										<li>Tap the <strong>Share</strong> button (square with arrow)</li>
										<li>Scroll down and tap <strong>"Add to Home Screen"</strong></li>
										<li>Tap <strong>"Add"</strong> in the top right</li>
										<li>Open <strong>MP-SAN TMS</strong> from your Home Screen</li>
										<li>Come back here to enable notifications</li>
									</ol>
									<p className="mt-2 text-yellow-600 dark:text-yellow-400">Note: Requires iOS 16.4 or later</p>
								</div>
							</>
						) : isIOS && isStandalone ? (
							<>
								<p className="font-medium mb-2">Checking Push Notification Support...</p>
								<div className="text-xs space-y-2">
									<p>You're running as a PWA from the Home Screen. If notifications still aren't working:</p>
									<ul className="list-disc list-inside ml-2 space-y-1">
										<li>Make sure you're on <strong>iOS 16.4</strong> or later</li>
										<li>Try closing and reopening the app from Home Screen</li>
										<li>Check Settings → Notifications → MP-SAN TMS</li>
									</ul>
									<button
										onClick={() => window.location.reload()}
										className="mt-3 px-3 py-1.5 bg-yellow-600 text-white rounded text-xs font-medium hover:bg-yellow-700"
									>
										Reload App & Check Again
									</button>
									<p className="mt-2 text-yellow-600 dark:text-yellow-400 text-[10px]">
										Debug: SW={String('serviceWorker' in navigator)}, Push={String('PushManager' in window)}, Notif={String('Notification' in window)}
									</p>
								</div>
							</>
						) : (
							<>
								<p className="font-medium mb-2">Push notifications are not supported in this browser.</p>
								<div className="text-xs space-y-2">
									<p><strong>On iPhone/iPad (iOS 16.4+):</strong></p>
									<ol className="list-decimal list-inside ml-2 space-y-1">
										<li>Tap the Share button in Safari</li>
										<li>Select "Add to Home Screen"</li>
										<li>Open the app from your Home Screen</li>
										<li>Then enable notifications here</li>
									</ol>
									<p className="mt-2"><strong>On Desktop:</strong> Use Chrome, Firefox, or Edge browser.</p>
									<button
										onClick={() => window.location.reload()}
										className="mt-3 px-3 py-1.5 bg-yellow-600 text-white rounded text-xs font-medium hover:bg-yellow-700"
									>
										Reload & Check Again
									</button>
									<p className="mt-2 text-yellow-600 dark:text-yellow-400 text-[10px]">
										Debug: SW={String('serviceWorker' in navigator)}, Push={String('PushManager' in window)}, Notif={String('Notification' in window)}, Standalone={String(isStandalone)}
									</p>
								</div>
							</>
						)}
					</div>
				)}

				{pushNotifications.error && (
					<div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-200 mb-4">
						{pushNotifications.error}
					</div>
				)}

				{pushNotifications.isSupported && (
					<div className="space-y-3">
						{/* Status */}
						<div className={`p-3 rounded-lg border ${pushNotifications.isSubscribed ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-700'}`}>
							<div className="flex items-center gap-2">
								{pushNotifications.isSubscribed ? (
									<svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
										<path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
									</svg>
								) : (
									<svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
										<path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
									</svg>
								)}
								<span className={`font-medium ${pushNotifications.isSubscribed ? 'text-green-800 dark:text-green-200' : 'text-gray-600 dark:text-gray-400'}`}>
									{pushNotifications.isSubscribed ? 'Notifications Enabled' : 'Notifications Disabled'}
								</span>
							</div>
							<p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-7">
								Permission: {pushNotifications.permission}
							</p>
						</div>

						{/* Test button */}
						{pushNotifications.isSubscribed && (
							<div className="flex items-center gap-3">
								<button
									type="button"
									onClick={handlePushTest}
									disabled={pushTestLoading}
									className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors text-sm flex items-center gap-2"
								>
									{pushTestLoading ? (
										<>
											<svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
												<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
												<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
											</svg>
											Sending...
										</>
									) : (
										<>
											<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
											</svg>
											Send Test Notification
										</>
									)}
								</button>
								{pushTestResult && (
									<span className={`text-sm ${pushTestResult.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
										{pushTestResult.detail}
									</span>
								)}
							</div>
						)}
					</div>
				)}
			</div>

			{/* Test automated messaging — send to your phone/email today at a time you select */}
			<div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
				<h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Test automated messaging</h3>
				<p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
					Send the message template via SMS and/or email now, or schedule it for today at a precise time. The server checks every 30 seconds.
				</p>

				{/* Your phone number */}
				<div className="mb-4">
					<label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Phone number (to receive test SMS)</label>
					<input
						type="tel"
						value={testPhone}
						onChange={e => setTestPhone(e.target.value)}
						placeholder="e.g. 09171234567 or 9171234567"
						className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					/>
					<p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
						Will be normalized to international format (e.g., 09171234567 → 639171234567)
					</p>
				</div>

				{/* Your email */}
				<div className="mb-4">
					<label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email address (to receive test email)</label>
					<input
						type="email"
						value={testEmail}
						onChange={e => setTestEmail(e.target.value)}
						placeholder="e.g. you@example.com"
						className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					/>
					<p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
						You can fill in phone, email, or both. At least one is required.
					</p>
				</div>

				{/* Time for today */}
				<div className="mb-4">
					<label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Schedule for today at (local time)</label>
					<div className="flex items-center gap-2 flex-wrap">
						<select
							value={testHour}
							onChange={e => setTestHour(Number(e.target.value))}
							className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
						>
							{Array.from({ length: 12 }, (_, i) => i + 1).map(h => (
								<option key={h} value={h}>{h}</option>
							))}
						</select>
						<span className="text-gray-500 font-medium">:</span>
						<select
							value={testMinute}
							onChange={e => setTestMinute(Number(e.target.value))}
							className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
						>
							{Array.from({ length: 60 }, (_, i) => i).map(m => (
								<option key={m} value={m}>{String(m).padStart(2, '0')}</option>
							))}
						</select>
						<select
							value={testAmpm}
							onChange={e => setTestAmpm(e.target.value)}
							className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
						>
							<option value="AM">AM</option>
							<option value="PM">PM</option>
						</select>
					</div>
				</div>

				{/* Buttons */}
				<div className="flex flex-wrap items-center gap-3">
					<button
						type="button"
						onClick={handleSendTestNow}
						disabled={testSendingNow || (!testPhone.trim() && !testEmail.trim()) || !messageTemplate.trim()}
						className="px-4 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center gap-2"
					>
						{testSendingNow ? (
							<>
								<svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
									<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
									<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
								</svg>
								Sending...
							</>
						) : (
							'Send test now'
						)}
					</button>
					<button
						type="button"
						onClick={handleScheduleTest}
						disabled={schedulingTest || (!testPhone.trim() && !testEmail.trim()) || !messageTemplate.trim()}
						className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center gap-2"
					>
						{schedulingTest ? (
							<>
								<svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
									<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
									<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
								</svg>
								Scheduling...
							</>
						) : (
							`Schedule test for today at ${testHour}:${String(testMinute).padStart(2, '0')} ${testAmpm}`
						)}
					</button>
				</div>

				{testSendError && (
					<div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-200">
						{testSendError}
					</div>
				)}
				{testSendSuccess && (
					<div className="mt-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-200">
						{testSendSuccess}
					</div>
				)}

				{/* Show diagnostic details from test send */}
				{testSendDiagResult?.diagnostic && (
					<div className="mt-4 p-3 rounded-lg bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600">
						<p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">SMS Details</p>
						<div className="text-xs text-gray-700 dark:text-gray-300 font-mono space-y-1">
							<p><span className="text-gray-500">Original phone:</span> {testSendDiagResult.diagnostic.original_phone}</p>
							<p><span className="text-gray-500">Normalized phone:</span> {testSendDiagResult.diagnostic.normalized_phone}</p>
							<p><span className="text-gray-500">Gateway URL:</span> {testSendDiagResult.diagnostic.url}</p>
							{testSendDiagResult.diagnostic.response && (
								<>
									<p><span className="text-gray-500">Response status:</span> {testSendDiagResult.diagnostic.response.status_code}</p>
									{testSendDiagResult.diagnostic.response.body && (
										<details className="mt-2">
											<summary className="cursor-pointer text-blue-600 dark:text-blue-400">View response body</summary>
											<pre className="mt-1 p-2 bg-gray-200 dark:bg-gray-600 rounded text-xs overflow-x-auto whitespace-pre-wrap">
												{typeof testSendDiagResult.diagnostic.response.body === 'string'
													? testSendDiagResult.diagnostic.response.body
													: JSON.stringify(testSendDiagResult.diagnostic.response.body, null, 2)}
											</pre>
										</details>
									)}
								</>
							)}
							{testSendDiagResult.diagnostic.error && (
								<p className="text-red-600 dark:text-red-400"><span className="text-gray-500">Error:</span> {testSendDiagResult.diagnostic.error}</p>
							)}
						</div>
					</div>
				)}
				{testSendDiagResult?.email_result && (
					<div className="mt-4 p-3 rounded-lg bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600">
						<p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">Email Details</p>
						<div className="text-xs text-gray-700 dark:text-gray-300 font-mono space-y-1">
							<p><span className="text-gray-500">Email:</span> {testSendDiagResult.email_result.email}</p>
							<p><span className="text-gray-500">Status:</span> <span className={testSendDiagResult.email_result.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{testSendDiagResult.email_result.ok ? 'Sent' : 'Failed'}</span></p>
							{testSendDiagResult.email_result.error && (
								<p className="text-red-600 dark:text-red-400"><span className="text-gray-500">Error:</span> {testSendDiagResult.email_result.error}</p>
							)}
						</div>
					</div>
				)}

				{scheduleTestError && (
					<div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-200">
						{scheduleTestError}
					</div>
				)}
				{scheduleTestSuccess && (
					<div className="mt-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-200">
						{scheduleTestSuccess}
					</div>
				)}
			</div>

			{/* Scheduled Messages Status */}
			<div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
				<div className="flex items-start justify-between gap-4 mb-4">
					<div>
						<h3 className="text-base font-semibold text-gray-900 dark:text-white">Scheduled Messages Queue</h3>
						<p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
							View scheduled test messages and manually trigger processing
						</p>
					</div>
					<div className="flex gap-2 flex-wrap">
						<button
							type="button"
							onClick={handleFetchScheduled}
							disabled={scheduledLoading}
							className="px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-700 dark:text-gray-200 font-medium rounded-lg transition-colors text-sm"
						>
							{scheduledLoading ? 'Loading...' : 'Refresh'}
						</button>
						<button
							type="button"
							onClick={handleProcessScheduled}
							disabled={processingScheduled}
							className="px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors text-sm"
						>
							{processingScheduled ? 'Processing...' : 'Process Now'}
						</button>
						<button
							type="button"
							onClick={handleClearScheduled}
							disabled={clearingScheduled}
							className="px-3 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors text-sm"
						>
							{clearingScheduled ? 'Clearing...' : 'Clear Pending'}
						</button>
					</div>
				</div>

				{processResult && (
					<div className={`mb-4 p-3 rounded-lg ${processResult.error ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200' : 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'} text-sm`}>
						{processResult.error || processResult.detail}
					</div>
				)}

				{scheduledData && (
					<div className="space-y-3">
						{/* Summary */}
						<div className="flex flex-wrap gap-4 text-sm">
							<div className="px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
								<span className="text-gray-500 dark:text-gray-400">Total Pending:</span>
								<span className="ml-2 font-semibold text-gray-900 dark:text-white">{scheduledData.total_pending ?? '?'}</span>
							</div>
							<div className="px-3 py-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
								<span className="text-orange-700 dark:text-orange-300">Ready to Send:</span>
								<span className="ml-2 font-semibold text-orange-900 dark:text-orange-100">{scheduledData.ready_to_send ?? '?'}</span>
							</div>
							<div className="px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
								<span className="text-gray-500 dark:text-gray-400">Server Time:</span>
								<span className="ml-2 font-mono text-xs text-gray-700 dark:text-gray-300">{scheduledData.server_time ? new Date(scheduledData.server_time).toLocaleString() : '?'}</span>
							</div>
						</div>

						{/* Messages list */}
						{scheduledData.messages && scheduledData.messages.length > 0 ? (
							<div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
								<table className="w-full text-sm">
									<thead className="bg-gray-50 dark:bg-gray-700">
										<tr>
											<th className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">Phone</th>
											<th className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">Send At</th>
											<th className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">Status</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-gray-200 dark:divide-gray-700">
										{scheduledData.messages.map((m) => (
											<tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
												<td className="px-3 py-2 font-mono text-xs text-gray-900 dark:text-gray-100">{m.phone_number}</td>
												<td className="px-3 py-2 text-gray-700 dark:text-gray-300">
													{new Date(m.send_at).toLocaleString()}
													{m.is_due && !m.sent && (
														<span className="ml-2 text-xs px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded">DUE</span>
													)}
												</td>
												<td className="px-3 py-2">
													{m.sent ? (
														<span className="text-xs px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full">
															Sent {m.sent_at ? new Date(m.sent_at).toLocaleTimeString() : ''}
														</span>
													) : (
														<span className="text-xs px-2 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded-full">
															Pending
														</span>
													)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						) : (
							<p className="text-sm text-gray-500 dark:text-gray-400 italic">No scheduled messages found. Schedule a test above to see it here.</p>
						)}
					</div>
				)}

				{!scheduledData && !scheduledLoading && (
					<p className="text-sm text-gray-500 dark:text-gray-400">Click "Refresh" to load scheduled messages.</p>
				)}
			</div>

			</>
			)}

		</div>
	)

	// If embedded, don't show header with back button
	if (embedded) {
		return <div className="max-w-3xl mx-auto">{content}</div>
	}

	return (
		<div className="max-w-3xl mx-auto">
			{/* Header */}
			<div className="flex items-center gap-3 mb-6">
				<button
					type="button"
					onClick={onBack}
					className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors text-gray-800 dark:text-gray-200"
					aria-label="Back"
				>
					<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
					</svg>
				</button>
				<div>
					<h1 className="text-xl font-bold text-gray-900 dark:text-white">
						Automated Message Settings
					</h1>
					<p className="text-sm text-gray-500 dark:text-gray-400">
						{property?.propertyName || property?.name || 'Property'}
					</p>
				</div>
			</div>

			{content}
		</div>
	)
}

import React, { useState } from 'react';
import { FiChevronDown, FiChevronRight, FiHome, FiBarChart2, FiFileText, FiMessageSquare, FiActivity, FiSettings, FiUsers, FiGrid, FiDollarSign, FiUpload, FiSearch, FiShield, FiSmartphone, FiBell, FiLock, FiEdit, FiTrash2, FiRefreshCw, FiClock, FiMail } from 'react-icons/fi';

const Section = ({ icon, title, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left"
      >
        <span className="text-blue-600 dark:text-blue-400">{icon}</span>
        <span className="flex-1 font-bold text-gray-900 dark:text-white text-sm">{title}</span>
        {open ? <FiChevronDown className="text-gray-400 w-4 h-4" /> : <FiChevronRight className="text-gray-400 w-4 h-4" />}
      </button>
      {open && (
        <div className="px-5 py-4 space-y-3 text-sm text-gray-700 dark:text-gray-300 leading-relaxed animate-fade-in">
          {children}
        </div>
      )}
    </div>
  );
};

const Tip = ({ children }) => (
  <div className="flex gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-xs text-blue-700 dark:text-blue-300">
    <span className="flex-shrink-0 mt-0.5">💡</span>
    <span>{children}</span>
  </div>
);

const Step = ({ number, children }) => (
  <div className="flex gap-3 items-start">
    <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-black">{number}</span>
    <span className="pt-0.5">{children}</span>
  </div>
);

const KeyLabel = ({ children }) => (
  <span className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono font-bold text-gray-700 dark:text-gray-300">{children}</span>
);

// ──────────────────────────────────────────────────────────────────────
// ADMIN MANUAL
// ──────────────────────────────────────────────────────────────────────
const AdminManual = () => (
  <div className="space-y-4">
    <div className="p-4 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-2xl border border-purple-100 dark:border-purple-800">
      <h3 className="font-black text-gray-900 dark:text-white mb-1">Admin Overview</h3>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        As an admin, you manage user accounts, buildings, and system-wide settings. You do not manage tenants or payments directly — those are handled by owners and managers.
      </p>
    </div>

    <Section icon={<FiUsers className="w-5 h-5" />} title="Managing User Accounts" defaultOpen>
      <p>Navigate to <strong>Admin Dashboard → Accounts</strong> tab.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-2">Creating a New User</h4>
      <Step number="1">Fill in <strong>Username</strong>, <strong>Email</strong>, and <strong>Password</strong>.</Step>
      <Step number="2">Select a role: <strong>Owner</strong>, <strong>Manager</strong>, or <strong>Admin</strong>.</Step>
      <Step number="3">Click <strong>Create User</strong>.</Step>
      <Tip>Passwords must be at least 6 characters and contain both a letter and a number.</Tip>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Deleting a User</h4>
      <p>Click the delete icon next to a user and confirm. This will also remove them from any assigned buildings.</p>
    </Section>

    <Section icon={<FiGrid className="w-5 h-5" />} title="Managing Buildings">
      <p>Navigate to <strong>Admin Dashboard → Buildings</strong> tab.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-2">Creating a Building</h4>
      <Step number="1">Enter the building <strong>Name</strong>, <strong>Address</strong>, and <strong>City</strong>.</Step>
      <Step number="2">Set the number of <strong>Floors</strong>.</Step>
      <Step number="3">Assign an <strong>Owner</strong> from the dropdown.</Step>
      <Step number="4">Optionally assign <strong>Managers</strong> (can select multiple).</Step>
      <Step number="5">Click <strong>Create Building</strong>.</Step>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Editing a Building</h4>
      <p>Click the <strong>Edit</strong> button on any building to modify its name, address, floors, or assignments.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Archiving & Restoring</h4>
      <p>Click <strong>Archive</strong> to soft-delete a building. It moves to the <strong>Archived</strong> tab where it can be restored anytime. Archiving preserves all data.</p>
    </Section>

    <Section icon={<FiActivity className="w-5 h-5" />} title="Activity Logs">
      <p>View all system events under the <strong>Logs</strong> section.</p>
      <p><strong>Activity tab</strong> — User actions: tenant added, payment recorded, tenant removed, etc.</p>
      <p><strong>System tab</strong> — Admin actions: user created, building created/deleted, owner assigned, etc.</p>
      <p><strong>Messages tab</strong> — Every SMS, email, and push notification sent through the system. Failed messages are highlighted in red with error details.</p>
      <Tip>Use the search bar and filters to find specific events. You can filter by severity (Info / Warning / Critical).</Tip>
    </Section>

    <Section icon={<FiShield className="w-5 h-5" />} title="Security & Settings">
      <p>Under <strong>Settings</strong>, you can:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Security Alerts</strong> — View failed login attempts, suspicious activity, and account lockouts.</li>
        <li><strong>Active Sessions</strong> — See all currently logged-in sessions and revoke any suspicious ones.</li>
        <li><strong>Change Password</strong> — Update your admin password. This logs out all other sessions.</li>
      </ul>
    </Section>
  </div>
);

// ──────────────────────────────────────────────────────────────────────
// OWNER / MANAGER MANUAL
// ──────────────────────────────────────────────────────────────────────
const OwnerManagerManual = () => (
  <div className="space-y-4">
    <div className="p-4 bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-900/20 dark:to-blue-900/20 rounded-2xl border border-green-100 dark:border-green-800">
      <h3 className="font-black text-gray-900 dark:text-white mb-1">Owner / Manager Overview</h3>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        You manage properties, tenants, payments, and messaging. Select a property from the left sidebar to get started. Everything updates in real-time across all your devices.
      </p>
    </div>

    {/* ── HOME / OCCUPANCY MAP ──────────────────────────────────── */}
    <Section icon={<FiHome className="w-5 h-5" />} title="Home — Occupancy Map" defaultOpen>
      <p>The home screen shows your property's room layout as an interactive map.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-2">Room Colors</h4>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <span className="flex items-center gap-2"><span className="w-3 h-3 bg-green-500 rounded-full" /> Occupied</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 bg-gray-300 dark:bg-gray-600 rounded-full" /> Vacant</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 bg-yellow-400 rounded-full" /> Maintenance</span>
      </div>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Viewing a Room</h4>
      <p>Click any room to open the <strong>Room Sidebar</strong>, which shows:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>Tenant name, phone, email (click to copy)</li>
        <li>Monthly rent and appliance surcharges</li>
        <li>Payment status (Paid, Partial, Due, Overdue)</li>
        <li>Unpaid months with individual "Pay Rent" buttons</li>
        <li>Recent transactions</li>
        <li>Receivables (amounts tenant owes you)</li>
      </ul>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Edit Mode (Desktop Only)</h4>
      <p>Click <strong>Edit Mode</strong> in the top-right corner to modify the room layout:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Add rooms</strong> — Click the "+" button, then click on the grid to place</li>
        <li><strong>Move rooms</strong> — Drag and drop rooms on the grid</li>
        <li><strong>Resize rooms</strong> — Drag the edges or corners</li>
        <li><strong>Delete rooms</strong> — Right-click → Delete, or select and press <KeyLabel>Del</KeyLabel></li>
        <li><strong>Duplicate rooms</strong> — Right-click → Duplicate</li>
        <li><strong>Multi-select</strong> — Hold <KeyLabel>Ctrl</KeyLabel> and click multiple rooms</li>
        <li><strong>Undo / Redo</strong> — <KeyLabel>Ctrl+Z</KeyLabel> / <KeyLabel>Ctrl+Y</KeyLabel></li>
      </ul>
      <p className="mt-2">Click <strong>Save Layout</strong> when done. Changes sync to all devices instantly.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Multi-Floor Properties</h4>
      <p>Use the <strong>floor tabs</strong> at the top to switch between floors. Each floor has its own room layout.</p>

      <Tip>On mobile, the map is replaced with a grid list. Tap any room to open the same sidebar.</Tip>
    </Section>

    {/* ── ADDING A TENANT ──────────────────────────────────────── */}
    <Section icon={<FiUsers className="w-5 h-5" />} title="Adding a Tenant">
      <p>Click a <strong>vacant room</strong> on the map, then click <strong>Add Tenant</strong>. Or use <strong>Reports → Add Tenant</strong>.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-2">Required Fields</h4>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Full Name</strong></li>
        <li><strong>Phone Number</strong> — accepts <KeyLabel>09xxxxxxxxx</KeyLabel> or <KeyLabel>+639xxxxxxxxx</KeyLabel> format</li>
        <li><strong>Room</strong> — select from available rooms</li>
        <li><strong>Monthly Rent</strong></li>
        <li><strong>Move-in Date</strong> (defaults to today)</li>
      </ul>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Optional Fields</h4>
      <ul className="list-disc pl-5 space-y-1">
        <li>Business name (for commercial units)</li>
        <li>Email, home location, workplace</li>
        <li>Number of occupants + other occupant details</li>
        <li>Advance / Deposit — check the box and set amount if paid</li>
        <li>Appliances — add appliance names with surcharge amounts</li>
        <li>ID Photo and other document uploads</li>
      </ul>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Batch Rent (Multiple Rooms)</h4>
      <p>Toggle <strong>Batch Mode</strong> to assign one tenant to multiple rooms. Each room can have its own rent amount.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Returning Tenants</h4>
      <p>Click <strong>Search Returning Tenant</strong> to find a former tenant by name or phone. Their basic info is auto-filled so you don't need to re-enter everything.</p>
      <Tip>The system automatically checks for blacklisted tenants (DNR — Do Not Rent). A warning appears if the phone or email matches a blacklisted record.</Tip>
    </Section>

    {/* ── RECORDING PAYMENTS ───────────────────────────────────── */}
    <Section icon={<FiDollarSign className="w-5 h-5" />} title="Recording Payments">
      <p>Click an occupied room → <strong>Pay Rent</strong> (or any payment button in the sidebar).</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-2">Payment Types</h4>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Monthly Rent</strong> — Full or partial payment</li>
        <li><strong>Advance</strong> — Usually 1 month advance</li>
        <li><strong>Deposit</strong> — Security deposit</li>
        <li><strong>Utilities</strong> — Electric, water, internet</li>
        <li><strong>Maintenance / Damages / Other</strong></li>
        <li><strong>Receivable</strong> — Record an amount the tenant owes you (e.g., repairs you paid for)</li>
      </ul>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Payment Methods</h4>
      <p>Cash, GCash, Bank Transfer, Maya, Check, or Other.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Partial Payments</h4>
      <p>If the tenant pays less than the full rent, the system automatically marks it as <strong>Partial</strong> and tracks the remaining balance. A "Pay Balance" button appears to complete the payment later.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Late Payments</h4>
      <p>Mark a payment as <strong>Late</strong> and an auto-calculated late fee is added (default: ₱50 per day overdue). You can adjust the fee amount.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Paying Specific Months</h4>
      <p>In the room sidebar's "Unpaid Months" section, click the <strong>Pay Rent</strong> button next to any specific month to record payment for that month.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Sending Confirmation</h4>
      <p>After recording a payment, you'll be asked to send a confirmation to the tenant via <strong>SMS</strong>, <strong>Email</strong>, or <strong>Both</strong>. You can also skip this step.</p>
    </Section>

    {/* ── TENANT PROFILE ───────────────────────────────────────── */}
    <Section icon={<FiEdit className="w-5 h-5" />} title="Tenant Profile & Management">
      <p>Click a tenant's name in the room sidebar (or from Reports → Tenant List) to open their full profile.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-2">Profile Features</h4>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Personal info</strong> — View and edit tenant details</li>
        <li><strong>Payment history</strong> — All transactions with date filters and pagination</li>
        <li><strong>Documents</strong> — Upload and manage ID photos, contracts, and other files</li>
        <li><strong>Notes</strong> — Rich text editor for violations, remarks, or any notes (auto-saves)</li>
        <li><strong>Receivables</strong> — Track amounts the tenant owes you with "Mark Received" buttons</li>
      </ul>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Tenant Actions</h4>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Edit Tenant</strong> — Update personal info, rent, or room assignment</li>
        <li><strong>Transfer Tenant</strong> — Move to a different room (preserves all history)</li>
        <li><strong>Remove Tenant</strong> — Records move-out date. You can optionally blacklist (DNR) the tenant with a reason.</li>
        <li><strong>Send Reminder</strong> — Quick SMS or email to the tenant</li>
      </ul>
      <Tip>Removed tenants are kept in the system. You can find them via "Search Returning Tenant" when adding a new tenant, or view them in Reports by enabling "Show Previous Tenants".</Tip>
    </Section>

    {/* ── DASHBOARD ────────────────────────────────────────────── */}
    <Section icon={<FiBarChart2 className="w-5 h-5" />} title="Dashboard — Analytics">
      <p>The dashboard shows analytics for the currently selected property.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-2">Stats Cards</h4>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Total Tenants</strong> — Active tenants in this property</li>
        <li><strong>Vacant Rooms</strong> — Available rooms</li>
        <li><strong>Monthly Income</strong> — Total expected if all tenants pay</li>
        <li><strong>Collected</strong> — Rent collected this month with percentage</li>
        <li><strong>Outstanding</strong> — Total unpaid balances</li>
        <li><strong>Year Revenue</strong> — Total collected for the selected year</li>
      </ul>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Charts</h4>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Income Overview</strong> — Monthly collected vs expected rent</li>
        <li><strong>Occupancy Rate</strong> — Monthly occupancy percentage</li>
        <li><strong>Payment Status</strong> — Pie chart: Paid / Partial / Unpaid / Not Due</li>
      </ul>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Upcoming Due Dates</h4>
      <p>Shows tenants sorted by urgency: overdue (red) → due today (amber) → due soon (blue). Click any tenant to view their profile.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">To-Do List</h4>
      <p>Property-specific task manager. Add tasks with priority levels (High / Normal / Low), mark as complete, or delete. Tasks are saved per property.</p>
    </Section>

    {/* ── REPORTS ───────────────────────────────────────────────── */}
    <Section icon={<FiFileText className="w-5 h-5" />} title="Reports & Data Export">
      <p>Access via the <strong>Reports</strong> tab in the sidebar.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-2">Report Views</h4>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Overview</strong> — Summary stats and recent payments</li>
        <li><strong>Tenant List</strong> — All active tenants (toggle to include former tenants)</li>
        <li><strong>Payment History</strong> — All transactions with date filters</li>
        <li><strong>Balance List</strong> — Tenants with outstanding amounts</li>
        <li><strong>Rent Collected</strong> — Detailed payment breakdown by date range</li>
        <li><strong>Rooms List</strong> — All rooms with status information</li>
      </ul>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Exporting Data</h4>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>CSV Export</strong> — Download tenant list or payment history as spreadsheet</li>
        <li><strong>PDF Export</strong> — Generate formatted report for printing</li>
      </ul>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Importing Data</h4>
      <Step number="1">Click <strong>Import</strong> and choose the mode: <strong>Tenants</strong> or <strong>Payment History</strong>.</Step>
      <Step number="2">Download the <strong>CSV Template</strong> to see the required format.</Step>
      <Step number="3">Fill in your data and upload the CSV file.</Step>
      <Step number="4">Review the preview and confirm the import.</Step>
      <Tip>Importing tenants will create tenant records and assign them to rooms. Importing payments adds transactions to existing tenants.</Tip>
    </Section>

    {/* ── MESSAGING ────────────────────────────────────────────── */}
    <Section icon={<FiMessageSquare className="w-5 h-5" />} title="Messaging — SMS & Email">
      <p>Access via the <strong>Message</strong> tab in the sidebar.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-2">Sending Manual Messages</h4>
      <Step number="1">Select recipients — search by name, select individually, by floor, or select all.</Step>
      <Step number="2">Choose channel: <strong>SMS</strong>, <strong>Email</strong>, or <strong>Both</strong>.</Step>
      <Step number="3">Type your message or use a <strong>Quick Template</strong> (Payment Reminder, Maintenance, Rent Adjustment).</Step>
      <Step number="4">Click <strong>Send</strong>.</Step>
      <Tip>SMS has a 160-character limit per message segment. The character counter helps you stay within limits.</Tip>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Automated Messages</h4>
      <p>Switch to the <strong>Automated</strong> tab to set up automatic rent reminders:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Enable/Disable</strong> automation per property</li>
        <li><strong>Message Template</strong> — Use placeholders: <KeyLabel>[Tenant Name]</KeyLabel>, <KeyLabel>[Payment Amount]</KeyLabel>, <KeyLabel>[Days Left]</KeyLabel>, <KeyLabel>[Due Date]</KeyLabel>, <KeyLabel>[Room Number]</KeyLabel>, <KeyLabel>[Balance]</KeyLabel></li>
        <li><strong>Reminder Days</strong> — Choose which days before due date to send (e.g., 7, 3, 1, 0 days)</li>
        <li><strong>Send Time</strong> — Set the hour and minute for delivery</li>
        <li><strong>Channels</strong> — SMS, Email, or Both</li>
        <li><strong>Email Subject</strong> — Customize the email subject line</li>
        <li><strong>Owner Copy</strong> — Receive a copy of every reminder sent to tenants</li>
      </ul>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Per-Tenant Schedules</h4>
      <p>Override the property-level schedule for individual tenants. Useful when tenants have different due dates or preferred notification times.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">SMS Gateway Setup</h4>
      <p>The system sends SMS through your Android phone using the <strong>Android SMS Gateway</strong> app. Use the <strong>Diagnostics</strong> button to test if your gateway is connected and working.</p>
    </Section>

    {/* ── MESSAGE LOGS ─────────────────────────────────────────── */}
    <Section icon={<FiMail className="w-5 h-5" />} title="Message Logs">
      <p>Access via <strong>Logs → Messages</strong> tab.</p>
      <p>Every message sent through the system is recorded here — manual messages, mass messages, automated reminders, and payment confirmations.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-2">What's Logged</h4>
      <ul className="list-disc pl-5 space-y-1">
        <li>Recipient name and contact info</li>
        <li>Channel (SMS / Email / Push)</li>
        <li>Message type (Manual / Mass / Automated / Payment / Test)</li>
        <li>Delivery status (<span className="text-green-600 font-bold">Sent</span> or <span className="text-red-600 font-bold">Failed</span>)</li>
        <li>Error details for failed messages</li>
        <li>Who sent it and when</li>
      </ul>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Failed Messages</h4>
      <p>Failed messages are highlighted in red. A <strong>red badge</strong> on the Messages tab shows the total number of failures so you can quickly spot delivery issues.</p>
      <Tip>Common failure reasons: invalid phone number, SMS gateway offline, email address invalid, or network timeout. Check the error message for details.</Tip>
    </Section>

    {/* ── ACTIVITY LOGS ────────────────────────────────────────── */}
    <Section icon={<FiActivity className="w-5 h-5" />} title="Activity Logs">
      <p>The <strong>Logs</strong> section tracks everything that happens in your system.</p>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Activity tab</strong> — Tenant added, payment recorded, tenant removed, transfers, edits, etc.</li>
        <li><strong>System tab</strong> — Admin-level events (building created, user created, etc.)</li>
        <li><strong>Messages tab</strong> — All sent SMS, emails, and push notifications</li>
      </ul>
      <p className="mt-2">Use the <strong>search bar</strong> and <strong>severity filter</strong> (Info / Warning / Critical) to find specific events.</p>
    </Section>

    {/* ── SECURITY & SETTINGS ──────────────────────────────────── */}
    <Section icon={<FiSettings className="w-5 h-5" />} title="Settings & Security">
      <p>Access via the <strong>Settings</strong> gear icon in the sidebar.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-2">Security Alerts</h4>
      <p>View failed login attempts, suspicious activity, and account lockouts. Acknowledge alerts to clear them.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Active Sessions</h4>
      <p>See all devices currently logged into your account. Revoke any session you don't recognize. Your current session is highlighted.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Change Password</h4>
      <p>Enter your current password and set a new one. Changing your password automatically logs out all other sessions for security.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Two-Factor Authentication (2FA)</h4>
      <p>When you log in from a new device, a <strong>6-digit code</strong> is sent to your email. Enter the code to verify your identity. Your device is then trusted for <strong>30 days</strong> before you're asked again.</p>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Dark Mode</h4>
      <p>Toggle dark mode from the sidebar (sun/moon icon) or the mobile "More" menu.</p>
    </Section>

    {/* ── TIPS & SHORTCUTS ─────────────────────────────────────── */}
    <Section icon={<FiSmartphone className="w-5 h-5" />} title="Tips & Shortcuts">
      <h4 className="font-bold text-gray-900 dark:text-white">General</h4>
      <ul className="list-disc pl-5 space-y-1">
        <li>Click any <strong>phone number</strong> or <strong>email</strong> to copy it to clipboard</li>
        <li>The app works offline as a <strong>PWA</strong> — install it from your browser for app-like experience</li>
        <li>Data syncs in real-time across all devices via WebSocket</li>
        <li>Use <strong>dark mode</strong> for comfortable night viewing</li>
      </ul>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Keyboard Shortcuts (Desktop Edit Mode)</h4>
      <ul className="list-disc pl-5 space-y-1">
        <li><KeyLabel>Ctrl+Z</KeyLabel> — Undo</li>
        <li><KeyLabel>Ctrl+Y</KeyLabel> — Redo</li>
        <li><KeyLabel>Del</KeyLabel> — Delete selected rooms</li>
        <li><KeyLabel>Ctrl+Click</KeyLabel> — Multi-select rooms</li>
        <li><KeyLabel>Esc</KeyLabel> — Close sidebar or cancel action</li>
      </ul>

      <h4 className="font-bold text-gray-900 dark:text-white mt-4">Mobile Tips</h4>
      <ul className="list-disc pl-5 space-y-1">
        <li>Scroll down to auto-hide the bottom navigation bar</li>
        <li>Tap the profile picture in the bottom bar for logout and settings</li>
        <li>Switch properties from the top property selector</li>
      </ul>
    </Section>
  </div>
);

const UserManual = ({ isAdmin = false }) => {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="text-center pb-2">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs font-bold uppercase tracking-widest mb-3">
          {isAdmin ? 'Admin Manual' : 'Owner / Manager Manual'}
        </div>
        <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">User Manual</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Click any section to expand it</p>
      </div>

      {isAdmin ? <AdminManual /> : <OwnerManagerManual />}

      <div className="text-center py-4">
        <p className="text-xs text-gray-400 dark:text-gray-500">MP-SAN Tenant Management System v1.0</p>
      </div>
    </div>
  );
};

export default UserManual;

# Admin Dashboard Access Guide

## Overview

The Self-Healing System Dashboard is **INTERNAL ONLY** - accessible exclusively by AI Lead Strategies LLC staff. Regular platform users/subscribers NEVER see this dashboard.

## Access Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI Lead Strategies Platform                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SUBSCRIBER ACCESS (5 tiers)          ADMIN ACCESS (internal)    │
│  ─────────────────────────           ────────────────────────    │
│  /login                               /admin/login               │
│  /dashboard/*                         /admin/dashboard           │
│                                                                  │
│  User sees their:                     Admin sees:                │
│  • Leads                              • System Health            │
│  • Campaigns                          • All Agents Status        │
│  • Website builder                    • Platform-wide Stats      │
│  • Videos                             • All Users                │
│  • Analytics                          • Audit Logs               │
│                                       • Security Incidents       │
│                                                                  │
│  User Table: users                    Admin Table: admin_users   │
│  Auth: JWT (user tokens)              Auth: JWT (admin tokens)   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## How to Access

### URL
```
https://yourdomain.com/admin/login
```

### Default Credentials (CHANGE IMMEDIATELY)
```
Email: admin@aileadstrategies.com
Password: ChangeThisPassword123!
```

### First-Time Setup
```bash
# Set environment variables
export SUPER_ADMIN_EMAIL=admin@aileadstrategies.com
export SUPER_ADMIN_PASSWORD=YourSecurePassword123!

# Run seed script
node prisma/seed-admin.js

# Run migrations
npx prisma migrate deploy
```

---

## Admin Roles

| Role | Permissions |
|------|------------|
| `super_admin` | Full access - can manage other admins |
| `admin` | View dashboard, manage users, acknowledge alerts |
| `viewer` | Read-only access to dashboard |

---

## Admin Routes (Protected)

### Authentication
```
POST /admin/login         # Admin login
POST /admin/logout        # Admin logout
GET  /admin/me            # Current admin info
```

### System Monitoring (from self-healing system)
```
GET  /admin/system/health           # System health
GET  /admin/system/dashboard        # Full dashboard data
GET  /admin/system/agents           # Agent status
GET  /admin/system/alerts           # Active alerts
POST /admin/system/agents/:name/restart  # Restart agent
```

### User Management
```
GET  /admin/users         # List all platform users
GET  /admin/users/:id     # User details
GET  /admin/stats         # Platform statistics
```

### Admin Management (super_admin only)
```
GET    /admin/admins      # List admin users
POST   /admin/admins      # Create admin user
DELETE /admin/admins/:id  # Delete admin user
GET    /admin/audit-logs  # View audit logs
```

---

## Security Features

1. **Separate Authentication**
   - Admin tokens are completely separate from user tokens
   - Different JWT secret (`ADMIN_JWT_SECRET`)
   - Shorter token expiry (4 hours vs 7 days)

2. **Rate Limiting**
   - 5 failed login attempts = 15 minute lockout
   - Per-email + per-IP tracking

3. **Audit Logging**
   - Every admin action is logged
   - Includes: action, resource, IP, user agent, timestamp

4. **Session Management**
   - Sessions stored in database
   - Can be revoked by super admin
   - Auto-expire after 4 hours

5. **MFA Ready**
   - `mfaEnabled` and `mfaSecret` fields ready for TOTP

---

## Environment Variables

```env
# Required
ADMIN_JWT_SECRET=your-super-secure-admin-secret-key

# Initial super admin (for seeding)
SUPER_ADMIN_EMAIL=admin@aileadstrategies.com
SUPER_ADMIN_PASSWORD=ChangeThisPassword123!
```

---

## Database Schema

```prisma
model AdminUser {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  name         String
  role         String   @default("admin")  // super_admin, admin, viewer
  permissions  String[] @default([])
  mfaEnabled   Boolean  @default(false)
  mfaSecret    String?
  lastLoginAt  DateTime?
  lastLoginIp  String?
  failedLogins Int      @default(0)
  lockedUntil  DateTime?
  createdBy    String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  auditLogs AdminAuditLog[]
}

model AdminAuditLog {
  id          String   @id @default(uuid())
  adminUserId String
  action      String
  resource    String?
  resourceId  String?
  details     Json?
  ipAddress   String?
  userAgent   String?
  createdAt   DateTime @default(now())

  adminUser AdminUser @relation(...)
}

model AdminSession {
  id           String   @id @default(uuid())
  adminUserId  String
  token        String   @unique
  ipAddress    String?
  userAgent    String?
  expiresAt    DateTime
  createdAt    DateTime @default(now())
  lastActiveAt DateTime @default(now())
}
```

---

## Integration with Main Server

Add to `backend/src/index.js`:

```javascript
// Import admin routes
const adminRoutes = require('./routes/adminRoutes');

// Mount admin routes (BEFORE general routes)
app.use('/admin', adminRoutes);

// Note: /admin routes are completely separate from /api/v1 user routes
```

---

## User Dashboard vs Admin Dashboard

| Feature | User Dashboard | Admin Dashboard |
|---------|---------------|-----------------|
| URL | `/dashboard/*` | `/admin/dashboard` |
| Auth | User JWT | Admin JWT |
| Sees own data only | ✅ | N/A |
| Sees all users | ❌ | ✅ |
| System health | ❌ | ✅ |
| Restart agents | ❌ | ✅ |
| View audit logs | ❌ | ✅ (super_admin) |

---

## Quick Reference

**Login as Admin:**
1. Go to `/admin/login`
2. Enter admin credentials
3. You'll be redirected to `/admin/dashboard`

**Create New Admin:**
1. Login as super_admin
2. Go to Admin Users tab
3. Click "Create Admin"
4. Enter email, password, role

**View System Health:**
1. Login as any admin
2. System Health tab shows all agents, alerts, metrics

**Acknowledge Alert:**
1. Go to System Health tab
2. Find alert in Active Alerts panel
3. Click "Acknowledge"

---

## Files Reference

```
backend/
├── src/
│   ├── middleware/
│   │   └── adminAuth.js           # Admin authentication
│   ├── routes/
│   │   └── adminRoutes.js         # Admin API routes
│   └── system-agents/
│       └── routes/
│           └── systemRoutes.js    # System monitoring routes
└── prisma/
    ├── schema.prisma              # AdminUser, AdminSession, AdminAuditLog
    └── seed-admin.js              # Seed super admin

frontend/
└── app/
    ├── admin/
    │   ├── login/
    │   │   └── page.jsx           # Admin login page
    │   └── dashboard/
    │       └── page.jsx           # Admin dashboard page
    ├── api/
    │   └── admin/
    │       ├── login/route.js
    │       ├── logout/route.js
    │       ├── me/route.js
    │       ├── users/route.js
    │       └── stats/route.js
    └── components/
        └── SystemDashboard.jsx    # System health component
```

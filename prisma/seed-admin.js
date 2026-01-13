/**
 * Admin User Seed Script
 * AI Lead Strategies LLC
 *
 * Creates the initial super admin user
 * Run with: node prisma/seed-admin.js
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function seedAdmin() {
  console.log('🔐 Seeding admin users...\n');

  // Default super admin - CHANGE PASSWORD IN PRODUCTION
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@aileadstrategies.com';
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'ChangeThisPassword123!';

  try {
    // Check if super admin already exists
    const existing = await prisma.adminUser.findUnique({
      where: { email: superAdminEmail }
    });

    if (existing) {
      console.log(`✅ Super admin already exists: ${superAdminEmail}`);
      return;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(superAdminPassword, 12);

    // Create super admin
    const superAdmin = await prisma.adminUser.create({
      data: {
        email: superAdminEmail,
        passwordHash,
        name: 'AI Lead Strategies Admin',
        role: 'super_admin',
        permissions: ['*'], // All permissions
        mfaEnabled: false   // Enable MFA in production!
      }
    });

    console.log('✅ Super admin created successfully!');
    console.log(`   Email: ${superAdmin.email}`);
    console.log(`   Role: ${superAdmin.role}`);
    console.log('\n⚠️  IMPORTANT: Change the default password immediately!');
    console.log('   1. Login to /admin/login');
    console.log('   2. Go to settings and change password');
    console.log('   3. Enable MFA for security\n');

  } catch (error) {
    console.error('❌ Error seeding admin:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  seedAdmin()
    .then(() => {
      console.log('✨ Admin seeding complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Failed to seed admin:', error);
      process.exit(1);
    });
}

module.exports = { seedAdmin };

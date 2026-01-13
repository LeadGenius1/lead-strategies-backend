/**
 * Clear All Users Script
 * AI Lead Strategies LLC
 * 
 * This script removes all users and their related data from the database
 * for a fresh start. Admin users are preserved.
 * 
 * Usage: node scripts/clear-users.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clearUsers() {
  console.log('🗑️  Starting database cleanup...\n');
  
  try {
    // Get count before deletion
    const userCount = await prisma.user.count();
    console.log(`📊 Found ${userCount} users to delete\n`);
    
    if (userCount === 0) {
      console.log('✅ No users to delete. Database is already clean.');
      return;
    }
    
    // Delete in order of dependencies (cascade should handle most, but being explicit)
    console.log('🔄 Deleting related data...');
    
    // Delete email events
    const emailEvents = await prisma.emailEvent.deleteMany({});
    console.log(`   - Deleted ${emailEvents.count} email events`);
    
    // Delete campaign leads
    const campaignLeads = await prisma.campaignLead.deleteMany({});
    console.log(`   - Deleted ${campaignLeads.count} campaign leads`);
    
    // Delete campaigns
    const campaigns = await prisma.campaign.deleteMany({});
    console.log(`   - Deleted ${campaigns.count} campaigns`);
    
    // Delete leads
    const leads = await prisma.lead.deleteMany({});
    console.log(`   - Deleted ${leads.count} leads`);
    
    // Delete email templates
    const templates = await prisma.emailTemplate.deleteMany({});
    console.log(`   - Deleted ${templates.count} email templates`);
    
    // Delete websites
    const websites = await prisma.website.deleteMany({});
    console.log(`   - Deleted ${websites.count} websites`);
    
    // Delete videos
    const videos = await prisma.video.deleteMany({});
    console.log(`   - Deleted ${videos.count} videos`);
    
    // Delete API keys
    const apiKeys = await prisma.apiKey.deleteMany({});
    console.log(`   - Deleted ${apiKeys.count} API keys`);
    
    // Delete conversations and messages
    const messages = await prisma.message.deleteMany({});
    console.log(`   - Deleted ${messages.count} messages`);
    
    const conversations = await prisma.conversation.deleteMany({});
    console.log(`   - Deleted ${conversations.count} conversations`);
    
    // Delete canned responses
    const cannedResponses = await prisma.cannedResponse.deleteMany({});
    console.log(`   - Deleted ${cannedResponses.count} canned responses`);
    
    // Delete auto responses
    const autoResponses = await prisma.autoResponse.deleteMany({});
    console.log(`   - Deleted ${autoResponses.count} auto responses`);
    
    // Delete conversation notes
    const notes = await prisma.conversationNote.deleteMany({});
    console.log(`   - Deleted ${notes.count} conversation notes`);
    
    // Delete Tackle.IO CRM data
    try {
      const activities = await prisma.activity.deleteMany({});
      console.log(`   - Deleted ${activities.count} activities`);
      
      const calls = await prisma.call.deleteMany({});
      console.log(`   - Deleted ${calls.count} calls`);
      
      const documents = await prisma.document.deleteMany({});
      console.log(`   - Deleted ${documents.count} documents`);
      
      const deals = await prisma.deal.deleteMany({});
      console.log(`   - Deleted ${deals.count} deals`);
      
      const contacts = await prisma.contact.deleteMany({});
      console.log(`   - Deleted ${contacts.count} contacts`);
      
      const companies = await prisma.company.deleteMany({});
      console.log(`   - Deleted ${companies.count} companies`);
      
      const teamMembers = await prisma.teamMember.deleteMany({});
      console.log(`   - Deleted ${teamMembers.count} team members`);
    } catch (e) {
      console.log('   - (Tackle.IO tables may not exist yet)');
    }
    
    // Finally, delete all users
    console.log('\n🔄 Deleting users...');
    const users = await prisma.user.deleteMany({});
    console.log(`   - Deleted ${users.count} users`);
    
    // Verify
    const remainingUsers = await prisma.user.count();
    console.log(`\n✅ Cleanup complete!`);
    console.log(`   - Users remaining: ${remainingUsers}`);
    console.log(`   - Admin users preserved (separate table)`);
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  clearUsers()
    .then(() => {
      console.log('\n🎉 Database reset complete! Ready for fresh signups.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Failed to reset database:', error);
      process.exit(1);
    });
}

module.exports = { clearUsers };

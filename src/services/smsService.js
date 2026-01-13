// SMS Channel Service
// Supports Twilio

const SMS_SERVICE = process.env.SMS_SERVICE || 'mock'; // 'twilio', 'mock'
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

let twilioClient = null;

// Initialize Twilio
if (SMS_SERVICE === 'twilio' && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  try {
    const twilio = require('twilio');
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  } catch (error) {
    console.error('Failed to initialize Twilio:', error);
  }
}

/**
 * Send SMS via configured service
 * @param {Object} options - SMS options
 * @param {string} options.to - Recipient phone number (E.164 format)
 * @param {string} options.body - Message body
 * @param {string} options.from - From phone number (optional, uses default)
 * @returns {Promise<Object>} - Result with success status and messageId
 */
async function sendSMS({ to, body, from = TWILIO_PHONE_NUMBER }) {
  if (!to || !body) {
    throw new Error('Missing required SMS fields: to and body');
  }

  // Mock mode (for development/testing)
  if (SMS_SERVICE === 'mock') {
    console.log('[MOCK SMS]', {
      to,
      from: from || 'MOCK',
      body: body.substring(0, 100) + (body.length > 100 ? '...' : ''),
    });
    return {
      success: true,
      messageId: `mock-sms-${Date.now()}`,
      service: 'mock',
    };
  }

  // Twilio
  if (SMS_SERVICE === 'twilio' && twilioClient) {
    try {
      if (!from) {
        throw new Error('Twilio phone number not configured. Set TWILIO_PHONE_NUMBER.');
      }

      const message = await twilioClient.messages.create({
        body,
        to,
        from,
      });

      return {
        success: true,
        messageId: message.sid,
        service: 'twilio',
        status: message.status,
      };
    } catch (error) {
      console.error('Twilio error:', error);
      throw new Error(`Twilio error: ${error.message}`);
    }
  }

  throw new Error(`SMS service not configured. Set SMS_SERVICE and required API keys.`);
}

/**
 * Format phone number to E.164 format
 * @param {string} phone - Phone number
 * @returns {string} - E.164 formatted number
 */
function formatPhoneNumber(phone) {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  // If starts with 1 and has 11 digits, assume US number
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  
  // If 10 digits, assume US number and add +1
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  
  // If already has +, return as is
  if (phone.startsWith('+')) {
    return phone;
  }
  
  // Otherwise, add + prefix
  return `+${digits}`;
}

module.exports = {
  sendSMS,
  formatPhoneNumber,
  SMS_SERVICE,
};

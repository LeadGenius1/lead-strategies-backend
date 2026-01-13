// Unified Channel Service
// Routes messages to appropriate channel service (email, SMS, etc.)

const emailService = require('./emailService');
const smsService = require('./smsService');

/**
 * Send message via appropriate channel
 * @param {Object} options - Message options
 * @param {string} options.channel - Channel type ('email', 'sms', etc.)
 * @param {string} options.to - Recipient address/phone
 * @param {string} options.content - Message content
 * @param {string} options.subject - Subject (for email)
 * @param {string} options.htmlContent - HTML content (for email)
 * @param {string} options.from - From address/phone
 * @param {string} options.fromName - From name (for email)
 * @param {string} options.replyTo - Reply-to address (for email)
 * @param {string} options.inReplyTo - In-Reply-To header (for email threading)
 * @param {string} options.references - References header (for email threading)
 * @returns {Promise<Object>} - Result with success status and messageId
 */
async function sendMessage(options) {
  const { channel, to, content, subject, htmlContent, from, fromName, replyTo, inReplyTo, references } = options;

  if (!channel || !to || !content) {
    throw new Error('Missing required fields: channel, to, and content');
  }

  switch (channel.toLowerCase()) {
    case 'email':
      return await emailService.sendEmail({
        to,
        subject: subject || 'No Subject',
        text: content,
        html: htmlContent,
        from,
        fromName,
        replyTo,
        inReplyTo,
        references,
      });

    case 'sms':
      return await smsService.sendSMS({
        to: smsService.formatPhoneNumber(to),
        body: content,
        from,
      });

    case 'whatsapp':
      // WhatsApp uses Twilio API with different endpoint
      // For now, fall back to SMS
      if (smsService.SMS_SERVICE === 'twilio') {
        return await smsService.sendSMS({
          to: smsService.formatPhoneNumber(to),
          body: content,
          from: `whatsapp:${from || smsService.TWILIO_PHONE_NUMBER}`,
        });
      }
      throw new Error('WhatsApp requires Twilio configuration');

    default:
      throw new Error(`Unsupported channel: ${channel}`);
  }
}

/**
 * Get channel service status
 * @returns {Object} - Status of each channel service
 */
function getChannelStatus() {
  return {
    email: {
      service: emailService.EMAIL_SERVICE,
      configured: emailService.EMAIL_SERVICE !== 'mock' && 
                  (emailService.EMAIL_SERVICE === 'sendgrid' ? !!process.env.SENDGRID_API_KEY :
                   emailService.EMAIL_SERVICE === 'ses' ? !!(process.env.AWS_SES_ACCESS_KEY && process.env.AWS_SES_SECRET_KEY) :
                   false),
    },
    sms: {
      service: smsService.SMS_SERVICE,
      configured: smsService.SMS_SERVICE === 'twilio' && 
                  !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER),
    },
  };
}

module.exports = {
  sendMessage,
  getChannelStatus,
};

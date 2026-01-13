// Email Channel Service
// Supports SendGrid and AWS SES

const EMAIL_SERVICE = process.env.EMAIL_SERVICE || 'mock'; // 'sendgrid', 'ses', 'mock'
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const AWS_SES_REGION = process.env.AWS_SES_REGION || 'us-east-1';
const AWS_SES_ACCESS_KEY = process.env.AWS_SES_ACCESS_KEY;
const AWS_SES_SECRET_KEY = process.env.AWS_SES_SECRET_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@leadsite.ai';
const FROM_NAME = process.env.FROM_NAME || 'LeadSite.AI';

let sendgridClient = null;
let sesClient = null;

// Initialize SendGrid
if (EMAIL_SERVICE === 'sendgrid' && SENDGRID_API_KEY) {
  try {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(SENDGRID_API_KEY);
    sendgridClient = sgMail;
  } catch (error) {
    console.error('Failed to initialize SendGrid:', error);
  }
}

// Initialize AWS SES
if (EMAIL_SERVICE === 'ses' && AWS_SES_ACCESS_KEY && AWS_SES_SECRET_KEY) {
  try {
    const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
    sesClient = new SESClient({
      region: AWS_SES_REGION,
      credentials: {
        accessKeyId: AWS_SES_ACCESS_KEY,
        secretAccessKey: AWS_SES_SECRET_KEY,
      },
    });
  } catch (error) {
    console.error('Failed to initialize AWS SES:', error);
  }
}

/**
 * Send email via configured service
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.text - Plain text content
 * @param {string} options.html - HTML content (optional)
 * @param {string} options.from - From email (optional, uses default)
 * @param {string} options.fromName - From name (optional, uses default)
 * @param {string} options.replyTo - Reply-to email (optional)
 * @param {string} options.inReplyTo - In-Reply-To header for threading (optional)
 * @param {string} options.references - References header for threading (optional)
 * @returns {Promise<Object>} - Result with success status and messageId
 */
async function sendEmail({
  to,
  subject,
  text,
  html,
  from = FROM_EMAIL,
  fromName = FROM_NAME,
  replyTo,
  inReplyTo,
  references,
}) {
  if (!to || !subject || (!text && !html)) {
    throw new Error('Missing required email fields: to, subject, and text/html');
  }

  // Mock mode (for development/testing)
  if (EMAIL_SERVICE === 'mock') {
    console.log('[MOCK EMAIL]', {
      to,
      from: `${fromName} <${from}>`,
      subject,
      text: text?.substring(0, 100) + '...',
      html: html ? 'HTML content' : null,
    });
    return {
      success: true,
      messageId: `mock-${Date.now()}`,
      service: 'mock',
    };
  }

  // SendGrid
  if (EMAIL_SERVICE === 'sendgrid' && sendgridClient) {
    try {
      const msg = {
        to,
        from: {
          email: from,
          name: fromName,
        },
        subject,
        text,
        html,
        ...(replyTo && { replyTo }),
        ...(inReplyTo && {
          headers: {
            'In-Reply-To': inReplyTo,
            ...(references && { References: references }),
          },
        }),
      };

      const [response] = await sendgridClient.send(msg);
      return {
        success: true,
        messageId: response.headers['x-message-id'] || `sg-${Date.now()}`,
        service: 'sendgrid',
      };
    } catch (error) {
      console.error('SendGrid error:', error);
      throw new Error(`SendGrid error: ${error.message}`);
    }
  }

  // AWS SES
  if (EMAIL_SERVICE === 'ses' && sesClient) {
    try {
      const { SendEmailCommand } = require('@aws-sdk/client-ses');
      
      const params = {
        Source: `${fromName} <${from}>`,
        Destination: {
          ToAddresses: [to],
        },
        Message: {
          Subject: {
            Data: subject,
            Charset: 'UTF-8',
          },
          Body: {
            ...(text && {
              Text: {
                Data: text,
                Charset: 'UTF-8',
              },
            }),
            ...(html && {
              Html: {
                Data: html,
                Charset: 'UTF-8',
              },
            }),
          },
        },
        ...(replyTo && { ReplyToAddresses: [replyTo] }),
      };

      // Add headers for threading
      if (inReplyTo || references) {
        params.Message.Headers = {};
        if (inReplyTo) params.Message.Headers['In-Reply-To'] = [{ Data: inReplyTo }];
        if (references) params.Message.Headers.References = [{ Data: references }];
      }

      const command = new SendEmailCommand(params);
      const response = await sesClient.send(command);
      
      return {
        success: true,
        messageId: response.MessageId,
        service: 'ses',
      };
    } catch (error) {
      console.error('AWS SES error:', error);
      throw new Error(`AWS SES error: ${error.message}`);
    }
  }

  throw new Error(`Email service not configured. Set EMAIL_SERVICE and required API keys.`);
}

/**
 * Generate email thread headers for conversation threading
 * @param {string} conversationId - Conversation ID
 * @param {string} messageId - Current message ID
 * @param {string} previousMessageId - Previous message ID (optional)
 * @returns {Object} - Thread headers
 */
function generateThreadHeaders(conversationId, messageId, previousMessageId = null) {
  const domain = process.env.EMAIL_DOMAIN || 'leadsite.ai';
  const currentMessageId = `<${messageId}@${domain}>`;
  
  if (previousMessageId) {
    return {
      inReplyTo: `<${previousMessageId}@${domain}>`,
      references: `<${previousMessageId}@${domain}>`,
    };
  }
  
  return {
    messageId: currentMessageId,
  };
}

module.exports = {
  sendEmail,
  generateThreadHeaders,
  EMAIL_SERVICE,
};

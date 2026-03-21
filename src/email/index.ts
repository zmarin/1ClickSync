import nodemailer from 'nodemailer';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

// Lazy-initialized transporter
let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    const smtpUrl = process.env.SMTP_URL;
    if (smtpUrl) {
      transporter = nodemailer.createTransport(smtpUrl);
    } else {
      // Fallback: log emails to console in development
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'localhost',
        port: parseInt(process.env.SMTP_PORT || '1025'),
        secure: false,
        auth: process.env.SMTP_USER ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        } : undefined,
      });
    }
  }
  return transporter;
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  const from = process.env.EMAIL_FROM || '1ClickSync <noreply@1clicksync.com>';
  
  try {
    const info = await getTransporter().sendMail({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    console.log(`[Email] Sent to ${options.to}: ${info.messageId}`);
  } catch (err) {
    console.error(`[Email] Failed to send to ${options.to}:`, err);
    // Don't throw — email failure shouldn't break the flow
  }
}

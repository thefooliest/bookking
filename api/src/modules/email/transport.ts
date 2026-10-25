import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  messageId: string;
};

export type EmailSender = (message: EmailMessage) => Promise<void>;

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false
    });
  }

  return transporter;
}

export const smtpEmailSender: EmailSender = async (message) => {
  await getTransporter().sendMail({
    from: env.SMTP_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    messageId: message.messageId
  });
};

import { Injectable } from '@nestjs/common';
import { render } from '@react-email/render';
import { createTransport } from 'nodemailer';
import React from 'react';
import { AlbumInviteEmail } from 'src/emails/album-invite.email.js';
import { AlbumUpdateEmail } from 'src/emails/album-update.email.js';
import { TestEmail } from 'src/emails/test.email.js';
import { WelcomeEmail } from 'src/emails/welcome.email.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import type { EmailImageAttachment } from 'src/types.js';

export type SendEmailOptions = {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  imageAttachments?: EmailImageAttachment[];
  smtp: SmtpOptions;
};

export type SmtpOptions = {
  host: string;
  port?: number;
  secure?: boolean;
  username?: string;
  password?: string;
  ignoreCert?: boolean;
};

export enum EmailTemplate {
  TEST_EMAIL = 'test',

  // AUTH
  WELCOME = 'welcome',
  RESET_PASSWORD = 'reset-password',

  // ALBUM
  ALBUM_INVITE = 'album-invite',
  ALBUM_UPDATE = 'album-update',
}

interface BaseEmailProps {
  baseUrl: string;
  customTemplate?: string;
}

export interface TestEmailProps extends BaseEmailProps {
  displayName: string;
}

export interface WelcomeEmailProps extends BaseEmailProps {
  displayName: string;
  username: string;
  password?: string;
}

export interface AlbumInviteEmailProps extends BaseEmailProps {
  albumName: string;
  albumId: string;
  senderName: string;
  recipientName: string;
  cid?: string;
}

export interface AlbumUpdateEmailProps extends BaseEmailProps {
  albumName: string;
  albumId: string;
  recipientName: string;
  cid?: string;
}

export type EmailRenderRequest =
  | {
      template: EmailTemplate.TEST_EMAIL;
      data: TestEmailProps;
      customTemplate: string;
    }
  | {
      template: EmailTemplate.WELCOME;
      data: WelcomeEmailProps;
      customTemplate: string;
    }
  | {
      template: EmailTemplate.ALBUM_INVITE;
      data: AlbumInviteEmailProps;
      customTemplate: string;
    }
  | {
      template: EmailTemplate.ALBUM_UPDATE;
      data: AlbumUpdateEmailProps;
      customTemplate: string;
    };

export type SendEmailResponse = {
  messageId: string;
  response: any;
};

@Injectable()
export class EmailRepository {
  constructor(private logger: LoggingRepository) {
    this.logger.setContext(EmailRepository.name);
  }

  async verifySmtp(options: SmtpOptions): Promise<true> {
    const transport = this.createTransport(options);
    try {
      await transport.verify();
      return true;
    } catch (error) {
      this.logger.error(
        `SMTP verify failed for ${options.host}:${options.port ?? 587}: ${toErrorMessage(error)}`,
        toErrorStack(error),
      );
      throw error;
    } finally {
      transport.close();
    }
  }

  async renderEmail(request: EmailRenderRequest): Promise<{ html: string; text: string }> {
    try {
      const component = this.render(request);
      const html = await render(component, { pretty: false });
      const text = await render(component, { plainText: true });
      return { html, text };
    } catch (error) {
      this.logger.error(
        `Failed to render email template ${request.template}: ${toErrorMessage(error)}`,
        toErrorStack(error),
      );
      throw error;
    }
  }

  async sendEmail({
    to,
    from,
    subject,
    html,
    text,
    smtp,
    imageAttachments,
  }: SendEmailOptions): Promise<SendEmailResponse> {
    this.logger.log(`Sending email to ${to} with subject: ${subject} via ${smtp.host}:${smtp.port ?? 587}`);
    const transport = this.createTransport(smtp);

    const attachments = imageAttachments?.map((attachment) => ({
      filename: attachment.filename,
      path: attachment.path,
      cid: attachment.cid,
    }));

    try {
      const result = await transport.sendMail({ to, from, subject, html, text, attachments });
      this.logger.debug(`SMTP accepted mail to ${to} with id ${result.messageId}`);
      return result;
    } catch (error) {
      this.logger.error(
        `SMTP send failed for ${to} (${subject}) via ${smtp.host}:${smtp.port ?? 587}: ${toErrorMessage(error)}`,
        toErrorStack(error),
      );
      throw error;
    } finally {
      transport.close();
    }
  }

  private render({ template, data, customTemplate }: EmailRenderRequest): React.FunctionComponentElement<any> {
    switch (template) {
      case EmailTemplate.TEST_EMAIL: {
        return React.createElement(TestEmail, { ...data, customTemplate });
      }

      case EmailTemplate.WELCOME: {
        return React.createElement(WelcomeEmail, { ...data, customTemplate });
      }

      case EmailTemplate.ALBUM_INVITE: {
        return React.createElement(AlbumInviteEmail, { ...data, customTemplate });
      }

      case EmailTemplate.ALBUM_UPDATE: {
        return React.createElement(AlbumUpdateEmail, { ...data, customTemplate });
      }
    }
  }

  private createTransport(options: SmtpOptions) {
    return createTransport({
      host: options.host,
      port: options.port,
      tls: { rejectUnauthorized: !options.ignoreCert },
      secure: options.secure,
      auth:
        options.username || options.password
          ? {
              user: options.username,
              pass: options.password,
            }
          : undefined,
      connectionTimeout: 5000,
    });
  }
}

const toErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const toErrorStack = (error: unknown): string | undefined => (error instanceof Error ? error.stack : undefined);


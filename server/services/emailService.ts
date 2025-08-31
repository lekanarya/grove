import nodemailer from "nodemailer";

interface EmailTemplate {
  id?: string;
  name: string;
  type: string;
  subject: string;
  html_body: string;
  text_body?: string;
  variables: string[];
}

interface Alert {
  id: string;
  title: string;
  message: string;
  severity: string;
  source: string;
  created_at?: string;
}

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

interface EmailServiceOptions {
  from: string;
  config: EmailConfig;
}

class EmailService {
  private transporter: nodemailer.Transporter;
  private from: string;

  constructor(options: EmailServiceOptions) {
    this.from = options.from;
    this.transporter = nodemailer.createTransport(options.config);
  }

  async sendEmail(
    options: SendEmailOptions,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const recipients = Array.isArray(options.to)
        ? options.to.join(", ")
        : options.to;

      const mailOptions = {
        from: this.from,
        to: recipients,
        subject: options.subject,
        html: options.html,
        text: options.text || this.htmlToText(options.html),
      };

      const info = await this.transporter.sendMail(mailOptions);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error("Email sending failed:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  async sendAlertEmail(
    alert: Alert,
    template: EmailTemplate,
    recipients: string[],
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const subject = this.renderTemplate(template.subject, alert);
      const html = this.renderTemplate(template.html_body, alert);
      const text = template.text_body
        ? this.renderTemplate(template.text_body, alert)
        : undefined;

      return await this.sendEmail({
        to: recipients,
        subject,
        html,
        text,
      });
    } catch (error) {
      console.error("Alert email sending failed:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to send alert email",
      };
    }
  }

  private renderTemplate(template: string, alert: Alert): string {
    let rendered = template;

    // Replace alert variables
    rendered = rendered.replace(/\{\{alert\.title\}\}/g, alert.title);
    rendered = rendered.replace(/\{\{alert\.message\}\}/g, alert.message);
    rendered = rendered.replace(/\{\{alert\.severity\}\}/g, alert.severity);
    rendered = rendered.replace(/\{\{alert\.source\}\}/g, alert.source);
    rendered = rendered.replace(
      /\{\{alert\.created_at\}\}/g,
      alert.created_at || "",
    );
    rendered = rendered.replace(/\{\{alert\.id\}\}/g, alert.id);

    // Replace datetime variables
    rendered = rendered.replace(/\{\{datetime\}\}/g, new Date().toISOString());
    rendered = rendered.replace(
      /\{\{date\}\}/g,
      new Date().toLocaleDateString(),
    );
    rendered = rendered.replace(
      /\{\{time\}\}/g,
      new Date().toLocaleTimeString(),
    );

    return rendered;
  }

  private htmlToText(html: string): string {
    // Simple HTML to text conversion
    return html
      .replace(/<[^>]*>/g, "") // Remove HTML tags
      .replace(/\s+/g, " ") // Replace multiple spaces with single space
      .trim();
  }

  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      console.error("Email service connection verification failed:", error);
      return false;
    }
  }
}

// Factory function to create email service instance
export function createEmailService(): EmailService | null {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASSWORD;
  const emailHost = process.env.EMAIL_HOST || "smtp.gmail.com";
  const emailPort = parseInt(process.env.EMAIL_PORT || "587");
  const emailFrom = process.env.EMAIL_FROM || emailUser || "";

  if (!emailUser || !emailPass) {
    console.warn(
      "Email service not configured. EMAIL_USER and EMAIL_PASSWORD are required.",
    );
    return null;
  }

  return new EmailService({
    from: emailFrom,
    config: {
      host: emailHost,
      port: emailPort,
      secure: emailPort === 465, // true for 465, false for other ports
      auth: {
        user: emailUser,
        pass: emailPass,
      },
    },
  });
}

export { EmailService };
export type {
  EmailConfig,
  SendEmailOptions,
  EmailServiceOptions,
  EmailTemplate,
  Alert,
};

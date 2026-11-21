import nodemailer from "nodemailer";

export interface AccountMail {
  readonly to: string;
  readonly locale: string;
  readonly kind: "verify" | "reset";
  readonly token: string;
}

export interface MailAdapter {
  send(message: AccountMail): Promise<void>;
}

const catalog = {
  en: {
    verify: "Verify your Atlas email with this code:",
    reset: "Reset your Atlas password with this code:",
  },
  fa: {
    verify: "ایمیل اطلس خود را با این کد تأیید کنید:",
    reset: "برای بازنشانی رمز عبور اطلس از این کد استفاده کنید:",
  },
  ar: {
    verify: "تحقق من بريدك الإلكتروني في أطلس باستخدام هذا الرمز:",
    reset: "أعد تعيين كلمة مرور أطلس باستخدام هذا الرمز:",
  },
};

export function createSmtpMail(url: string, from: string): MailAdapter {
  const transport = nodemailer.createTransport(url, {
    from,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    async send(message) {
      const language = message.locale.split("-")[0];
      const subject = (language === "fa" || language === "ar" ? catalog[language] : catalog.en)[
        message.kind
      ];
      await transport.sendMail({ to: message.to, subject, text: subject + "\n\n" + message.token });
    },
  };
}

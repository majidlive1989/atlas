import { type Problem } from "@atlas/contracts";

export class AtlasProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "AtlasProblem";
  }
}

const catalog = {
  en: {
    bad: "The request could not be processed.",
    forbidden: "Access denied.",
    unauthorized: "Authentication required.",
    missing: "Resource not found.",
    conflict: "The request conflicts with current state.",
    throttled: "Too many requests.",
    unavailable: "The service is temporarily unavailable.",
  },
  fa: {
    bad: "پردازش درخواست ممکن نبود.",
    forbidden: "دسترسی رد شد.",
    unauthorized: "احراز هویت لازم است.",
    missing: "منبع یافت نشد.",
    conflict: "درخواست با وضعیت فعلی سازگار نیست.",
    throttled: "تعداد درخواست‌ها بیش از حد است.",
    unavailable: "سرویس موقتاً در دسترس نیست.",
  },
  ar: {
    bad: "تعذرت معالجة الطلب.",
    forbidden: "تم رفض الوصول.",
    unauthorized: "المصادقة مطلوبة.",
    missing: "المورد غير موجود.",
    conflict: "يتعارض الطلب مع الحالة الحالية.",
    throttled: "طلبات كثيرة جدًا.",
    unavailable: "الخدمة غير متاحة مؤقتًا.",
  },
} as const;

function message(status: number, locale: string): string {
  const language = locale.split("-")[0];
  const labels = language === "ar" || language === "fa" ? catalog[language] : catalog.en;
  if (status === 401) return labels.unauthorized;
  if (status === 403) return labels.forbidden;
  if (status === 404) return labels.missing;
  if (status === 409 || status === 412) return labels.conflict;
  if (status === 429) return labels.throttled;
  return status >= 500 ? labels.unavailable : labels.bad;
}

export function problem(status: number, code: string, id: string, locale = "en"): Problem {
  return {
    status,
    code,
    title: message(status, locale),
    type: "urn:atlas:problem:" + code,
    instance: "urn:uuid:" + id,
  };
}

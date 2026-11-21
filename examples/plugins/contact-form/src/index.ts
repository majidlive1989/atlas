import { definePlugin } from "@atlas/plugin-sdk";
import { z } from "zod";

const submission = z.strictObject({
  email: z.email().max(254),
  message: z.string().trim().min(1).max(4000),
});
const settings = z.strictObject({ recipient: z.email(), locale: z.string().min(2).max(35) });

export const spam = { name: "contact-form.spam", input: submission, value: z.boolean() };

export const plugin = definePlugin({
  register(ctx) {
    ctx.i18n.register("en", {
      "submission.label": "Contact submissions",
      "submission.subject": "New contact form submission",
    });
    ctx.i18n.register("ar", {
      "submission.label": "رسائل نموذج التواصل",
      "submission.subject": "رسالة جديدة من نموذج التواصل",
    });
    ctx.registry.postTypes.register({
      key: "submission",
      label: "submission.label",
      schema: submission,
      options: { visibility: "private" },
    });
    const configuration = ctx.settings.define({
      schema: settings,
      initial: { recipient: "operator@example.test", locale: "en" },
    });

    ctx.cli.register(
      "submission.get",
      async ([id]) => (await ctx.db.get("submissions", z.uuid().parse(id))) ?? null,
    );
    ctx.routes.register({
      method: "POST",
      path: "/submit",
      access: "public",
      input: submission,
      output: z.discriminatedUnion("accepted", [
        z.strictObject({ accepted: z.literal(false) }),
        z.strictObject({ accepted: z.literal(true), id: z.uuid() }),
      ]),
      async handle(input) {
        if (await ctx.hooks.filters.apply(spam, false, input)) return { accepted: false as const };
        const { recipient, locale } = await configuration.get();
        const id = await ctx.db.insert("submissions", input);
        try {
          await ctx.mail.send({
            to: recipient,
            subject: ctx.i18n.message(locale, "submission.subject"),
            text: input.email + "\n\n" + input.message,
          });
        } catch {
          ctx.logger.warn("submission.delivery-failed");
        }
        return { accepted: true as const, id };
      },
    });
  },
});

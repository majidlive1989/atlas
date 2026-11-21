import { definePlugin } from "@atlas/plugin-sdk";
import { z } from "zod";

const post = z.strictObject({
  id: z.string().min(1).max(80),
  terms: z.array(z.string().max(80)).max(40),
});
const input = z.strictObject({ post, candidates: z.array(post).max(100) });
export const relatedPosts = { name: "related-posts.rank", input, value: z.array(post).max(100) };
const settings = z.strictObject({ limit: z.number().int().min(1).max(20) });

export const plugin = definePlugin({
  register(ctx) {
    ctx.i18n.register("en", {
      "rank.label": "Rank related posts",
      "reader.label": "Related posts reader",
    });
    ctx.registry.capabilities.register({ key: "rank", label: "rank.label" });
    ctx.registry.roles.register({
      key: "reader",
      label: "reader.label",
      options: { capabilities: ["rank"] },
    });
    const configuration = ctx.settings.define({ schema: settings, initial: { limit: 5 } });
    ctx.hooks.filters.register(relatedPosts, async (posts, { post }) => {
      const terms = new Set(post.terms);
      const seen = new Set([post.id]);
      const results = posts.flatMap((candidate) => {
        if (seen.has(candidate.id)) return [];
        seen.add(candidate.id);
        const score = [...new Set(candidate.terms)].filter((term) => terms.has(term)).length;
        return score ? [{ candidate, score }] : [];
      });
      return results
        .sort((a, b) => b.score - a.score)
        .slice(0, (await configuration.get()).limit)
        .map(({ candidate }) => candidate);
    });
    ctx.routes.register({
      method: "POST",
      path: "/rank",
      access: { capability: "plugin.related-posts.rank" },
      input,
      output: relatedPosts.value,
      handle: (payload) => ctx.hooks.filters.apply(relatedPosts, payload.candidates, payload),
    });
  },
});

import { Hono } from "https://deno.land/x/hono@v3.4.1/mod.ts";
import { load } from "https://deno.land/std@0.198.0/dotenv/mod.ts";
import { Payload } from "./types.ts";
import { tweet } from "./twitter.ts";
import { isUploadableMedia, uploadMedia } from "./twitterMedia.ts";

const timelog = (text: string, content?: string) => {
  console.log(
    `${new Date().toLocaleString("ja-JP", { timeZone: "JST" })}: ${text}\n${
      content?.replace(/^/gm, "> ") ?? ""
    }`,
  );
};

const env = await load();
const [secret, authToken, ct0] = [
  "MISSKEY_WEBHOOK_SECRET",
  "TWITTER_AUTH_TOKEN",
  "TWITTER_CT0",
].map((key) => Deno.env.get(key) ?? env[key] ?? "");

const app = new Hono();

app.post("/", async (c) => {
  const requestSecret: string = c.req.header("X-Misskey-Hook-Secret") ?? "";
  if (requestSecret !== secret) {
    const msg = "wrong secret";
    timelog(msg);
    return c.text(msg, 403);
  }
  const payload: Payload = await c.req.json();
  const { text, cw, visibility, localOnly, files } = payload.body.note;
  if (localOnly) {
    const msg = `post visibility: "local only"`;
    timelog(msg);
    return c.text(msg, 403);
  }
  if (visibility !== "public" && visibility !== "home") {
    const msg = `post visibility: "${visibility}"`;
    timelog(msg);
    return c.text(msg, 403);
  }
  const medias = await Promise.all(
    (files ?? []).map(async (file) =>
      await isUploadableMedia(file.url, file.type)
    ),
  );
  console.log(medias);
  const unuploadFiles: { url: string; type: string }[] = [];
  const uploadableMedias: {
    url: string;
    blob: Blob;
    type: "image" | "gif" | "video";
  }[] = [];
  for (const media of medias) {
    if (
      media.uploadable &&
      (uploadableMedias.length < 4 && uploadableMedias.every((m) =>
            m.type === "image"
          ) &&
          media.type === "image" ||
        uploadableMedias.length < 1 && media.type !== "image")
    ) {
      uploadableMedias.push(media);
    } else {
      unuploadFiles.push({
        url: media.url,
        type: media.uploadable ? media.blob.type : media.type,
      });
    }
  }
  const mediaIds = await Promise.all(
    uploadableMedias.map(async (media) =>
      await uploadMedia(media.blob, media.type, authToken, ct0)
    ),
  );

  const filesStr: string = [
    ...unuploadFiles,
    ...(files ?? []).filter((f) =>
      !(f.type.includes("image") || f.type === "video/mp4")
    ),
  ].reduce((p: string, c) => {
    return `${p}\n${
      c.type.includes("image") ? "🖼" : c.type.includes("video") ? "📹" : "📄"
    } ${c.url}`;
  }, "");
  const tweetContent = (cw ? `${cw}...\n\n` : "") + (text ?? "") + filesStr;
  if (!tweetContent) {
    const msg = "empty content";
    timelog(msg);
    return c.text(msg, 403);
  }
  const res = await tweet(tweetContent, authToken, ct0, mediaIds);
  if (res.status === 200) {
    const msg = "successfully tweeted";
    timelog(msg, tweetContent);
    return c.text(msg, 200);
  }
  const msg = "error while tweeting";
  timelog(msg, tweetContent);
  return c.text(msg, 403);
});

Deno.serve(app.fetch);

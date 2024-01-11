// @deno-types="npm:@types/ffprobe-static";
import ffprobeStatic from "npm:ffprobe-static";
// @deno-types="npm:@types/ffprobe";
import ffprobe from "npm:ffprobe";
import { File } from "./types.ts";

export const isUploadableMedia = async (
  file: File,
): Promise<
  | {
    uploadable: true;
    url: string;
    blob: Blob;
    type: "image" | "gif" | "video";
  }
  | {
    uploadable: false;
    url: string;
    type: string;
  }
> => {
  const { url, type: mime, size } = file;
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") {
    const res = await fetch(url);
    const blob = await res.blob();

    return size <= 5 * 1024 * 1024
      ? { uploadable: true, url, blob, type: "image" }
      : { uploadable: false, url, type: mime };
  } else if (mime === "image/gif") {
    const res = await fetch(url);
    const blob = await res.blob();
    return size <= 15 * 1024 * 1024
      ? { uploadable: true, url, blob, type: "gif" }
      : { uploadable: false, url, type: mime };
  } else if (mime.startsWith("video/")) {
    // ファイルサイズが512MB以下であること
    if (size > 512 * 1024 * 1024) {
      return {
        uploadable: false,
        url,
        type: mime,
      };
    }

    const videoInfo = await ffprobe(url, {
      path: ffprobeStatic.path,
    });
    console.log(videoInfo);
    const videoStream = videoInfo.streams.filter((s) =>
      s.codec_type === "video"
    );
    // 解像度が32x32以上1280x1024以下であること
    if (
      videoStream.some((s) =>
        !s.width || s.width < 32 || !s.height ||
        s.height < 32
      )
    ) {
      return {
        uploadable: false,
        url,
        type: mime,
      };
    }
    // フレームレートが６０FPS以下であること
    if (
      videoStream.some((s) =>
        !s.r_frame_rate ||
        Number(s.r_frame_rate.split("/")[0]) /
              Number(s.r_frame_rate.split("/")[1]) > 60
      )
    ) {
      return {
        uploadable: false,
        url,
        type: mime,
      };
    }
    // 再生時間が0.5秒〜140秒であること
    if (
      videoStream.some((s) =>
        !s.duration || Number(s.duration) < 0.5 || Number(s.duration) > 140
      )
    ) {
      return {
        uploadable: false,
        url,
        type: mime,
      };
    }
    // アスペクト比が1:3以上3:1以下であること
    if (
      videoStream.some((s) =>
        (!s.display_aspect_ratio ||
          Number(s.display_aspect_ratio.split(":")[0]) /
                Number(s.display_aspect_ratio.split(":")[1]) < 1 / 3 ||
          Number(s.display_aspect_ratio.split(":")[0]) /
                Number(s.display_aspect_ratio.split(":")[1]) > 3) &&
        (!s.width ||
          !s.height || s.width / s.height < 1 / 3 || s.width / s.height > 3)
      )
    ) {
      return {
        uploadable: false,
        url,
        type: mime,
      };
    }
    // yuv420pもしくはyuvj420pであること
    if (
      videoStream.some((s) =>
        !s.pix_fmt || (s.pix_fmt !== "yuv420p" && s.pix_fmt !== "yuvj420p")
      )
    ) {
      console.log("pix_fmt");
      return {
        uploadable: false,
        url,
        type: mime,
      };
    }

    const audioStream = videoInfo.streams.filter((s) =>
      s.codec_type === "audio"
    );
    // AAC LCであること
    if (
      audioStream.some((s) =>
        !s.codec_name || s.codec_name !== "aac" || !s.profile ||
        s.profile !== "LC"
      )
    ) {
      return {
        uploadable: false,
        url,
        type: mime,
      };
    }
    // モノラルもしくはステレオであること
    if (
      audioStream.some((s) => !s.channels || s.channels > 2)
    ) {
      return {
        uploadable: false,
        url,
        type: mime,
      };
    }

    const res = await fetch(url);
    const blob = await res.blob();

    return {
      uploadable: true,
      url,
      blob,
      type: "video",
    };
  } else {
    return {
      uploadable: false,
      url,
      type: mime,
    };
  }
};

export const uploadMedia = async (
  blob: Blob,
  type: "image" | "gif" | "video",
  authToken: string,
  ct0: string,
) => {
  const authorization =
    "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

  const mediaType = `tweet_${type}`;

  const initURL =
    `https://upload.twitter.com/i/media/upload.json?command=INIT&total_bytes=${blob.size}&media_type=${
      encodeURIComponent(blob.type)
    }&media_category=${mediaType}`;

  // メディアアップロードを宣言する
  const uploadInitRes = await fetch(initURL, {
    method: "POST",
    headers: {
      "authorization": authorization,
      "x-csrf-token": ct0,
      "cookie": `auth_token=${authToken}; ct0=${ct0};`,
      "Origin": "https://twitter.com",
    },
  });
  if (!uploadInitRes.ok) {
    throw new Error("Failed to initialize upload");
  }
  const mediaInfo: { media_id_string: string } = await uploadInitRes.json();

  // 5MBごとに分割してアップロード
  const chunkSize = 5 * 1024 * 1024;
  const chunks = [];
  for (let i = 0; i < blob.size; i += chunkSize) {
    chunks.push(blob.slice(i, i + chunkSize));
  }

  await Promise.all(chunks.map(async (chunk, index) => {
    const appendURL =
      `https://upload.twitter.com/i/media/upload.json?command=APPEND&media_id=${mediaInfo.media_id_string}&segment_index=${index}`;
    const body = new FormData();
    body.append("media", chunk);
    const uploadAppendRes = await fetch(appendURL, {
      method: "POST",
      body,
      headers: {
        "authorization": authorization,
        "x-csrf-token": ct0,
        "cookie": `auth_token=${authToken}; ct0=${ct0};`,
        "Origin": "https://twitter.com",
      },
    });
    if (!uploadAppendRes.ok) {
      throw new Error(`Failed to upload chunk ${index}`);
    }
  }));

  // アップロード完了
  const finalizeURL =
    `https://upload.twitter.com/i/media/upload.json?command=FINALIZE&media_id=${mediaInfo.media_id_string}`;
  const uploadFinalizeRes = await fetch(finalizeURL, {
    method: "POST",
    headers: {
      "authorization": authorization,
      "x-csrf-token": ct0,
      "cookie": `auth_token=${authToken}; ct0=${ct0};`,
      "Origin": "https://twitter.com",
    },
  });
  if (!uploadFinalizeRes.ok) {
    throw new Error("Failed to finalize upload");
  }
  const finalizeInfo: {
    media_id_string: string;
    processing_info?: { state: string; check_after_secs: number };
  } = await uploadFinalizeRes.json();

  // Twitter側で処理中の場合は完了するまで待つ
  if (
    finalizeInfo.processing_info && finalizeInfo.processing_info.state ===
      "pending"
  ) {
    let checkAfterSecs = finalizeInfo.processing_info.check_after_secs;
    while (true) {
      await new Promise((resolve) =>
        setTimeout(resolve, checkAfterSecs * 1000)
      );

      const statusURL =
        `https://upload.twitter.com/i/media/upload.json?command=STATUS&media_id=${finalizeInfo.media_id_string}`;
      const uploadStatusRes = await fetch(statusURL, {
        method: "GET",
        headers: {
          "authorization": authorization,
          "x-csrf-token": ct0,
          "cookie": `auth_token=${authToken}; ct0=${ct0};`,
          "Origin": "https://twitter.com",
        },
      });
      if (!uploadStatusRes.ok) {
        throw new Error("Failed to get upload status");
      }
      const statusInfo: {
        processing_info: { state: "succeeded" } | {
          state: "in_progress";
          check_after_secs: number;
        };
      } = await uploadStatusRes.json();
      console.log(statusInfo);

      if (statusInfo.processing_info.state === "succeeded") {
        break;
      }
      checkAfterSecs = statusInfo.processing_info.check_after_secs;
    }
  }

  return finalizeInfo.media_id_string;
};

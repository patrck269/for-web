/**
 * Screen-share quality catalog and the fit used when a source is not 16:9.
 * Share start and the settings control both read this module.
 */

export type ScreenShareQualityName =
  | "low"
  | "high"
  | "hd60"
  | "qhd60"
  | "uhd100"
  | "text";

export const ScreenShareQualityNames: ScreenShareQualityName[] = [
  "low",
  "high",
  "hd60",
  "qhd60",
  "uhd100",
  "text",
];

export interface ScreenShareResolution {
  width: number;
  height: number;
  frameRate: number;
}

export interface ScreenShareEncoding {
  maxBitrate: number;
  maxFramerate: number;
}

export interface ScreenShareQualityChoice {
  name: ScreenShareQualityName;
  fullName: string;
  contentHint: "motion" | "detail" | "text";
  resolution: ScreenShareResolution;
  encoding: ScreenShareEncoding;
}

export type VideoResolutionLimit = readonly [number, number];

const LOW: ScreenShareQualityChoice = {
  name: "low",
  fullName: "720p 30FPS",
  contentHint: "motion",
  resolution: { width: 1280, height: 720, frameRate: 30 },
  encoding: { maxBitrate: 2_000_000, maxFramerate: 30 },
};

const HIGH: ScreenShareQualityChoice = {
  name: "high",
  fullName: "1080p 30FPS",
  contentHint: "motion",
  resolution: { width: 1920, height: 1080, frameRate: 30 },
  encoding: { maxBitrate: 5_000_000, maxFramerate: 30 },
};

const HD60: ScreenShareQualityChoice = {
  name: "hd60",
  fullName: "1080p 60FPS",
  contentHint: "motion",
  resolution: { width: 1920, height: 1080, frameRate: 60 },
  encoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
};

const QHD60: ScreenShareQualityChoice = {
  name: "qhd60",
  fullName: "1440p 60FPS",
  contentHint: "motion",
  resolution: { width: 2560, height: 1440, frameRate: 60 },
  encoding: { maxBitrate: 12_000_000, maxFramerate: 60 },
};

const UHD100: ScreenShareQualityChoice = {
  name: "uhd100",
  fullName: "4K 100fps",
  contentHint: "motion",
  resolution: { width: 3840, height: 2160, frameRate: 100 },
  encoding: { maxBitrate: 25_000_000, maxFramerate: 100 },
};

const FIXED: ScreenShareQualityChoice[] = [HIGH, HD60, QHD60, UHD100];

const SOURCE_BITRATE = 7_000_000;

export function normalizeVideoLimit(
  limit: VideoResolutionLimit | undefined,
): [number, number] {
  if (!limit) return [0, 0];
  const width = Number(limit[0]);
  const height = Number(limit[1]);
  return [
    Number.isFinite(width) && width > 0 ? width : 0,
    Number.isFinite(height) && height > 0 ? height : 0,
  ];
}

/** A 0 component is uncapped. Fixed presets whose width or height exceed the cap are hidden. */
export function choiceFitsLimit(
  choice: Pick<ScreenShareQualityChoice, "resolution">,
  limit: VideoResolutionLimit | undefined,
): boolean {
  const [maxWidth, maxHeight] = normalizeVideoLimit(limit);
  if (maxWidth !== 0 && choice.resolution.width > maxWidth) return false;
  if (maxHeight !== 0 && choice.resolution.height > maxHeight) return false;
  return true;
}

function sourceChoice(
  limit: VideoResolutionLimit | undefined,
): ScreenShareQualityChoice {
  const [width, height] = normalizeVideoLimit(limit);
  return {
    name: "text",
    fullName: "Source 5FPS",
    contentHint: "text",
    resolution: { width, height, frameRate: 5 },
    encoding: { maxBitrate: SOURCE_BITRATE, maxFramerate: 5 },
  };
}

/**
 * Qualities the server limit allows. 720p30 is always offered.
 * Source is capped to the limit (0 means uncapped).
 */
export function enabledScreenShareQualities(
  limit: VideoResolutionLimit | undefined,
): Partial<Record<ScreenShareQualityName, ScreenShareQualityChoice>> {
  const qualities: Partial<
    Record<ScreenShareQualityName, ScreenShareQualityChoice>
  > = {
    low: cloneChoice(LOW),
  };

  for (const choice of FIXED) {
    if (choiceFitsLimit(choice, limit)) {
      qualities[choice.name] = cloneChoice(choice);
    }
  }

  qualities.text = sourceChoice(limit);
  return qualities;
}

export function screenShareChoice(
  name: ScreenShareQualityName | undefined,
  limit: VideoResolutionLimit | undefined,
): ScreenShareQualityChoice {
  const qualities = enabledScreenShareQualities(limit);
  return cloneChoice(qualities[name ?? "low"] ?? qualities.low!);
}

/**
 * Constraints sent into getDisplayMedia.
 * When the user will pick a quality after the prompt, capture the largest
 * allowed size so a later 4K choice can scale down instead of being stuck at 720p.
 */
export function captureChoiceForShareStart(
  limit: VideoResolutionLimit | undefined,
  savedName: ScreenShareQualityName | undefined,
  willChoose: boolean,
): ScreenShareQualityChoice {
  if (!willChoose) return screenShareChoice(savedName, limit);

  const catalog = enabledScreenShareQualities(limit);
  const ranked = Object.values(catalog).filter(
    (choice): choice is ScreenShareQualityChoice =>
      choice !== undefined && choice.name !== "text",
  );
  ranked.sort((a, b) => {
    const area =
      b.resolution.width * b.resolution.height -
      a.resolution.width * a.resolution.height;
    if (area !== 0) return area;
    return b.resolution.frameRate - a.resolution.frameRate;
  });
  return cloneChoice(ranked[0] ?? catalog.low!);
}

/**
 * Fit a source inside the selected cap and the server max without changing aspect.
 * A 0 server-limit component is uncapped on that axis.
 * The frame is scaled (up or down) so the long edge meets the tighter cap.
 */
export function fitSourceToCap(
  sourceWidth: number,
  sourceHeight: number,
  capWidth: number,
  capHeight: number,
  serverLimit?: VideoResolutionLimit,
): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: 0, height: 0 };
  }

  const [limitWidth, limitHeight] = normalizeVideoLimit(serverLimit);
  const bounds = [
    capWidth > 0 ? capWidth : undefined,
    limitWidth > 0 ? limitWidth : undefined,
  ].filter((value): value is number => value !== undefined);
  const boundHeights = [
    capHeight > 0 ? capHeight : undefined,
    limitHeight > 0 ? limitHeight : undefined,
  ].filter((value): value is number => value !== undefined);

  const maxWidth = bounds.length > 0 ? Math.min(...bounds) : sourceWidth;
  const maxHeight =
    boundHeights.length > 0 ? Math.min(...boundHeights) : sourceHeight;

  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  let width = Math.max(1, Math.round(sourceWidth * scale));
  let height = Math.max(1, Math.round(sourceHeight * scale));

  if (width > maxWidth) {
    width = maxWidth;
    height = Math.max(1, Math.round((maxWidth * sourceHeight) / sourceWidth));
  }
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.max(1, Math.round((maxHeight * sourceWidth) / sourceHeight));
  }
  if (width > maxWidth) width = Math.floor(maxWidth);
  if (height > maxHeight) height = Math.floor(maxHeight);

  return { width, height };
}

/**
 * Capture size and encoding for a choice. When a source size is known, width and
 * height are the fitted frame. Frame rate and encoding max frame rate stay on the choice.
 */
export function resolveScreenShareCapture(
  choice: ScreenShareQualityChoice,
  source?: { width: number; height: number },
  serverLimit?: VideoResolutionLimit,
): ScreenShareQualityChoice {
  const resolved = cloneChoice(choice);
  resolved.encoding = {
    maxBitrate: choice.encoding.maxBitrate,
    maxFramerate: choice.resolution.frameRate,
  };

  if (!source || source.width <= 0 || source.height <= 0) {
    return resolved;
  }

  const fitted = fitSourceToCap(
    source.width,
    source.height,
    choice.resolution.width,
    choice.resolution.height,
    serverLimit,
  );
  resolved.resolution = {
    width: fitted.width,
    height: fitted.height,
    frameRate: choice.resolution.frameRate,
  };
  return resolved;
}

type ConstraintNumber =
  | number
  | {
      ideal?: number;
      max?: number;
      min?: number;
      exact?: number;
    };

function constraintNumber(value: ConstraintNumber | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (value && typeof value === "object") {
    const picked = value.max ?? value.ideal ?? value.exact ?? value.min;
    if (typeof picked === "number" && Number.isFinite(picked) && picked > 0) {
      return picked;
    }
  }
  return undefined;
}

/**
 * Turn a requested screen-share size into a maximum box.
 * Ideal width and height together read as 16:9 and crop ultrawide frames.
 */
export function displayMediaVideoConstraints<T extends Record<string, unknown>>(
  video: T & {
    width?: ConstraintNumber;
    height?: ConstraintNumber;
    frameRate?: ConstraintNumber;
    aspectRatio?: unknown;
  },
): Omit<T, "aspectRatio"> & {
  width?: { max: number };
  height?: { max: number };
  frameRate?: { ideal: number; max: number };
} {
  const next = { ...video };
  delete next.aspectRatio;

  const width = constraintNumber(video.width);
  const height = constraintNumber(video.height);
  const frameRate = constraintNumber(video.frameRate);

  if (width !== undefined) next.width = { max: width };
  if (height !== undefined) next.height = { max: height };
  if (frameRate !== undefined) {
    next.frameRate = { ideal: frameRate, max: frameRate };
  }

  return next;
}

function cloneChoice(choice: ScreenShareQualityChoice): ScreenShareQualityChoice {
  return {
    name: choice.name,
    fullName: choice.fullName,
    contentHint: choice.contentHint,
    resolution: { ...choice.resolution },
    encoding: { ...choice.encoding },
  };
}

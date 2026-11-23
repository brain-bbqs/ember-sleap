import {
  ApiError,
  apiFetch,
  listedTitle,
  nextPagePath,
  type ArchiveConfig,
  type DandisetListItem,
} from "@brain-bbqs/ember-client";
import { DERIVATIVES_ROOT, isDerivativePath, suggestedEntities } from "./bidsDerivatives";
import { baseName, fileTypeOfPath, isProjectType } from "./fileType";
import type { FileType } from "./sleapContract";

/** The slice of a listed asset this page reads. */
export interface ArchiveAsset {
  asset_id: string;
  path: string;
  size: number;
}

export interface ProjectAsset extends ArchiveAsset {
  fileType: FileType;
}

export interface DandisetSummary {
  identifier: string;
  title: string;
  embargoed: boolean;
}

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

async function listDraftAssets(cfg: ArchiveConfig, filter: string): Promise<ArchiveAsset[]> {
  const assets: ArchiveAsset[] = [];
  let path: string | null =
    `/dandisets/${cfg.dandisetId}/versions/draft/assets/?${filter}&metadata=false&order=path&page_size=${PAGE_SIZE}`;
  for (let pages = 0; path && pages < MAX_PAGES; pages++) {
    const page = await apiFetch<{ results?: ArchiveAsset[]; next?: string | null }>(cfg, path);
    assets.push(...(page?.results ?? []));
    path = nextPagePath(cfg, page?.next);
  }
  return assets;
}

export async function fetchDandiset(cfg: ArchiveConfig): Promise<DandisetSummary> {
  const info = await apiFetch<{
    identifier: string;
    embargo_status?: string;
    draft_version?: { name?: string };
  }>(cfg, `/dandisets/${cfg.dandisetId}/`);
  return {
    identifier: info?.identifier ?? cfg.dandisetId,
    title: info?.draft_version?.name ?? "",
    embargoed: (info?.embargo_status ?? "OPEN") !== "OPEN",
  };
}

/** The dandisets the signed-in account owns, embargoed ones included: the ones it can save to. */
export async function listOwnDandisets(cfg: ArchiveConfig): Promise<DandisetSummary[]> {
  const page = await apiFetch<{ results?: DandisetListItem[] }>(
    cfg,
    "/dandisets/?user=me&embargoed=true&page_size=1000",
  );
  return (page?.results ?? []).map((item) => ({
    identifier: item.identifier,
    title: listedTitle(item),
    embargoed: (item.embargo_status ?? "OPEN") !== "OPEN",
  }));
}

/** Every labels project (`.slp` or `.pkg.slp`) in the dandiset's draft, in path order. */
export async function listProjects(cfg: ArchiveConfig): Promise<ProjectAsset[]> {
  const assets = await listDraftAssets(cfg, "glob=*.slp");
  return assets.flatMap((asset) => {
    const fileType = fileTypeOfPath(asset.path);
    return fileType && isProjectType(fileType) ? [{ ...asset, fileType }] : [];
  });
}

/** The video types a new project starts from; `.h5` is left out, since most HDF5 files are not videos. */
const VIDEO_GLOBS = ["*.mp4", "*.avi"] as const;

/**
 * Every video a new project can start from, in path order: the dandiset's `.mp4` and `.avi` files,
 * minus anything under `derivatives/` (renders and outputs of other tools, not recorded video).
 */
export async function listVideos(cfg: ArchiveConfig): Promise<ProjectAsset[]> {
  const found = await Promise.all(VIDEO_GLOBS.map((glob) => listDraftAssets(cfg, `glob=${glob}`)));
  return (
    found
      .flat()
      .flatMap((asset) => {
        const fileType = fileTypeOfPath(asset.path);
        return fileType && !isProjectType(fileType) && !isDerivativePath(asset.path) ? [{ ...asset, fileType }] : [];
      })
      // Two globs never match one path, so no two paths here are equal.
      .sort((a, b) => (a.path < b.path ? -1 : 1))
  );
}

/** Every draft asset whose path starts with `prefix`, which is how the archive's `path` filter matches. */
export function findAssetsByPrefix(cfg: ArchiveConfig, prefix: string): Promise<ArchiveAsset[]> {
  return listDraftAssets(cfg, `path=${encodeURIComponent(prefix)}`);
}

/** The draft asset at exactly `path`, or null. The `path` filter is a prefix match, hence the check. */
export async function findAssetByPath(cfg: ArchiveConfig, path: string): Promise<ArchiveAsset | null> {
  const assets = await findAssetsByPrefix(cfg, path);
  return assets.find((a) => a.path === path) ?? null;
}

/** Draft assets whose file name is exactly `name`, in any folder. */
export async function findAssetsByName(cfg: ArchiveConfig, name: string): Promise<ArchiveAsset[]> {
  const assets = await listDraftAssets(cfg, `glob=${encodeURIComponent(`*${name}`)}`);
  return assets.filter((a) => baseName(a.path) === name);
}

function folderSegments(path: string): string[] {
  return path.split("/").slice(0, -1);
}

/**
 * Of several assets sharing a video's file name, the one a project most likely meant: the longest
 * path the stored path ends with (the project kept the layout it was labeled in), else the one of
 * the project's own subject and session, then the one sharing the most leading folders with it.
 * A project in `derivatives/sleap/` is compared as the source tree it mirrors, since raw videos
 * never sit under it. Subjects and sessions are compared as their letters and digits, since a saved
 * project's labels are the source's with anything else dropped. Ties keep listing order.
 */
export function closestAsset<T extends { path: string }>(candidates: T[], projectPath: string, storedPath: string): T {
  const stored = storedPath.replace(/\\/g, "/");
  const suffixHits = candidates.filter((c) => stored === c.path || stored.endsWith(`/${c.path}`));
  if (suffixHits.length > 0) {
    return suffixHits.reduce((best, c) => (c.path.length > best.path.length ? c : best));
  }
  const mirrored = isDerivativePath(projectPath) ? projectPath.slice(DERIVATIVES_ROOT.length + 1) : projectPath;
  const project = folderSegments(mirrored);
  const same = (a?: string, b?: string) => !!a && a.toLowerCase() === b?.toLowerCase();
  const want = suggestedEntities(mirrored);
  const kin = (c: T) => {
    const have = suggestedEntities(c.path);
    if (!same(want.sub, have.sub)) return 0;
    return same(want.ses, have.ses) ? 2 : 1;
  };
  const shared = (c: T) => {
    const folders = folderSegments(c.path);
    let n = 0;
    while (n < folders.length && n < project.length && folders[n] === project[n]) n++;
    return n;
  };
  const closer = (a: T, b: T) => kin(a) - kin(b) || shared(a) - shared(b);
  return candidates.reduce((best, c) => (closer(c, best) > 0 ? c : best));
}

export function downloadUrl(cfg: ArchiveConfig, assetId: string): string {
  return `${cfg.api}/assets/${assetId}/download/`;
}

/**
 * The storage URL an asset's download endpoint redirects to: a presigned S3 link, valid for six
 * hours, that the app can range-read without our token. The request is dropped once the redirect
 * has been followed, since only the address is wanted, not the bytes.
 */
export async function resolveDownloadUrl(
  cfg: ArchiveConfig,
  assetId: string,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<string> {
  const controller = new AbortController();
  const headers: Record<string, string> = cfg.accessToken ? { Authorization: `Bearer ${cfg.accessToken}` } : {};
  const response = await fetchImpl(downloadUrl(cfg, assetId), { headers, signal: controller.signal });
  controller.abort();
  if (!response.ok) {
    throw new ApiError(
      `Could not get a download link for asset ${assetId} (HTTP ${response.status}).`,
      response.status,
    );
  }
  return response.url;
}

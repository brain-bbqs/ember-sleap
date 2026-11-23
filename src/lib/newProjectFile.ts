// The bytes of a new SLEAP project on a set of videos, with no skeleton or labels yet: what the
// SLEAP app writes the first time a project it started is saved. The stand-in writes it with the
// Talmo Lab's own `.slp` writer, `@talmolab/sleap-io.js`, loaded only when a new project is first
// saved or trained on, since its HDF5 writer is several MB of WebAssembly the rest of the page never needs.

/** Each video is recorded by `paths[i]`, the path the host finds it by again when the project is reopened. */
export async function newProjectFile(paths: string[]): Promise<Blob> {
  const { Labels, Video, saveSlpToBytes } = await import("@talmolab/sleap-io.js");
  const labels = new Labels({ videos: paths.map((filename) => new Video({ filename })), skeletons: [] });
  const bytes = await saveSlpToBytes(labels);
  return new Blob([bytes.slice()], { type: "application/octet-stream" });
}

// Moving notes around in the tree (dragging a file or folder onto a folder), as plain functions so they can be tested.

/** where a path ends up when `from` is moved to `to`: the moved path itself, or anything inside it, gets the new prefix */
export const remap = (p: string, from: string, to: string) => (p === from ? to : p.startsWith(from + "/") ? to + p.slice(from.length) : p);

const parentOf = (p: string) => p.replace(/\/[^/]*$/, "") || "/";

/** a drop is useful unless it is onto the folder it is already in, onto itself, or (for a folder) into its own insides */
export const canDrop = (from: string, intoDir: string) => parentOf(from) !== intoDir && intoDir !== from && !intoDir.startsWith(from + "/");
